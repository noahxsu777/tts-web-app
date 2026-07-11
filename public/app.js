(function () {
  const socket = io();
  const el = (id) => document.getElementById(id);

  // ---- DOM refs ----
  const landing = el('landing');
  const roomEl = el('room');
  const nameInput = el('name-input');
  const createBtn = el('create-room-btn');
  const joinCodeInput = el('join-code-input');
  const joinBtn = el('join-room-btn');
  const landingError = el('landing-error');

  const roomCodeText = el('room-code-text');
  const roomCodeBtn = el('room-code-btn');
  const avatarStack = el('avatar-stack');
  const leaveBtn = el('leave-btn');

  const videoEmpty = el('video-empty');
  const youtubeContainer = el('youtube-player');
  const videoElement = el('video-player');
  const reactionLayer = el('reaction-layer');
  const videoForm = el('video-form');
  const videoUrlInput = el('video-url-input');

  const chatMessages = el('chat-messages');
  const chatForm = el('chat-form');
  const chatInput = el('chat-input');
  const peopleList = el('people-list');
  const peopleCount = el('people-count');

  const panelTabs = document.querySelectorAll('.panel-tab');
  const tabChat = el('tab-chat');
  const tabPeople = el('tab-people');

  const toastEl = el('toast');

  // ---- State ----
  const state = {
    roomId: null,
    myId: null,
    users: [],
    video: null,
  };

  let ytPlayer = null;
  let ytReady = false;
  let pendingYt = null;
  let suppressYt = false;
  let suppressVideoEl = false;
  let syncInterval = null;

  window.onYouTubeIframeAPIReady = function () {
    ytReady = true;
    if (pendingYt) {
      createYoutubePlayer(pendingYt.videoId, pendingYt.startTime, pendingYt.playing);
      pendingYt = null;
    }
  };

  const savedName = localStorage.getItem('wp_name');
  if (savedName) nameInput.value = savedName;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 2200);
  }

  function showError(msg) {
    landingError.textContent = msg;
    landingError.classList.remove('hidden');
  }

  // ---- Landing actions ----
  createBtn.addEventListener('click', () => {
    const name = (nameInput.value || 'Guest').trim() || 'Guest';
    localStorage.setItem('wp_name', name);
    socket.emit('create-room', ({ roomId }) => enterRoom(roomId, name));
  });

  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });
  joinBtn.addEventListener('click', () => attemptJoin());
  joinCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptJoin(); });

  function attemptJoin() {
    const code = (joinCodeInput.value || '').trim().toUpperCase();
    const name = (nameInput.value || 'Guest').trim() || 'Guest';
    if (!code) { showError('Ingresa un código de sala'); return; }
    localStorage.setItem('wp_name', name);
    enterRoom(code, name);
  }

  function enterRoom(roomId, name) {
    socket.emit('join-room', { roomId, name }, (res) => {
      if (!res || res.error) { showError('No se pudo unir a la sala. Verifica el código.'); return; }
      state.roomId = res.roomId;
      state.myId = res.you.id;
      state.users = res.users;
      state.video = res.video;

      landing.classList.add('hidden');
      roomEl.classList.remove('hidden');
      roomCodeText.textContent = res.roomId;
      history.replaceState(null, '', `/room/${res.roomId}`);

      renderPeople();
      if (res.video) loadVideo(res.video, res.currentTime, res.isPlaying);
      startSyncLoop();
    });
  }

  // ---- Room header ----
  roomCodeBtn.addEventListener('click', async () => {
    const link = `${location.origin}/room/${state.roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast('Enlace copiado ✔');
    } catch {
      showToast(link);
    }
  });

  leaveBtn.addEventListener('click', () => { location.href = '/'; });

  // ---- Tabs ----
  panelTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      panelTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      tabChat.classList.toggle('hidden', which !== 'chat');
      tabPeople.classList.toggle('hidden', which !== 'people');
    });
  });

  // ---- People rendering ----
  function initialsFor(name) {
    return (name || '?').trim().slice(0, 2).toUpperCase();
  }

  function renderPeople() {
    avatarStack.innerHTML = '';
    state.users.slice(0, 5).forEach((u) => {
      const av = document.createElement('div');
      av.className = 'avatar';
      av.style.background = u.color;
      av.textContent = initialsFor(u.name);
      av.title = u.name;
      avatarStack.appendChild(av);
    });

    peopleCount.textContent = state.users.length;
    peopleList.innerHTML = '';
    state.users.forEach((u) => {
      const li = document.createElement('li');
      li.className = 'person-row';
      const av = document.createElement('div');
      av.className = 'avatar';
      av.style.background = u.color;
      av.textContent = initialsFor(u.name);
      const name = document.createElement('span');
      name.className = 'person-name';
      name.textContent = u.name;
      li.appendChild(av);
      li.appendChild(name);
      if (u.id === state.myId) {
        const you = document.createElement('span');
        you.className = 'person-you';
        you.textContent = '(tú)';
        li.appendChild(you);
      }
      peopleList.appendChild(li);
    });
  }

  // ---- Chat ----
  function appendChatMessage({ name, color, message, system }) {
    const div = document.createElement('div');
    if (system) {
      div.className = 'chat-msg system';
      div.textContent = message;
    } else {
      div.className = 'chat-msg';
      const author = document.createElement('span');
      author.className = 'author';
      author.style.color = color;
      author.textContent = name + ':';
      const text = document.createElement('span');
      text.className = 'msg-text';
      text.textContent = message;
      div.appendChild(author);
      div.appendChild(text);
    }
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat', { roomId: state.roomId, message: text });
    chatInput.value = '';
  });

  // ---- Reactions ----
  document.querySelectorAll('.reaction-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      socket.emit('reaction', { roomId: state.roomId, emoji });
      spawnReaction(emoji);
    });
  });

  function spawnReaction(emoji) {
    const span = document.createElement('span');
    span.className = 'floating-emoji';
    span.textContent = emoji;
    span.style.left = `${10 + Math.random() * 80}%`;
    reactionLayer.appendChild(span);
    setTimeout(() => span.remove(), 2700);
  }

  // ---- Video loading ----
  videoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = videoUrlInput.value.trim();
    if (!input) return;
    socket.emit('set-video', { roomId: state.roomId, input });
    videoUrlInput.value = '';
  });

  function destroyPlayers() {
    if (ytPlayer && ytPlayer.destroy) {
      try { ytPlayer.destroy(); } catch (e) { /* noop */ }
      ytPlayer = null;
    }
    videoElement.onplay = null;
    videoElement.onpause = null;
    videoElement.onseeked = null;
    videoElement.pause();
    videoElement.removeAttribute('src');
    videoElement.load();
    youtubeContainer.classList.add('hidden');
    videoElement.classList.add('hidden');
    youtubeContainer.innerHTML = '';
  }

  function loadVideo(video, startTime, playing) {
    state.video = video;
    videoEmpty.classList.add('hidden');
    destroyPlayers();

    if (video.type === 'youtube') {
      youtubeContainer.classList.remove('hidden');
      if (ytReady) {
        createYoutubePlayer(video.youtubeId, startTime, playing);
      } else {
        pendingYt = { videoId: video.youtubeId, startTime, playing };
      }
    } else if (video.type === 'video') {
      videoElement.classList.remove('hidden');
      videoElement.src = video.url;
      videoElement.currentTime = startTime || 0;
      attachVideoElementHandlers();
      if (playing) {
        suppressVideoEl = true;
        videoElement.play().catch(() => {}).finally(() => { suppressVideoEl = false; });
      }
    }
  }

  function createYoutubePlayer(videoId, startTime, playing) {
    ytPlayer = new YT.Player('youtube-player', {
      videoId,
      playerVars: { autoplay: playing ? 1 : 0, start: Math.floor(startTime || 0), rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          if (startTime) ytPlayer.seekTo(startTime, true);
          if (playing) ytPlayer.playVideo();
        },
        onStateChange: onYtStateChange,
      },
    });
  }

  function onYtStateChange(e) {
    if (suppressYt || !state.roomId) return;
    if (e.data === YT.PlayerState.PLAYING) {
      socket.emit('play', { roomId: state.roomId, currentTime: ytPlayer.getCurrentTime() });
    } else if (e.data === YT.PlayerState.PAUSED) {
      socket.emit('pause', { roomId: state.roomId, currentTime: ytPlayer.getCurrentTime() });
    }
  }

  function attachVideoElementHandlers() {
    videoElement.onplay = () => {
      if (suppressVideoEl) return;
      socket.emit('play', { roomId: state.roomId, currentTime: videoElement.currentTime });
    };
    videoElement.onpause = () => {
      if (suppressVideoEl) return;
      socket.emit('pause', { roomId: state.roomId, currentTime: videoElement.currentTime });
    };
    videoElement.onseeked = () => {
      if (suppressVideoEl) return;
      socket.emit('seek', { roomId: state.roomId, currentTime: videoElement.currentTime });
    };
  }

  function withSuppressed(flagSetter, fn) {
    flagSetter(true);
    try { fn(); } finally {
      setTimeout(() => flagSetter(false), 400);
    }
  }

  // ---- Periodic time report while playing, keeps late joiners in sync ----
  function startSyncLoop() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
      if (!state.video) return;
      let t = null;
      if (state.video.type === 'youtube' && ytPlayer && ytPlayer.getCurrentTime) {
        t = ytPlayer.getCurrentTime();
      } else if (state.video.type === 'video') {
        t = videoElement.currentTime;
      }
      if (t != null) socket.emit('sync-time', { roomId: state.roomId, currentTime: t });
    }, 4000);
  }

  // ---- Socket events ----
  socket.on('user-joined', (u) => {
    if (!state.users.find((x) => x.id === u.id)) state.users.push(u);
    renderPeople();
    appendChatMessage({ system: true, message: `${u.name} se unió a la sala` });
  });

  socket.on('user-left', ({ id }) => {
    const u = state.users.find((x) => x.id === id);
    state.users = state.users.filter((x) => x.id !== id);
    renderPeople();
    if (u) appendChatMessage({ system: true, message: `${u.name} salió de la sala` });
  });

  socket.on('user-list', (users) => {
    state.users = users;
    renderPeople();
  });

  socket.on('video-changed', ({ video }) => loadVideo(video, 0, false));

  socket.on('play', ({ currentTime }) => {
    if (!state.video) return;
    if (state.video.type === 'youtube' && ytPlayer) {
      withSuppressed((v) => (suppressYt = v), () => {
        if (typeof currentTime === 'number') ytPlayer.seekTo(currentTime, true);
        ytPlayer.playVideo();
      });
    } else if (state.video.type === 'video') {
      withSuppressed((v) => (suppressVideoEl = v), () => {
        if (typeof currentTime === 'number') videoElement.currentTime = currentTime;
        videoElement.play().catch(() => {});
      });
    }
  });

  socket.on('pause', ({ currentTime }) => {
    if (!state.video) return;
    if (state.video.type === 'youtube' && ytPlayer) {
      withSuppressed((v) => (suppressYt = v), () => {
        ytPlayer.pauseVideo();
        if (typeof currentTime === 'number') ytPlayer.seekTo(currentTime, true);
      });
    } else if (state.video.type === 'video') {
      withSuppressed((v) => (suppressVideoEl = v), () => {
        videoElement.pause();
        if (typeof currentTime === 'number') videoElement.currentTime = currentTime;
      });
    }
  });

  socket.on('seek', ({ currentTime }) => {
    if (!state.video) return;
    if (state.video.type === 'youtube' && ytPlayer) {
      withSuppressed((v) => (suppressYt = v), () => ytPlayer.seekTo(currentTime, true));
    } else if (state.video.type === 'video') {
      withSuppressed((v) => (suppressVideoEl = v), () => { videoElement.currentTime = currentTime; });
    }
  });

  socket.on('chat', ({ name, color, message }) => appendChatMessage({ name, color, message }));
  socket.on('reaction', ({ emoji }) => spawnReaction(emoji));

  // ---- Auto-join from shared link ----
  const roomMatch = location.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})/);
  if (roomMatch) {
    const code = roomMatch[1].toUpperCase();
    joinCodeInput.value = code;
    if (savedName) enterRoom(code, savedName);
  }
})();
