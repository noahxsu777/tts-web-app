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
  const youtubeWrapper = el('youtube-player-wrapper');
  const videoElement = el('video-player');
  const hyperbeamContainer = el('hyperbeam-container');
  const reactionLayer = el('reaction-layer');
  const videoChatStrip = el('video-chat-strip');
  const videoForm = el('video-form');
  const videoUrlInput = el('video-url-input');
  const camBtn = el('cam-btn');
  const micBtn = el('mic-btn');
  const screenBtn = el('screen-btn');
  const vbrowserBtn = el('vbrowser-btn');

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

  // ---- WebRTC state ----
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  const peers = new Map(); // remoteId -> { pc, polite, makingOffer, ignoreOffer }
  const remoteStreamKind = new Map(); // `${remoteId}/${streamId}` -> 'cam' | 'screen'
  let localCamStream = null;
  let localScreenStream = null;
  let camOn = false;
  let micMuted = false;
  let screenOn = false;

  // ---- Hyperbeam (shared virtual browser) state ----
  let HyperbeamCtor = null;
  let hyperbeamClient = null;
  let vbrowserActive = false;
  let vbrowserPending = false;

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

      res.users.forEach((u) => { if (u.id !== state.myId) ensurePeer(u.id); });
      if (res.vbrowser) mountHyperbeam(res.vbrowser.embedUrl);
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
      const badges = document.createElement('span');
      badges.className = 'person-badges';
      if (u.cam) badges.appendChild(document.createTextNode('🎥'));
      if (u.mic === false && u.cam) badges.appendChild(document.createTextNode('🔇'));
      if (u.screen) badges.appendChild(document.createTextNode('🖥️'));
      li.appendChild(badges);
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
    youtubeWrapper.classList.add('hidden');
    videoElement.classList.add('hidden');
    youtubeWrapper.innerHTML = '';
  }

  function loadVideo(video, startTime, playing) {
    state.video = video;
    videoEmpty.classList.add('hidden');
    destroyPlayers();

    if (video.type === 'youtube') {
      youtubeWrapper.classList.remove('hidden');
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
    // The IFrame API replaces (and can destroy) the target element outright, so a
    // fresh child element is created on every load instead of reusing a fixed id —
    // reusing one broke loading a second/different video after the first destroy().
    youtubeWrapper.innerHTML = '';
    const target = document.createElement('div');
    target.id = `yt-target-${Date.now()}`;
    youtubeWrapper.appendChild(target);

    ytPlayer = new YT.Player(target.id, {
      videoId,
      playerVars: {
        autoplay: playing ? 1 : 0,
        start: Math.floor(startTime || 0),
        rel: 0,
        modestbranding: 1,
        origin: location.origin,
      },
      events: {
        onReady: () => {
          if (startTime) ytPlayer.seekTo(startTime, true);
          if (playing) ytPlayer.playVideo();
        },
        onStateChange: onYtStateChange,
        onError: onYtError,
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

  function onYtError(e) {
    const messages = {
      2: 'Enlace de YouTube inválido.',
      5: 'Este video no se puede reproducir embebido.',
      100: 'Video no encontrado o es privado.',
      101: 'El propietario no permite reproducir este video en otros sitios.',
      150: 'El propietario no permite reproducir este video en otros sitios.',
    };
    showToast(messages[e.data] || 'No se pudo cargar el video de YouTube.');
    videoEmpty.classList.remove('hidden');
    destroyPlayers();
    state.video = null;
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
    ensurePeer(u.id);
  });

  socket.on('user-left', ({ id }) => {
    const u = state.users.find((x) => x.id === id);
    state.users = state.users.filter((x) => x.id !== id);
    renderPeople();
    if (u) appendChatMessage({ system: true, message: `${u.name} salió de la sala` });
    closePeer(id);
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

  // ==================================================================
  // WebRTC — mesh camera / mic / screen-share between everyone in a room
  // ==================================================================

  function tileId(ownerId, kind) {
    return `tile-${ownerId}-${kind}`;
  }

  function upsertTile(ownerId, kind, stream, label, { muted } = {}) {
    const id = tileId(ownerId, kind);
    let tile = document.getElementById(id);
    if (!tile) {
      tile = document.createElement('div');
      tile.id = id;
      tile.className = 'video-tile' + (kind === 'screen' ? ' screen' : '');
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      if (muted) video.muted = true;
      tile.appendChild(video);
      const labelEl = document.createElement('div');
      labelEl.className = 'video-tile-label';
      tile.appendChild(labelEl);
      videoChatStrip.appendChild(tile);
    }
    const video = tile.querySelector('video');
    if (video.srcObject !== stream) video.srcObject = stream;
    tile.querySelector('.video-tile-label').textContent = label;
    return tile;
  }

  function removeTile(ownerId, kind) {
    const tile = document.getElementById(tileId(ownerId, kind));
    if (!tile) return;
    const video = tile.querySelector('video');
    if (video) video.srcObject = null;
    tile.remove();
  }

  function renderLocalTile(kind) {
    const stream = kind === 'cam' ? localCamStream : localScreenStream;
    if (!stream) return;
    upsertTile('local', kind, stream, kind === 'cam' ? 'Tú' : 'Tu pantalla', { muted: true });
  }

  function addStreamToPeer(pc, stream, remoteId, kind) {
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    socket.emit('rtc-signal', {
      roomId: state.roomId,
      to: remoteId,
      signal: { streamKind: { streamId: stream.id, kind } },
    });
  }

  function removeStreamFromPeer(pc, stream) {
    const trackIds = new Set(stream.getTracks().map((t) => t.id));
    pc.getSenders().forEach((sender) => {
      if (sender.track && trackIds.has(sender.track.id)) pc.removeTrack(sender);
    });
  }

  function ensurePeer(remoteId) {
    let entry = peers.get(remoteId);
    if (entry) return entry;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    entry = { pc, polite: state.myId < remoteId, makingOffer: false, ignoreOffer: false };
    peers.set(remoteId, entry);

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        socket.emit('rtc-signal', { roomId: state.roomId, to: remoteId, signal: { description: pc.localDescription } });
      } catch (err) {
        console.error('negotiation error', err);
      } finally {
        entry.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('rtc-signal', { roomId: state.roomId, to: remoteId, signal: { candidate } });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      const kind = remoteStreamKind.get(`${remoteId}/${stream.id}`) || 'cam';
      const user = state.users.find((u) => u.id === remoteId);
      const label = (user ? user.name : 'Alguien') + (kind === 'screen' ? ' (pantalla)' : '');
      upsertTile(remoteId, kind, stream, label);
      event.track.onended = () => removeTile(remoteId, kind);
    };

    if (localCamStream) addStreamToPeer(pc, localCamStream, remoteId, 'cam');
    if (localScreenStream) addStreamToPeer(pc, localScreenStream, remoteId, 'screen');

    return entry;
  }

  function closePeer(remoteId) {
    const entry = peers.get(remoteId);
    if (entry) {
      entry.pc.close();
      peers.delete(remoteId);
    }
    removeTile(remoteId, 'cam');
    removeTile(remoteId, 'screen');
    [...remoteStreamKind.keys()].forEach((k) => { if (k.startsWith(`${remoteId}/`)) remoteStreamKind.delete(k); });
  }

  socket.on('rtc-signal', async ({ from, signal }) => {
    if (signal.streamKind) {
      remoteStreamKind.set(`${from}/${signal.streamKind.streamId}`, signal.streamKind.kind);
      return;
    }
    if (signal.streamEnded) {
      // Explicit "I stopped sharing" notice — a remote track's transceiver
      // going inactive on renegotiation does NOT reliably fire the track's
      // 'ended' event in every browser, so we can't depend on that alone.
      removeTile(from, signal.streamEnded.kind);
      return;
    }
    const entry = ensurePeer(from);
    const { pc } = entry;
    try {
      if (signal.description) {
        const offerCollision = signal.description.type === 'offer' &&
          (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return;
        await pc.setRemoteDescription(signal.description);
        if (signal.description.type === 'offer') {
          await pc.setLocalDescription();
          socket.emit('rtc-signal', { roomId: state.roomId, to: from, signal: { description: pc.localDescription } });
        }
      } else if (signal.candidate) {
        try {
          await pc.addIceCandidate(signal.candidate);
        } catch (err) {
          if (!entry.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error('rtc-signal handling error', err);
    }
  });

  async function toggleCam() {
    if (camOn) { stopCam(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      showToast('No se pudo acceder a la cámara/micrófono.');
      return;
    }
    localCamStream = stream;
    camOn = true;
    micMuted = false;
    camBtn.classList.add('active');
    micBtn.disabled = false;
    micBtn.classList.remove('muted');
    renderLocalTile('cam');
    peers.forEach((entry, remoteId) => addStreamToPeer(entry.pc, localCamStream, remoteId, 'cam'));
    socket.emit('media-state', { roomId: state.roomId, cam: true, mic: true });
  }

  function stopCam() {
    if (!localCamStream) return;
    peers.forEach((entry, remoteId) => {
      removeStreamFromPeer(entry.pc, localCamStream);
      socket.emit('rtc-signal', { roomId: state.roomId, to: remoteId, signal: { streamEnded: { kind: 'cam' } } });
    });
    localCamStream.getTracks().forEach((t) => t.stop());
    localCamStream = null;
    camOn = false;
    micMuted = false;
    camBtn.classList.remove('active');
    micBtn.disabled = true;
    micBtn.classList.remove('muted');
    removeTile('local', 'cam');
    socket.emit('media-state', { roomId: state.roomId, cam: false, mic: false });
  }

  function toggleMic() {
    if (!localCamStream) return;
    micMuted = !micMuted;
    localCamStream.getAudioTracks().forEach((t) => { t.enabled = !micMuted; });
    micBtn.classList.toggle('muted', micMuted);
    socket.emit('media-state', { roomId: state.roomId, mic: !micMuted });
  }

  async function toggleScreen() {
    if (screenOn) { stopScreen(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch (err) {
      return; // user cancelled the native picker
    }
    localScreenStream = stream;
    screenOn = true;
    screenBtn.classList.add('active');
    renderLocalTile('screen');
    peers.forEach((entry, remoteId) => addStreamToPeer(entry.pc, localScreenStream, remoteId, 'screen'));
    socket.emit('media-state', { roomId: state.roomId, screen: true });
    stream.getVideoTracks()[0].onended = () => stopScreen();
  }

  function stopScreen() {
    if (!localScreenStream) return;
    peers.forEach((entry, remoteId) => {
      removeStreamFromPeer(entry.pc, localScreenStream);
      socket.emit('rtc-signal', { roomId: state.roomId, to: remoteId, signal: { streamEnded: { kind: 'screen' } } });
    });
    localScreenStream.getTracks().forEach((t) => t.stop());
    localScreenStream = null;
    screenOn = false;
    screenBtn.classList.remove('active');
    removeTile('local', 'screen');
    socket.emit('media-state', { roomId: state.roomId, screen: false });
  }

  camBtn.addEventListener('click', toggleCam);
  micBtn.addEventListener('click', toggleMic);
  screenBtn.addEventListener('click', toggleScreen);

  // ==================================================================
  // Hyperbeam — shared virtual browser (https://hyperbeam.com)
  // ==================================================================

  async function loadHyperbeamSdk() {
    if (HyperbeamCtor) return HyperbeamCtor;
    const mod = await import('https://unpkg.com/@hyperbeam/web@latest/dist/index.js');
    HyperbeamCtor = mod.default;
    return HyperbeamCtor;
  }

  function showBrowserStage() {
    videoEmpty.classList.add('hidden');
    youtubeWrapper.classList.add('hidden');
    if (state.video?.type === 'video') videoElement.pause();
    videoElement.classList.add('hidden');
    hyperbeamContainer.classList.remove('hidden');
  }

  function hideBrowserStage() {
    hyperbeamContainer.classList.add('hidden');
    hyperbeamContainer.innerHTML = '';
    if (state.video?.type === 'youtube') youtubeWrapper.classList.remove('hidden');
    else if (state.video?.type === 'video') videoElement.classList.remove('hidden');
    else videoEmpty.classList.remove('hidden');
  }

  async function mountHyperbeam(embedUrl, adminToken) {
    if (hyperbeamClient) return;
    showBrowserStage();
    try {
      const Hyperbeam = await loadHyperbeamSdk();
      hyperbeamClient = await Hyperbeam(hyperbeamContainer, embedUrl, adminToken ? { adminToken } : {});
    } catch (err) {
      console.error('Hyperbeam mount failed', err);
      showToast('No se pudo cargar el navegador virtual.');
      hideBrowserStage();
      return;
    }
    vbrowserActive = true;
    vbrowserBtn.classList.add('active');
    vbrowserBtn.querySelector('span').textContent = 'Cerrar navegador';
  }

  function teardownHyperbeam() {
    if (hyperbeamClient) {
      try { hyperbeamClient.destroy(); } catch (err) { /* noop */ }
      hyperbeamClient = null;
    }
    vbrowserActive = false;
    vbrowserBtn.classList.remove('active');
    vbrowserBtn.querySelector('span').textContent = 'Navegador';
    hideBrowserStage();
  }

  vbrowserBtn.addEventListener('click', () => {
    if (vbrowserPending) return;
    if (vbrowserActive) {
      vbrowserBtn.disabled = true;
      socket.emit('vbrowser-stop', { roomId: state.roomId }, () => {
        vbrowserBtn.disabled = false;
        teardownHyperbeam();
      });
      return;
    }
    vbrowserPending = true;
    vbrowserBtn.disabled = true;
    socket.emit('vbrowser-start', { roomId: state.roomId }, async (res) => {
      vbrowserPending = false;
      vbrowserBtn.disabled = false;
      if (!res || res.error) {
        showToast(res?.error || 'No se pudo iniciar el navegador virtual.');
        return;
      }
      await mountHyperbeam(res.embedUrl, res.adminToken);
    });
  });

  socket.on('vbrowser-started', ({ embedUrl }) => mountHyperbeam(embedUrl));
  socket.on('vbrowser-stopped', () => teardownHyperbeam());

  // ---- Auto-join from shared link ----
  const roomMatch = location.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})/);
  if (roomMatch) {
    const code = roomMatch[1].toUpperCase();
    joinCodeInput.value = code;
    if (savedName) enterRoom(code, savedName);
  }
})();
