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

async function searchYoutube(query) {
  if (!YOUTUBE_API_KEY) throw new Error('missing-api-key');
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
 *   users: Map<socketId, { name, color, cam, mic, screen }>,
 *   createdAt: number,
 *   vbrowser: { sessionId, embedUrl } | null,
 * }>
 */
const rooms = new Map();

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      video: null,
      isPlaying: false,
      currentTime: 0,
      lastUpdate: Date.now(),
      users: new Map(),
      createdAt: Date.now(),
      vbrowser: null,
    };
    rooms.set(roomId, room);
  }
  return room;
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
  }));
}

function parseVideoInput(input) {
  const trimmed = (input || '').trim();
  const ytMatch = trimmed.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  if (ytMatch) {
    return { type: 'youtube', url: trimmed, youtubeId: ytMatch[1], title: 'YouTube video' };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { type: 'video', url: trimmed, youtubeId: null, title: trimmed.split('/').pop() || trimmed };
  }
  return null;
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
    currentRoomId = roomId;
    socket.join(roomId);

    const safeName = (name || 'Guest').toString().slice(0, 24).trim() || 'Guest';
    const color = colorForSocket(socket.id);
    room.users.set(socket.id, { name: safeName, color, cam: false, mic: false, screen: false });

    if (typeof cb === 'function') {
      cb({
        roomId,
        you: { id: socket.id, name: safeName, color },
        video: room.video,
        isPlaying: room.isPlaying,
        currentTime: estimatedCurrentTime(room),
        users: roomUserList(room),
        vbrowser: room.vbrowser ? { embedUrl: room.vbrowser.embedUrl } : null,
      });
    }

    socket.to(roomId).emit('user-joined', { id: socket.id, name: safeName, color });
    io.to(roomId).emit('user-list', roomUserList(room));
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
      const message = err.message === 'missing-api-key'
        ? 'La búsqueda de YouTube no está configurada en el servidor (falta YOUTUBE_API_KEY).'
        : 'No se pudo buscar en YouTube.';
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
    room.users.delete(socket.id);
    socket.to(currentRoomId).emit('user-left', { id: socket.id });
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
