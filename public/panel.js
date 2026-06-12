/* ============================================================
   LIVEBOARD · Pestañas, Monitor LIVE, Herramientas y Estado
   ============================================================ */

/* ---------------- Pestañas ---------------- */
document.querySelectorAll('#tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab.dataset.view}`));
    if (tab.dataset.view === 'estado') refreshStatus();
    if (tab.dataset.view === 'monitor') refreshMonitors();
  });
});

const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============================================================
   MONITOR LIVE
   ============================================================ */
const mon = {
  current: null, // username de la consola abierta
  source: null,  // EventSource activo
  paused: false,
};

const $ = (id) => document.getElementById(id);

document.getElementById('monitorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = $('monitorUser').value.replace(/^@/, '').trim().toLowerCase();
  if (!user) return;
  const res = await fetch(`/api/monitor/${encodeURIComponent(user)}/start`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) {
    alert(data.error || 'No se pudo iniciar el monitor');
    return;
  }
  $('monitorUser').value = '';
  await refreshMonitors();
  openConsole(user);
});

async function refreshMonitors() {
  const res = await fetch('/api/monitors').catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  const wrap = $('monitorCards');
  if (!data || !data.success) {
    wrap.innerHTML = `<p class="empty-msg">${escHtml(data?.error || 'Monitores no disponibles')}</p>`;
    return;
  }
  if (!data.monitors.length) {
    wrap.innerHTML = '<p class="empty-msg">No hay monitores activos. Conecta el primero ↑</p>';
    return;
  }
  wrap.innerHTML = data.monitors
    .map((m) => {
      const statusInfo = {
        connected: ['🟢', 'Conectado'],
        connecting: ['🟡', 'Conectando…'],
        reconnecting: ['🟠', 'Reconectando…'],
        'offline-waiting': ['⚪', 'Esperando directo'],
      }[m.status] || ['🔴', m.status];
      return `
      <article class="monitor-card tilt-card" data-user="${escHtml(m.username)}">
        <div class="mc-head">
          <strong>@${escHtml(m.username)}</strong>
          <span class="mc-status">${statusInfo[0]} ${statusInfo[1]}</span>
        </div>
        <div class="mc-stats">
          <span>💬 ${m.stats.chats}</span>
          <span>🎁 ${m.stats.gifts}</span>
          <span>💎 ${m.stats.diamonds.toLocaleString('es-ES')}</span>
          <span>❤️ ${m.stats.likes.toLocaleString('es-ES')}</span>
          <span>👀 ${m.stats.viewers.toLocaleString('es-ES')}</span>
          <span>🔄 ${m.reconnects}</span>
        </div>
        <div class="mc-actions">
          <button class="btn-ghost" data-open="${escHtml(m.username)}">Abrir consola</button>
          <button class="btn-danger" data-stop="${escHtml(m.username)}">Detener</button>
        </div>
      </article>`;
    })
    .join('');

  wrap.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openConsole(b.dataset.open)));
  wrap.querySelectorAll('[data-stop]').forEach((b) =>
    b.addEventListener('click', async () => {
      await fetch(`/api/monitor/${encodeURIComponent(b.dataset.stop)}/stop`, { method: 'POST' });
      if (mon.current === b.dataset.stop) closeConsole();
      refreshMonitors();
    })
  );
}

const EVENT_RENDER = {
  chat: (d) => `<span class="ev-user">${escHtml(d.user)}</span> ${escHtml(d.comment)}`,
  gift: (d) => `🎁 <span class="ev-user">${escHtml(d.user)}</span> envió <b>${escHtml(d.gift)}</b> ×${d.repeat} <span class="ev-diamond">+${d.diamonds}💎</span>`,
  like: (d) => `❤️ <span class="ev-user">${escHtml(d.user)}</span> dio ${d.count} like(s)`,
  follow: (d) => `➕ <span class="ev-user">${escHtml(d.user)}</span> empezó a seguir`,
  share: (d) => `📤 <span class="ev-user">${escHtml(d.user)}</span> compartió el directo`,
  member: (d) => `👋 <span class="ev-user">${escHtml(d.user)}</span> entró`,
  viewers: (d) => `👀 ${Number(d.count).toLocaleString('es-ES')} espectadores`,
  battle: () => `⚔️ Evento de batalla`,
  pin: (d) => `📌 Mensaje fijado${d.user ? ' de ' + escHtml(d.user) : ''}`,
  envelope: () => `🧧 Cofre de monedas`,
  system: (d) => `⚙️ ${escHtml(d.message)}`,
  error: (d) => `🛑 ${escHtml(d.message)}`,
};

function openConsole(user) {
  closeConsole();
  mon.current = user;
  $('consoleWrap').hidden = false;
  $('consoleTitle').innerHTML = `Consola · <b>@${escHtml(user)}</b> <span class="live-dot"></span>`;
  $('consoleBody').innerHTML = '';
  $('giftersPanel').innerHTML = '';

  mon.source = new EventSource(`/api/monitor/${encodeURIComponent(user)}/events`);
  mon.source.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'end') return closeConsole();
    appendEvent(ev);
  };
  mon.source.onerror = () => {
    // EventSource se reconecta solo; lo señalamos sin romper nada
    appendEvent({ type: 'system', at: Date.now(), data: { message: 'Reconectando consola…' } });
  };

  mon.statsTimer = setInterval(updateConsoleStats, 4000);
  updateConsoleStats();
  $('consoleWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeConsole() {
  mon.source?.close();
  mon.source = null;
  clearInterval(mon.statsTimer);
  mon.current = null;
  $('consoleWrap').hidden = true;
}

