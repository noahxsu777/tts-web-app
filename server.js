import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const HYPERBEAM_API_KEY = process.env.HYPERBEAM_API_KEY || '';
const HYPERBEAM_API_BASE = 'https://engine.hyperbeam.com/v0';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

/**
 * Starts a shared Hyperbeam virtual-browser VM. Returns the raw REST response
 * ({ session_id, embed_url, admin_token }, per Hyperbeam's REST API docs at
 * https://docs.hyperbeam.com/rest-api). timeout.inactive is a safety net so a
 * forgotten session doesn't keep billing if our own cleanup logic ever misses it.
 */
async function startHyperbeamSession() {
  if (!HYPERBEAM_API_KEY) {
    throw new Error('missing-api-key');
  }
  const res = await fetch(`${HYPERBEAM_API_BASE}/vm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HYPERBEAM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ timeout: { inactive: 600 } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`hyperbeam-${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function stopHyperbeamSession(sessionId) {
  if (!HYPERBEAM_API_KEY || !sessionId) return;
  try {
    await fetch(`${HYPERBEAM_API_BASE}/vm/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${HYPERBEAM_API_KEY}` },
    });
  } catch (err) {
    console.error('Failed to stop Hyperbeam session', sessionId, err);
  }
}

async function searchYoutubeApi(query) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&q=${encodeURIComponent(query)}&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`youtube-${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.items || [])
    .filter((item) => item.id && item.id.videoId)
    .map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet?.title || 'Video de YouTube',
      channel: item.snippet?.channelTitle || '',
      thumbnail: item.snippet?.thumbnails?.default?.url || '',
    }));
}

/**
 * Falls back to YouTube's own public search results page (the same HTML a
 * browser gets, no auth) when no Data API key is configured, so search works
 * out of the box. Pulls the videoRenderer entries out of the ytInitialData
 * blob YouTube embeds in the page; this is unofficial and can break if
 * YouTube changes that markup, hence the official API is always preferred
 * when a key is present.
 */
async function searchYoutubeScrape(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`scrape-${res.status}`);
  const html = await res.text();
  const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
  if (!match) throw new Error('scrape-parse-failed');
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    throw new Error('scrape-parse-failed');
  }
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
    ?.sectionListRenderer?.contents || [];
  const results = [];
  for (const section of sections) {
    for (const item of section?.itemSectionRenderer?.contents || []) {
      const vr = item.videoRenderer;
      if (!vr?.videoId) continue;
      results.push({
        videoId: vr.videoId,
        title: (vr.title?.runs || []).map((r) => r.text).join('') || 'Video de YouTube',
        channel: vr.ownerText?.runs?.[0]?.text || '',
        thumbnail: vr.thumbnail?.thumbnails?.[0]?.url || '',
      });
      if (results.length >= 8) return results;
    }
  }
  return results;
}

async function searchYoutube(query) {
  if (YOUTUBE_API_KEY) {
    try {
      return await searchYoutubeApi(query);
    } catch (err) {
      console.error('YouTube Data API search failed, falling back to page scrape:', err.message);
    }
  }
  return searchYoutubeScrape(query);
}

const ROOM_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRoomId() {
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)];
  }
  return id;
}

const USER_COLORS = [
  '#7c6cf6', '#f6779c', '#5fd0c0', '#f6b25f',
  '#6ca9f6', '#f66c6c', '#a7e05a', '#e07af7',
];
function colorForSocket(socketId) {
  let hash = 0;
  for (let i = 0; i < socketId.length; i++) hash = (hash * 31 + socketId.charCodeAt(i)) >>> 0;
  return USER_COLORS[hash % USER_COLORS.length];
}

/**
 * rooms: Map<roomId, {
 *   video: { type: 'youtube'|'video'|null, url, youtubeId, title } | null,
 *   isPlaying: boolean,
 *   currentTime: number,
 *   lastUpdate: number, // ms epoch, used to extrapolate currentTime for late joiners
 *   users: Map<socketId, { name, color, cam, mic, screen, role }>,
 *   hostId: string|null, // socket id of the current host, re-assigned when the host leaves
 *   kicked: Set<string>, // names blocked from rejoining after being expelled, cleared when room empties
 *   createdAt: number,
 *   vbrowser: { sessionId, embedUrl } | null,
 * }>
 */
const rooms = new Map();

// 'host' can kick/promote anyone; 'moderator' can kick guests; 'guest' has no moderation rights.
const ROLES = ['host', 'moderator', 'guest'];

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      video: null,
      isPlaying: false,
      currentTime: 0,
      lastUpdate: Date.now(),
      users: new Map(),
      hostId: null,
      kicked: new Set(),
      createdAt: Date.now(),
      vbrowser: null,
    };
    rooms.set(roomId, room);
  }
  return room;
}

function canModerate(actorRole, targetRole) {
  if (actorRole === 'host') return targetRole !== 'host';
  if (actorRole === 'moderator') return targetRole === 'guest';
  return false;
}

function estimatedCurrentTime(room) {
  if (!room.isPlaying) return room.currentTime;
  const elapsed = (Date.now() - room.lastUpdate) / 1000;
  return room.currentTime + elapsed;
}

function roomUserList(room) {
  return [...room.users.entries()].map(([id, u]) => ({
    id,
    name: u.name,
    color: u.color,
    cam: !!u.cam,
    mic: !!u.mic,
    screen: !!u.screen,
    role: u.role,
  }));
}

function announce(io, roomId, message) {
  io.to(roomId).emit('system-message', { message });
}

/** Hands the host role to the longest-standing moderator, or else the longest-standing guest. */
function reassignHost(room) {
  const remaining = [...room.users.entries()];
  if (!remaining.length) { room.hostId = null; return null; }
  const next = remaining.find(([, u]) => u.role === 'moderator') || remaining[0];
  const [nextId, nextUser] = next;
  nextUser.role = 'host';
  room.hostId = nextId;
  return { id: nextId, name: nextUser.name };
}

function parseVideoInput(input) {
  const trimmed = (input || '').trim();
  const ytMatch = trimmed.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  if (ytMatch) {
    return { type: 'youtube', url: trimmed, youtubeId: ytMatch[1], title: 'YouTube video' };
  }
  if (/^https?:\/\//i.test(trimmed) && /\.m3u8(?:[?#]|$)/i.test(trimmed)) {
    return { type: 'hls', url: trimmed, youtubeId: null, title: trimmed.split('/').pop() || 'Canal en vivo' };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { type: 'video', url: trimmed, youtubeId: null, title: trimmed.split('/').pop() || trimmed };
  }
  return null;
}

// IPTV-style .m3u playlists are plain text and can list thousands of channels;
// cap both the download size and the parsed channel count to keep this cheap.
const M3U_MAX_BYTES = 2 * 1024 * 1024;
const M3U_MAX_CHANNELS = 300;

async function fetchM3uChannels(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('invalid-url');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch-${res.status}`);
  const reader = res.body?.getReader ? res.body.getReader() : null;
  let text;
  if (reader) {
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > M3U_MAX_BYTES) { reader.cancel(); throw new Error('too-large'); }
      chunks.push(value);
    }
    text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  } else {
    text = await res.text();
  }
  return parseM3uText(text);
}

