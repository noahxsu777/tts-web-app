import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

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
 *   users: Map<socketId, { name, color }>,
 *   createdAt: number,
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
  return [...room.users.entries()].map(([id, u]) => ({ id, name: u.name, color: u.color }));
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
    room.users.set(socket.id, { name: safeName, color });

    if (typeof cb === 'function') {
      cb({
        roomId,
        you: { id: socket.id, name: safeName, color },
        video: room.video,
        isPlaying: room.isPlaying,
        currentTime: estimatedCurrentTime(room),
        users: roomUserList(room),
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

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.users.delete(socket.id);
    socket.to(currentRoomId).emit('user-left', { id: socket.id });
    io.to(currentRoomId).emit('user-list', roomUserList(room));
    if (room.users.size === 0) {
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