function appendEvent(ev) {
  const body = $('consoleBody');
  const render = EVENT_RENDER[ev.type] || ((d) => escHtml(JSON.stringify(d)));
  const line = document.createElement('div');
  line.className = `ev ev-${ev.type}`;
  line.innerHTML = `<span class="ev-time">${new Date(ev.at).toLocaleTimeString('es-ES')}</span> ${render(ev.data || {})}`;
  body.appendChild(line);
  while (body.children.length > 500) body.removeChild(body.firstChild);
  body.scrollTop = body.scrollHeight;
}

async function updateConsoleStats() {
  if (!mon.current) return;
  const res = await fetch(`/api/monitor/${encodeURIComponent(mon.current)}/state`).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  if (!data?.success) return;
  const m = data.monitor;
  $('consoleStats').innerHTML = `
    <span>💬 ${m.stats.chats.toLocaleString('es-ES')}</span>
    <span>💎 ${m.stats.diamonds.toLocaleString('es-ES')}</span>
    <span>❤️ ${m.stats.likes.toLocaleString('es-ES')}</span>
    <span>👀 ${m.stats.viewers.toLocaleString('es-ES')}</span>`;
  if (m.stats.topGifters?.length) {
    $('giftersPanel').innerHTML =
      '<h4>💎 Top gifters de la sesión</h4>' +
      m.stats.topGifters
        .map((g, i) => `<div class="gifter"><span>${i + 1}. ${escHtml(g.user)}</span><b>${g.diamonds.toLocaleString('es-ES')} 💎</b></div>`)
        .join('');
  }
}

setInterval(() => {
  if (document.querySelector('#view-monitor.active')) refreshMonitors();
}, 8000);

/* ============================================================
   HERRAMIENTAS
   ============================================================ */
const TOOLS = {
  alive: () => ({ url: `/api/tools/check-alive?user=${val('t-alive')}` }),
  bulk: () => ({
    url: '/api/tools/bulk-live-check',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ users: $('t-bulk').value.split(',').map((s) => s.replace(/^@/, '').trim()).filter(Boolean) }),
    },
  }),
  room: () => ({ url: `/api/tools/room-info?user=${val('t-room')}` }),
  video: () => ({ url: `/api/tools/room-video?user=${val('t-video')}` }),
  rank: () => ({ url: `/api/tools/rankings?user=${val('t-rank')}` }),
  gifts: () => ({ url: '/api/tools/gift-info' }),
  hashtags: () => ({ url: '/api/tools/hashtags' }),
  cover: () => ({ url: `/api/tools/room-cover?user=${val('t-cover')}` }),
};

function val(id) {
  return encodeURIComponent($(id).value.replace(/^@/, '').trim());
}

document.querySelectorAll('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const tool = btn.dataset.tool;
    const out = $(`r-${tool}`);
    out.hidden = false;
    out.textContent = '⏳ Consultando…';
    try {
      const { url, options } = TOOLS[tool]();
      const res = await fetch(url, options);
      const data = await res.json();
      out.textContent = JSON.stringify(data, null, 2).slice(0, 8000);
    } catch (err) {
      out.textContent = `Error: ${err.message}`;
    }
  });
});

/* ============================================================
   ESTADO
   ============================================================ */
async function refreshStatus() {
  const grid = $('statusGrid');
  grid.innerHTML = '<p class="empty-msg">Cargando estado…</p>';
  const [health, limits, monres] = await Promise.all([
    fetch('/api/health').then((r) => r.json()).catch(() => null),
    fetch('/api/tools/rate-limits').then((r) => r.json()).catch(() => null),
    fetch('/api/monitors').then((r) => r.json()).catch(() => null),
  ]);

  const fmtUptime = (s) => {
    if (!s && s !== 0) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const cards = [];
  cards.push(`
    <article class="status-card tilt-card">
      <h3>🖥️ Servidor</h3>
      <div class="status-kv"><span>Estado</span><b>${health ? '🟢 Operativo' : '🔴 Sin respuesta'}</b></div>
      <div class="status-kv"><span>Uptime</span><b>${fmtUptime(health?.uptime)}</b></div>
      <div class="status-kv"><span>Usuarios en caché</span><b>${health?.cachedUsers ?? '—'}</b></div>
    </article>`);

  cards.push(`
    <article class="status-card tilt-card">
      <h3>📈 Cuota API tik.tools</h3>
      ${limits && !limits.error
        ? `<pre class="tool-result" style="display:block">${escHtml(JSON.stringify(limits.data ?? limits, null, 2)).slice(0, 2000)}</pre>`
        : `<p class="status-dim">No disponible: ${escHtml(limits?.error || 'sin conexión')}</p>`}
    </article>`);

  const monitors = monres?.monitors || [];
  cards.push(`
    <article class="status-card tilt-card">
      <h3>📡 Monitores en segundo plano</h3>
      ${monitors.length
        ? monitors
            .map(
              (m) => `<div class="status-kv"><span>@${escHtml(m.username)}</span>
              <b>${m.status === 'connected' ? '🟢' : '🟠'} ${escHtml(m.status)} · ${m.eventCount.toLocaleString('es-ES')} eventos · 🔄${m.reconnects}</b></div>`
            )
            .join('')
        : `<p class="status-dim">${escHtml(monres?.error || 'Ninguno activo')}</p>`}
    </article>`);

  grid.innerHTML = cards.join('');
}

setInterval(() => {
  if (document.querySelector('#view-estado.active')) refreshStatus();
}, 10000);
