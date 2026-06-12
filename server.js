import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TIK_TOOLS_API_KEY || '';
const API_BASE = process.env.TIK_TOOLS_API_BASE || 'https://api.tik.tools';

// El ranking se recarga una vez al día (24h)
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // comprueba cada 15 min si toca refrescar
const CACHE_FILE = path.join(__dirname, 'data', 'leaderboard.json');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let cache = { updatedAt: 0, users: [], source: null };

// ---------------------------------------------------------------------------
// Normalización: la API puede devolver distintos nombres de campo según el
// endpoint, así que mapeamos de forma defensiva a un formato único.
// ---------------------------------------------------------------------------
function pick(obj, keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function normalizeUser(raw, index) {
  const user = raw.user || raw.owner || raw.anchor || raw;
  return {
    rank: Number(pick(raw, ['rank', 'position', 'index'])) || index + 1,
    username: String(
      pick(user, ['unique_id', 'uniqueId', 'username', 'display_id', 'displayId', 'id_str']) ||
      pick(raw, ['unique_id', 'uniqueId', 'username']) || `user_${index + 1}`
    ),
    nickname: String(
      pick(user, ['nickname', 'nickName', 'display_name', 'displayName', 'name']) ||
      pick(raw, ['nickname', 'title']) || ''
    ),
    avatar: String(
      pick(user, [
        'avatar_thumb.url_list.0', 'avatarThumb.urlList.0', 'avatar_url', 'avatarUrl',
        'avatar', 'profile_picture', 'profilePictureUrl',
      ]) || pick(raw, ['avatar', 'cover', 'cover_url']) || ''
    ),
    score: Number(
      pick(raw, ['score', 'diamonds', 'diamond_count', 'diamondCount', 'points', 'total']) ?? 0
    ),
    viewers: Number(
      pick(raw, ['viewers', 'viewer_count', 'viewerCount', 'user_count', 'userCount', 'audience']) ?? 0
    ),
    followers: Number(
      pick(user, ['follower_count', 'followerCount', 'followers', 'follow_info.follower_count']) ?? 0
    ),
    isLive: Boolean(pick(raw, ['is_live', 'isLive', 'alive', 'live']) ?? true),
  };
}

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  for (const key of ['channels', 'top_channels', 'topChannels', 'rankings', 'ranks', 'list', 'users', 'items', 'leaderboard', 'results']) {
    const v = data?.[key];
    if (Array.isArray(v) && v.length) return v;
  }
  // búsqueda en profundidad de la primera lista de objetos
  if (data && typeof data === 'object') {
    for (const v of Object.values(data)) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
      if (v && typeof v === 'object') {
        const nested = extractList(v);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Fetch del leaderboard global de tik.tools
// ---------------------------------------------------------------------------
async function fetchLeaderboard() {
  const endpoints = [
    `${API_BASE}/api/live/top-channels?apiKey=${encodeURIComponent(API_KEY)}`,
    `${API_BASE}/webcast/rankings?apiKey=${encodeURIComponent(API_KEY)}`,
  ];

  let lastError = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} en ${new URL(url).pathname}`);
        continue;
      }
      const payload = await res.json();
      const list = extractList(payload);
      if (!list.length) {
        lastError = new Error(`Respuesta sin ranking en ${new URL(url).pathname}`);
        continue;
      }
      const users = list
        .map(normalizeUser)
        .sort((a, b) => (b.score - a.score) || (b.viewers - a.viewers))
        .map((u, i) => ({ ...u, rank: i + 1 }));
      return { users, source: new URL(url).pathname };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('No se pudo obtener el leaderboard');
}

async function refreshLeaderboard(force = false) {
  const age = Date.now() - cache.updatedAt;
  if (!force && age < REFRESH_INTERVAL_MS && cache.users.length) return;

  try {
    const { users, source } = await fetchLeaderboard();
    cache = { updatedAt: Date.now(), users, source };
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
    console.log(`[leaderboard] actualizado: ${users.length} usuarios desde ${source}`);
  } catch (err) {
    console.error(`[leaderboard] error al refrescar: ${err.message}`);
  }
}

async function loadCacheFromDisk() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const saved = JSON.parse(raw);
    if (saved?.users?.length) cache = saved;
  } catch {
    /* sin caché previa */
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.get('/api/leaderboard', (req, res) => {
  res.json({
    success: cache.users.length > 0,
    updatedAt: cache.updatedAt ? new Date(cache.updatedAt).toISOString() : null,
    nextRefresh: cache.updatedAt ? new Date(cache.updatedAt + REFRESH_INTERVAL_MS).toISOString() : null,
    total: cache.users.length,
    source: cache.source,
    users: cache.users,
  });
});

app.post('/api/leaderboard/refresh', async (req, res) => {
  await refreshLeaderboard(true);
  res.json({ success: cache.users.length > 0, total: cache.users.length });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), cachedUsers: cache.users.length });
});

app.listen(PORT, async () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  if (!API_KEY) console.warn('AVISO: falta TIK_TOOLS_API_KEY en el entorno (.env)');
  await loadCacheFromDisk();
  await refreshLeaderboard();
  setInterval(refreshLeaderboard, CHECK_INTERVAL_MS);
});
