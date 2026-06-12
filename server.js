import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TIK_TOOLS_API_KEY || '';
const API_BASE = process.env.TIK_TOOLS_API_BASE || 'https://api.tik.tools';
const IS_VERCEL = Boolean(process.env.VERCEL);

// El ranking se recarga una vez al día (24h)
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // comprueba cada 15 min si toca refrescar
// En Vercel solo /tmp es escribible
const CACHE_FILE = IS_VERCEL
  ? path.join(os.tmpdir(), 'leaderboard.json')
  : path.join(__dirname, 'data', 'leaderboard.json');

// Blindaje del proceso: ningún error inesperado debe tumbar el servidor
// (la continuidad de los monitores en segundo plano depende de ello)
process.on('uncaughtException', (err) => {
  console.error('[proceso] excepción no capturada (el servidor sigue):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[proceso] promesa rechazada sin capturar (el servidor sigue):', reason?.message || reason);
});

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
    region: String(
      pick(raw, ['region', 'country', 'country_code', 'countryCode']) ||
      pick(user, ['region', 'country', 'country_code']) || ''
    ).toUpperCase(),
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
// Recolección del leaderboard: varias fuentes que se fusionan hasta el top 100
//  1. top-channels global (público)
//  2. top-channels con hint de región por cada país de Latinoamérica
//  3. feed de descubrimiento paginado (sign-and-return) como relleno
// ---------------------------------------------------------------------------
const TOP_N = 100;
const LATAM_REGIONS = ['MX', 'CO', 'AR', 'PE', 'CL', 'EC', 'VE', 'GT', 'DO', 'BO', 'PY', 'UY', 'HN', 'SV', 'NI', 'CR', 'PA'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', ...(options.headers || {}) },
    method: options.method || 'GET',
    body: options.body,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).pathname}`);
  return res.json();
}

async function fetchTopChannels(region = '') {
  const params = new URLSearchParams({ apiKey: API_KEY, limit: '200' });
  if (region) params.set('region', region);
  const payload = await getJson(`${API_BASE}/api/live/top-channels?${params}`);
  return extractList(payload).map((raw, i) => {
    const u = normalizeUser(raw, i);
    if (!u.region && region) u.region = region;
    return u;
  });
}

// Feed de descubrimiento: tik.tools firma la URL de TikTok y la consumimos
// nosotros con las cabeceras/cookies que nos devuelve (sign-and-return)
async function fetchFeedRooms(region = 'US', pages = 3) {
  const rooms = [];
  let maxTime = '0';
  for (let p = 0; p < pages; p++) {
    const signed = await getJson(`${API_BASE}/webcast/feed?apiKey=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel_id: '87', count: 50, region, max_time: maxTime }),
    });
    if (!signed?.signed_url) break;
    const res = await fetch(signed.signed_url, {
      headers: { ...(signed.headers || {}), cookie: signed.cookies || '' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) break;
    const tiktok = await res.json();
    const page = (tiktok?.data || [])
      .map((entry) => entry?.data || entry)
      .filter((r) => r && (r.owner || r.id_str));
    rooms.push(...page);
    maxTime = tiktok?.extra?.max_time || tiktok?.data?.extra?.max_time;
    if (!maxTime || !page.length) break;
    await sleep(400);
  }
  return rooms.map((raw, i) => normalizeUser(raw, i));
}

async function fetchLeaderboard() {
  const byUsername = new Map();
  const sources = [];
  const errors = [];

  const addAll = (users, label) => {
    let added = 0;
    for (const u of users) {
      const key = u.username.toLowerCase();
      const prev = byUsername.get(key);
      if (!prev || u.score > prev.score || (!prev.region && u.region)) {
        byUsername.set(key, { ...prev, ...u });
        added++;
      }
    }
    if (added) sources.push(`${label}(${added})`);
  };

  // 1. Ranking global
  try {
    addAll(await fetchTopChannels(), 'top-channels');
  } catch (err) {
    errors.push(err.message);
  }

  // 2. Refuerzo por países de Latinoamérica
  for (const region of LATAM_REGIONS) {
    try {
      addAll(await fetchTopChannels(region), `top-${region}`);
      await sleep(300);
    } catch {
      /* región sin datos o límite alcanzado: seguimos */
    }
  }

  // 3. Si seguimos lejos del top 100, rellenamos con el feed de descubrimiento
  if (byUsername.size < TOP_N) {
    for (const region of ['MX', 'CO', 'AR', 'ES', 'US']) {
      try {
        addAll(await fetchFeedRooms(region, 2), `feed-${region}`);
        if (byUsername.size >= TOP_N * 2) break;
        await sleep(400);
      } catch {
        /* el feed requiere tier Basic: si no está disponible, lo omitimos */
      }
    }
  }

  if (!byUsername.size) {
    throw new Error(errors[0] || 'No se pudo obtener el leaderboard');
  }

  const users = [...byUsername.values()]
    .sort((a, b) => (b.score - a.score) || (b.viewers - a.viewers))
    .map((u, i) => ({ ...u, rank: i + 1 }));
  return { users, source: sources.join('+') };
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
let diskCacheLoaded = false;

app.get('/api/leaderboard', async (req, res) => {
  // En serverless no hay temporizador: refrescamos bajo demanda si la caché caducó
  if (IS_VERCEL) {
    if (!diskCacheLoaded) {
      diskCacheLoaded = true;
      await loadCacheFromDisk();
    }
    if (!cache.users.length) {
      await refreshLeaderboard();
    } else if (Date.now() - cache.updatedAt >= REFRESH_INTERVAL_MS) {
      refreshLeaderboard(); // recarga en segundo plano, servimos la caché actual
    }
  }
  res.json({
    success: cache.users.length > 0,
    updatedAt: cache.updatedAt ? new Date(cache.updatedAt).toISOString() : null,
    nextRefresh: cache.updatedAt ? new Date(cache.updatedAt + REFRESH_INTERVAL_MS).toISOString() : null,
    total: cache.users.length,
    source: cache.source,
    regions: [...new Set(cache.users.map((u) => u.region).filter(Boolean))].sort(),
    users: cache.users,
  });
});

app.post('/api/leaderboard/refresh', async (req, res) => {
  await refreshLeaderboard(true);
  res.json({ success: cache.users.length > 0, total: cache.users.length });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cachedUsers: cache.users.length,
    uptime: Math.floor(process.uptime()),
    monitors: monitorsEnabled ? monitors.list().length : 'no disponible en serverless',
  });
});