function parseM3uText(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let pendingTitle = null;
  let pendingLogo = '';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const titleMatch = line.match(/,(.*)$/);
      pendingTitle = titleMatch ? titleMatch[1].trim() : null;
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      pendingLogo = logoMatch ? logoMatch[1] : '';
      continue;
    }
    if (line.startsWith('#')) continue;
    if (/^https?:\/\//i.test(line)) {
      channels.push({ title: pendingTitle || line.split('/').pop() || 'Canal', url: line, logo: pendingLogo });
      pendingTitle = null;
      pendingLogo = '';
      if (channels.length >= M3U_MAX_CHANNELS) break;
    }
  }
  return channels;
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('create-room', (cb) => {
    let roomId;
    do { roomId = generateRoomId(); } while (rooms.has(roomId));
    getOrCreateRoom(roomId);
    if (typeof cb === 'function') cb({ roomId });
  });

  socket.on('join-room', ({ roomId, name }, cb) => {
    if (!roomId || typeof roomId !== 'string') {
      if (typeof cb === 'function') cb({ error: 'invalid-room' });
      return;
    }
    roomId = roomId.toUpperCase();
    const room = getOrCreateRoom(roomId);

    const safeName = (name || 'Guest').toString().slice(0, 24).trim() || 'Guest';
    if (room.kicked.has(safeName.toLowerCase())) {
      if (typeof cb === 'function') cb({ error: 'kicked' });
      return;
    }

    currentRoomId = roomId;
    socket.join(roomId);

    const color = colorForSocket(socket.id);
    const role = room.hostId ? 'guest' : 'host';
    room.users.set(socket.id, { name: safeName, color, cam: false, mic: false, screen: false, role });
    if (role === 'host') room.hostId = socket.id;

    if (typeof cb === 'function') {
      cb({
        roomId,
        you: { id: socket.id, name: safeName, color, role },
        video: room.video,
        isPlaying: room.isPlaying,
        currentTime: estimatedCurrentTime(room),
        users: roomUserList(room),
        vbrowser: room.vbrowser ? { embedUrl: room.vbrowser.embedUrl } : null,
      });
    }

    socket.to(roomId).emit('user-joined', { id: socket.id, name: safeName, color, role });
    io.to(roomId).emit('user-list', roomUserList(room));
  });

  socket.on('kick-user', ({ roomId, targetId }, cb) => {
    const room = rooms.get(roomId);
    if (!room) { if (typeof cb === 'function') cb({ error: 'Sala no encontrada.' }); return; }
    const actor = room.users.get(socket.id);
    const target = room.users.get(targetId);
    if (!actor || !target) { if (typeof cb === 'function') cb({ error: 'Usuario no encontrado.' }); return; }
    if (targetId === socket.id || !canModerate(actor.role, target.role)) {
      if (typeof cb === 'function') cb({ error: 'No tienes permiso para expulsar a este usuario.' });
      return;
    }

    room.users.delete(targetId);
    room.kicked.add(target.name.toLowerCase());
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit('kicked', { by: actor.name });
      targetSocket.leave(roomId);
    }
    io.to(roomId).emit('user-left', { id: targetId });
    io.to(roomId).emit('user-list', roomUserList(room));
    announce(io, roomId, `${actor.name} expulsó a ${target.name} de la sala.`);
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('set-role', ({ roomId, targetId, role }, cb) => {
    const room = rooms.get(roomId);
    if (!room) { if (typeof cb === 'function') cb({ error: 'Sala no encontrada.' }); return; }
    const actor = room.users.get(socket.id);
    const target = room.users.get(targetId);
    if (!actor || !target || actor.role !== 'host' || targetId === socket.id) {
      if (typeof cb === 'function') cb({ error: 'No tienes permiso para hacer esto.' });
      return;
    }
    if (!['moderator', 'guest'].includes(role)) {
      if (typeof cb === 'function') cb({ error: 'Rol inválido.' });
      return;
    }
    target.role = role;
    io.to(roomId).emit('user-list', roomUserList(room));
    announce(io, roomId, role === 'moderator'
      ? `${actor.name} nombró a ${target.name} moderador.`
      : `${actor.name} quitó a ${target.name} de moderador.`);
    if (typeof cb === 'function') cb({ ok: true });
  });

  socket.on('set-video', ({ roomId, input }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const video = parseVideoInput(input);
    if (!video) return;
    room.video = video;
    room.isPlaying = false;
    room.currentTime = 0;
    room.lastUpdate = Date.now();
    io.to(roomId).emit('video-changed', { video });
  });

  socket.on('youtube-search', async ({ query }, cb) => {
    if (typeof cb !== 'function') return;
    const q = (query || '').toString().trim().slice(0, 100);
    if (!q) { cb({ results: [] }); return; }
    try {
      const results = await searchYoutube(q);
      cb({ results });
    } catch (err) {
      console.error('youtube-search failed:', err.message);
      cb({ error: 'No se pudo buscar en YouTube.' });
    }
  });

  socket.on('load-playlist', async ({ url }, cb) => {
    if (typeof cb !== 'function') return;
    const trimmed = (url || '').toString().trim();
    if (!trimmed) { cb({ error: 'Enlace vacío.' }); return; }
    try {
      const channels = await fetchM3uChannels(trimmed);
      if (!channels.length) { cb({ error: 'No se encontraron canales en esta lista.' }); return; }
      cb({ channels });
    } catch (err) {
      console.error('load-playlist failed:', err.message);
      const message = err.message === 'too-large'
        ? 'La lista m3u es demasiado grande.'
        : 'No se pudo cargar la lista m3u.';
      cb({ error: message });
    }
  });

  socket.on('play', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.isPlaying = true;
    room.currentTime = currentTime || 0;
    room.lastUpdate = Date.now();
    socket.to(roomId).emit('play', { currentTime: room.currentTime });
  });

  socket.on('pause', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.isPlaying = false;
    room.currentTime = currentTime || 0;
    room.lastUpdate = Date.now();
    socket.to(roomId).emit('pause', { currentTime: room.currentTime });
  });

  socket.on('seek', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.currentTime = currentTime || 0;
    room.lastUpdate = Date.now();
    socket.to(roomId).emit('seek', { currentTime: room.currentTime });
  });

  socket.on('sync-time', ({ roomId, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room || !room.isPlaying) return;
    room.currentTime = currentTime || 0;
    room.lastUpdate = Date.now();
  });

  socket.on('chat', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user) return;
    const text = (message || '').toString().slice(0, 500).trim();
    if (!text) return;
    io.to(roomId).emit('chat', {
      id: socket.id,
      name: user.name,
      color: user.color,
      message: text,
      time: Date.now(),
    });
  });

  socket.on('reaction', ({ roomId, emoji }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user) return;
    const allowed = ['👍', '❤️', '😂', '😮', '🎉', '👏'];
    if (!allowed.includes(emoji)) return;
    io.to(roomId).emit('reaction', { name: user.name, color: user.color, emoji });
  });

  // ---- WebRTC (camera / mic / screen share) ----
  socket.on('media-state', ({ roomId, cam, mic, screen }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user) return;
    if (typeof cam === 'boolean') user.cam = cam;
    if (typeof mic === 'boolean') user.mic = mic;
    if (typeof screen === 'boolean') user.screen = screen;
    io.to(roomId).emit('user-list', roomUserList(room));
  });

  // Relays WebRTC offers/answers/ICE candidates directly between two peers in
  // the same room; the server never inspects the SDP/candidate payload.
  socket.on('rtc-signal', ({ roomId, to, signal }) => {
    const room = rooms.get(roomId);
    if (!room || !room.users.has(socket.id) || !room.users.has(to)) return;
    io.to(to).emit('rtc-signal', { from: socket.id, signal });
  });

  // ---- Shared virtual browser (Hyperbeam) ----
  socket.on('vbrowser-start', async ({ roomId }, cb) => {
    const room = rooms.get(roomId);
    if (!room) { if (typeof cb === 'function') cb({ error: 'Sala no encontrada.' }); return; }
    if (room.vbrowser) {
      if (typeof cb === 'function') cb({ embedUrl: room.vbrowser.embedUrl });
      return;
    }
    try {
      const session = await startHyperbeamSession();
      // Re-check the room still exists / is still empty of a session in case of a race.
      if (!rooms.has(roomId) || rooms.get(roomId).vbrowser) {
        stopHyperbeamSession(session.session_id);
        if (typeof cb === 'function') cb({ embedUrl: rooms.get(roomId)?.vbrowser?.embedUrl });
        return;
      }
      room.vbrowser = { sessionId: session.session_id, embedUrl: session.embed_url };
      socket.to(roomId).emit('vbrowser-started', { embedUrl: session.embed_url });
      if (typeof cb === 'function') cb({ embedUrl: session.embed_url, adminToken: session.admin_token });
    } catch (err) {
      console.error('vbrowser-start failed:', err.message);
      const message = err.message === 'missing-api-key'
        ? 'El navegador virtual no está configurado en el servidor (falta HYPERBEAM_API_KEY).'
        : 'No se pudo iniciar el navegador virtual.';
      if (typeof cb === 'function') cb({ error: message });
    }
  });

  socket.on('vbrowser-stop', async ({ roomId }, cb) => {
    const room = rooms.get(roomId);
    if (!room || !room.vbrowser) { if (typeof cb === 'function') cb({ ok: true }); return; }
    const sessionId = room.vbrowser.sessionId;
    room.vbrowser = null;
    io.to(roomId).emit('vbrowser-stopped');
    if (typeof cb === 'function') cb({ ok: true });
    await stopHyperbeamSession(sessionId);
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const wasHost = room.hostId === socket.id;
    room.users.delete(socket.id);
    socket.to(currentRoomId).emit('user-left', { id: socket.id });
    if (wasHost) {
      const newHost = reassignHost(room);
      if (newHost) announce(io, currentRoomId, `${newHost.name} es ahora el anfitrión de la sala.`);
    }
    io.to(currentRoomId).emit('user-list', roomUserList(room));
    if (room.users.size === 0) {
      if (room.vbrowser) {
        stopHyperbeamSession(room.vbrowser.sessionId);
        room.vbrowser = null;
      }
      setTimeout(() => {
        const r = rooms.get(currentRoomId);
        if (r && r.users.size === 0) rooms.delete(currentRoomId);
      }, 5 * 60 * 1000);
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, timestamp: new Date().toISOString() });
});

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`WatchParty server listening on port ${PORT}`);
});
