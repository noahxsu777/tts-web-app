import { TikTokLive } from 'tiktok-live-api';

/* ============================================================
   Gestor de monitores LIVE en segundo plano.
   Garantías de continuidad:
   - Reconexión infinita con backoff (5s → 120s), por encima del
     autoReconnect limitado del SDK
   - Si el stream termina o el usuario no está live, se queda en
     espera comprobando check_alive y reconecta cuando vuelve
   - Watchdog: si pasan 5 min sin eventos estando "conectado",
     fuerza una reconexión (conexiones zombi)
   - Búfer de eventos + SSE con heartbeat para que el navegador
     tampoco pierda la sesión
   ============================================================ */

const BUFFER_SIZE = 400;
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 120_000;
const OFFLINE_POLL_MS = 120_000;
const WATCHDOG_MS = 60_000;
const STALL_MS = 5 * 60_000;

export class MonitorManager {
  constructor({ apiKey, apiBase, log = console }) {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
    this.log = log;
    this.monitors = new Map(); // username -> monitor
    this.watchdog = setInterval(() => this.#watchdogTick(), WATCHDOG_MS);
    this.watchdog.unref?.();
  }

  list() {
    return [...this.monitors.values()].map((m) => this.#publicState(m));
  }

  get(username) {
    const m = this.monitors.get(this.#key(username));
    return m ? this.#publicState(m) : null;
  }

  #key(username) {
    return String(username || '').replace(/^@/, '').trim().toLowerCase();
  }

  #publicState(m) {
    return {
      username: m.username,
      status: m.status,
      startedAt: m.startedAt,
      connectedAt: m.connectedAt,
      lastEventAt: m.lastEventAt,
      reconnects: m.reconnects,
      eventCount: m.seq,
      stats: { ...m.stats, topGifters: [...m.topGifters.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([user, diamonds]) => ({ user, diamonds })) },
    };
  }

  start(username) {
    const key = this.#key(username);
    if (!key) throw new Error('username requerido');
    if (this.monitors.has(key)) return this.#publicState(this.monitors.get(key));

    const m = {
      username: key,
      status: 'connecting',
      startedAt: Date.now(),
      connectedAt: null,
      lastEventAt: null,
      reconnects: 0,
      backoff: BACKOFF_MIN_MS,
      stopped: false,
      client: null,
      reconnectTimer: null,
      seq: 0,
      buffer: [],
      subscribers: new Set(), // funciones (evento) => void  [SSE]
      stats: { chats: 0, gifts: 0, diamonds: 0, likes: 0, follows: 0, shares: 0, members: 0, viewers: 0 },
      topGifters: new Map(),
    };
    this.monitors.set(key, m);
    this.#connect(m);
    return this.#publicState(m);
  }

  stop(username) {
    const key = this.#key(username);
    const m = this.monitors.get(key);
    if (!m) return false;
    m.stopped = true;
    clearTimeout(m.reconnectTimer);
    try { m.client?.disconnect(); } catch { /* ya cerrado */ }
    this.#push(m, 'system', { message: 'Monitor detenido por el usuario' });
    for (const send of m.subscribers) send({ type: 'end' });
    this.monitors.delete(key);
    return true;
  }

  subscribe(username, send) {
    const m = this.monitors.get(this.#key(username));
    if (!m) return null;
    for (const ev of m.buffer) send(ev); // replay del búfer
    m.subscribers.add(send);
    return () => m.subscribers.delete(send);
  }

  #push(m, type, data) {
    m.seq++;
    const event = { seq: m.seq, type, at: Date.now(), data };
    m.buffer.push(event);
    if (m.buffer.length > BUFFER_SIZE) m.buffer.shift();
    for (const send of m.subscribers) {
      try { send(event); } catch { /* suscriptor caído */ }
    }
  }

  #connect(m) {
    if (m.stopped) return;
    clearTimeout(m.reconnectTimer);
    try { m.client?.removeAllListeners?.(); m.client?.disconnect(); } catch { /* sin conexión previa */ }

    m.status = m.connectedAt ? 'reconnecting' : 'connecting';
    const client = new TikTokLive(m.username, {
      apiKey: this.apiKey,
      autoReconnect: false, // la reconexión la gobierna este supervisor
    });
    m.client = client;

    const touch = () => { m.lastEventAt = Date.now(); };

    client.on('connected', (e) => {
      touch();
      m.status = 'connected';
      m.connectedAt = Date.now();
      m.backoff = BACKOFF_MIN_MS;
      this.#push(m, 'system', { message: `Conectado al directo de @${m.username}`, roomId: e?.roomId });
      this.log.log(`[monitor:${m.username}] conectado`);
    });

    client.on('chat', (e) => {
      touch(); m.stats.chats++;
      this.#push(m, 'chat', { user: e.user?.uniqueId, nickname: e.user?.nickname, comment: e.comment });
    });

    client.on('gift', (e) => {
      touch();
      const diamonds = (e.diamondCount || 0) * (e.repeatCount || 1);
      m.stats.gifts++; m.stats.diamonds += diamonds;
      const who = e.user?.uniqueId || '?';
      m.topGifters.set(who, (m.topGifters.get(who) || 0) + diamonds);
      if (m.topGifters.size > 200) {
        const sorted = [...m.topGifters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100);
        m.topGifters = new Map(sorted);
      }
      this.#push(m, 'gift', { user: who, gift: e.giftName, diamonds, repeat: e.repeatCount || 1 });
    });

    client.on('like', (e) => {
      touch(); m.stats.likes += e.likeCount || 1;
      this.#push(m, 'like', { user: e.user?.uniqueId, count: e.likeCount || 1, total: e.totalLikes });
    });

    client.on('follow', (e) => {
      touch(); m.stats.follows++;
      this.#push(m, 'follow', { user: e.user?.uniqueId });
    });

    client.on('share', (e) => {
      touch(); m.stats.shares++;
      this.#push(m, 'share', { user: e.user?.uniqueId });
    });

    client.on('member', (e) => {
      touch(); m.stats.members++;
      this.#push(m, 'member', { user: e.user?.uniqueId });
    });

    client.on('roomUserSeq', (e) => {
      touch(); m.stats.viewers = e.viewerCount || 0;
      this.#push(m, 'viewers', { count: m.stats.viewers });
    });

    client.on('battle', (e) => { touch(); this.#push(m, 'battle', e); });
    client.on('roomPin', (e) => { touch(); this.#push(m, 'pin', { user: e?.user?.uniqueId }); });
    client.on('envelope', () => { touch(); this.#push(m, 'envelope', {}); });

    client.on('streamEnd', () => {
      if (m.client !== client) return; // cliente antiguo ya reemplazado
      touch();
      this.#push(m, 'system', { message: 'El directo ha terminado. Esperando a que vuelva a emitir…' });
      this.#scheduleReconnect(m, OFFLINE_POLL_MS, 'offline-waiting');
    });

    client.on('disconnected', () => {
      if (m.stopped || m.client !== client) return;
      this.#push(m, 'system', { message: 'Conexión perdida. Reconectando…' });
      this.#scheduleReconnect(m);
    });

    client.on('error', (e) => {
      if (m.stopped || m.client !== client) return;
      this.#push(m, 'system', { message: `Error: ${e?.error || 'desconocido'}. Reintentando…` });
      this.#scheduleReconnect(m);
    });

    // connect() devuelve una promesa que rechaza si falla el handshake:
    // hay que capturarla siempre o tumbaría el proceso entero
    Promise.resolve()
      .then(() => client.connect())
      .catch((err) => {
        if (m.stopped || m.client !== client) return;
        this.#push(m, 'system', { message: `No se pudo conectar: ${err.message}. Reintentando…` });
        this.#scheduleReconnect(m);
      });
  }

  #scheduleReconnect(m, delay = null, status = 'reconnecting') {
    if (m.stopped) return;
    m.status = status;
    const wait = delay ?? m.backoff;
    if (delay === null) m.backoff = Math.min(m.backoff * 2, BACKOFF_MAX_MS);
    clearTimeout(m.reconnectTimer);
    m.reconnectTimer = setTimeout(async () => {
      if (m.stopped) return;
      // Si estamos esperando a que vuelva el directo, comprobamos primero
      if (status === 'offline-waiting') {
        const live = await this.#isLive(m.username);
        if (!live) return this.#scheduleReconnect(m, OFFLINE_POLL_MS, 'offline-waiting');
      }
      m.reconnects++;
      this.#connect(m);
    }, wait);
    m.reconnectTimer.unref?.();
  }

  async #isLive(username) {
    try {
      const res = await fetch(
        `${this.apiBase}/webcast/check_alive?apiKey=${encodeURIComponent(this.apiKey)}&unique_id=${encodeURIComponent(username)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      const json = await res.json();
      const d = json?.data ?? json;
      return Boolean(d?.alive ?? d?.is_live ?? d?.[0]?.alive);
    } catch {
      return true; // si la comprobación falla, intentamos conectar igualmente
    }
  }

  #watchdogTick() {
    for (const m of this.monitors.values()) {
      if (m.stopped || m.status !== 'connected') continue;
      if (m.lastEventAt && Date.now() - m.lastEventAt > STALL_MS) {
        this.log.warn(`[monitor:${m.username}] sin eventos ${STALL_MS / 60000} min: reconexión forzada`);
        this.#push(m, 'system', { message: 'Conexión inactiva detectada. Reconectando…' });
        this.#scheduleReconnect(m, 1000);
      }
    }
  }
}