// ---------------------------------------------------------------------------
// Monitor LIVE en segundo plano (conexión permanente con reconexión infinita)
// ---------------------------------------------------------------------------
const monitorsEnabled = !IS_VERCEL;
const monitors = monitorsEnabled
  ? new (await import('./lib/monitors.js')).MonitorManager({ apiKey: API_KEY, apiBase: API_BASE })
  : null;

function requireMonitors(req, res) {
  if (monitorsEnabled) return true;
  res.status(501).json({
    success: false,
    error: 'El monitor en segundo plano necesita un servidor persistente (Fly.io, Docker o local). Vercel serverless no mantiene WebSockets abiertos.',
  });
  return false;
}

app.get('/api/monitors', (req, res) => {
  if (!requireMonitors(req, res)) return;
  res.json({ success: true, monitors: monitors.list() });
});

app.post('/api/monitor/:username/start', (req, res) => {
  if (!requireMonitors(req, res)) return;
  try {
    res.json({ success: true, monitor: monitors.start(req.params.username) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/monitor/:username/stop', (req, res) => {
  if (!requireMonitors(req, res)) return;
  res.json({ success: monitors.stop(req.params.username) });
});

app.get('/api/monitor/:username/state', (req, res) => {
  if (!requireMonitors(req, res)) return;
  const state = monitors.get(req.params.username);
  if (!state) return res.status(404).json({ success: false, error: 'Monitor no encontrado' });
  res.json({ success: true, monitor: state });
});

// Server-Sent Events: flujo continuo de eventos del directo hacia el navegador
app.get('/api/monitor/:username/events', (req, res) => {
  if (!requireMonitors(req, res)) return;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const unsubscribe = monitors.subscribe(req.params.username, send);
  if (!unsubscribe) {
    send({ type: 'error', data: { message: 'Monitor no encontrado. Inícialo primero.' } });
    return res.end();
  }
  // heartbeat para que proxies/navegador no corten la conexión
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// Herramientas: proxies de todos los endpoints REST de tik.tools
// (la API key nunca sale del servidor)
// ---------------------------------------------------------------------------
async function proxyTikTools(res, path, { method = 'GET', query = {}, body = null } = {}) {
  try {
    const params = new URLSearchParams({ apiKey: API_KEY });
    for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
    const r = await fetch(`${API_BASE}${path}?${params}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const json = await r.json().catch(() => ({}));
    res.status(r.ok ? 200 : r.status).json(json);
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
}

app.get('/api/tools/check-alive', (req, res) =>
  proxyTikTools(res, '/webcast/check_alive', { query: { unique_id: req.query.user } }));

app.post('/api/tools/bulk-live-check', (req, res) =>
  proxyTikTools(res, '/webcast/bulk_live_check', { method: 'POST', body: { unique_ids: req.body.users || [] } }));

app.get('/api/tools/room-info', (req, res) =>
  proxyTikTools(res, '/webcast/room_info', { method: 'POST', body: { unique_id: req.query.user } }));

app.get('/api/tools/room-video', (req, res) =>
  proxyTikTools(res, '/webcast/room_video', { method: 'POST', body: { unique_id: req.query.user } }));

app.get('/api/tools/rankings', (req, res) =>
  proxyTikTools(res, '/webcast/rankings', { query: { unique_id: req.query.user } }));

app.get('/api/tools/gift-info', (req, res) => proxyTikTools(res, '/webcast/gift_info'));

app.get('/api/tools/hashtags', (req, res) => proxyTikTools(res, '/webcast/hashtag_list'));

app.get('/api/tools/rate-limits', (req, res) => proxyTikTools(res, '/webcast/rate_limits'));

app.get('/api/tools/room-cover', (req, res) =>
  proxyTikTools(res, '/webcast/room_cover', { query: { unique_id: req.query.user } }));

if (!IS_VERCEL) {
  app.listen(PORT, async () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
    if (!API_KEY) console.warn('AVISO: falta TIK_TOOLS_API_KEY en el entorno (.env)');
    await loadCacheFromDisk();
    await refreshLeaderboard();
    setInterval(refreshLeaderboard, CHECK_INTERVAL_MS);
  });
}

export default app;
