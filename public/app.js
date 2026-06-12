/* ============================================================
   LIVEBOARD · Frontend
   - Fondo 3D con Three.js (partículas + figuras flotantes)
   - Podio top 3 con tilt 3D
   - Tabla animada con búsqueda
   - Cuenta atrás hasta la recarga diaria
   ============================================================ */

const state = { users: [], nextRefresh: null };

const els = {
  status: document.getElementById('statusText'),
  lastUpdate: document.getElementById('lastUpdate'),
  countdown: document.getElementById('countdown'),
  totalUsers: document.getElementById('totalUsers'),
  podium: document.getElementById('podium'),
  boardBody: document.getElementById('boardBody'),
  search: document.getElementById('searchInput'),
};

document.getElementById('footerYear').textContent = new Date().getFullYear();

const fmt = new Intl.NumberFormat('es-ES');
const fmtCompact = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });

const FALLBACK_AVATAR =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#16162e"/><circle cx="50" cy="38" r="18" fill="#25f4ee" opacity="0.5"/><ellipse cx="50" cy="84" rx="30" ry="20" fill="#fe2c55" opacity="0.45"/></svg>'
  );

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ----------------------------------------------------------
   Carga de datos
---------------------------------------------------------- */
async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();

    if (!data.success || !data.users.length) {
      els.status.textContent = 'Sin datos todavía — reintentando…';
      els.boardBody.innerHTML =
        '<p class="empty-msg">Aún no hay datos del ranking. El servidor lo está sincronizando; esta página reintentará en unos segundos.</p>';
      setTimeout(loadLeaderboard, 15000);
      return;
    }

    state.users = data.users;
    state.nextRefresh = data.nextRefresh ? new Date(data.nextRefresh) : null;

    els.status.textContent = 'Ranking en vivo';
    els.lastUpdate.textContent = data.updatedAt
      ? new Date(data.updatedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
      : '—';

    animateCounter(els.totalUsers, data.total);
    renderPodium(state.users.slice(0, 3));
    renderBoard(state.users);
  } catch (err) {
    els.status.textContent = 'Error de conexión — reintentando…';
    setTimeout(loadLeaderboard, 15000);
  }
}

/* ----------------------------------------------------------
   Podio
---------------------------------------------------------- */
function renderPodium(top3) {
  const classes = ['p1', 'p2', 'p3'];
  els.podium.innerHTML = top3
    .map(
      (u, i) => `
      <article class="podium-card tilt-card ${classes[i]}">
        <div class="podium-medal">${i + 1}</div>
        <img class="podium-avatar" src="${esc(u.avatar) || FALLBACK_AVATAR}" alt="" loading="lazy"
             onerror="this.src='${FALLBACK_AVATAR}'" />
        <h2 class="podium-name">${esc(u.nickname || u.username)}</h2>
        <p class="podium-user">@${esc(u.username)}</p>
        <p class="podium-score" data-count="${u.score}">0<small>PUNTOS</small></p>
      </article>`
    )
    .join('');

  els.podium.querySelectorAll('.podium-score').forEach((el) => {
    animateCounter(el, Number(el.dataset.count), el.querySelector('small'));
  });

  initTilt(els.podium.querySelectorAll('.podium-card'));
}

/* ----------------------------------------------------------
   Tabla
---------------------------------------------------------- */
function renderBoard(users) {
  if (!users.length) {
    els.boardBody.innerHTML = '<p class="empty-msg">No se encontraron creadores con esa búsqueda.</p>';
    return;
  }
  els.boardBody.innerHTML = users
    .map(
      (u, i) => `
      <div class="board-row" style="--i:${Math.min(i, 30)}">
        <span class="col-rank ${u.rank <= 3 ? 'top' : ''}">${u.rank}</span>
        <span class="col-user">
          <img class="row-avatar" src="${esc(u.avatar) || FALLBACK_AVATAR}" alt="" loading="lazy"
               onerror="this.src='${FALLBACK_AVATAR}'" />
          <span class="row-names">
            <span class="row-nick">${esc(u.nickname || u.username)}</span>
            <span class="row-handle">@${esc(u.username)}</span>
          </span>
        </span>
        <span class="col-score">${fmt.format(u.score)}</span>
        <span class="col-viewers">${u.viewers ? fmtCompact.format(u.viewers) : '—'}</span>
        <span class="col-followers">${u.followers ? fmtCompact.format(u.followers) : '—'}</span>
      </div>`
    )
    .join('');
}

els.search.addEventListener('input', () => {
  const q = els.search.value.trim().toLowerCase();
  const filtered = q
    ? state.users.filter((u) => u.username.toLowerCase().includes(q) || (u.nickname || '').toLowerCase().includes(q))
    : state.users;
  renderBoard(filtered);
});

/* ----------------------------------------------------------
   Contadores animados
---------------------------------------------------------- */
function animateCounter(el, target, keepChild = null) {
  const duration = 1400;
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 4);
    el.firstChild
      ? (el.firstChild.nodeValue = fmt.format(Math.round(target * eased)))
      : (el.textContent = fmt.format(Math.round(target * eased)));
    if (keepChild && !el.contains(keepChild)) el.appendChild(keepChild);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ----------------------------------------------------------
   Cuenta atrás hasta la próxima recarga diaria
---------------------------------------------------------- */
setInterval(() => {
  if (!state.nextRefresh) return;
  let ms = state.nextRefresh - Date.now();
  if (ms <= 0) {
    els.countdown.textContent = 'actualizando…';
    loadLeaderboard();
    state.nextRefresh = null;
    return;
  }
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  els.countdown.textContent = `${h}:${m}:${s}`;
}, 1000);

/* ----------------------------------------------------------
   Tilt 3D al mover el ratón
---------------------------------------------------------- */
function initTilt(nodes) {
  nodes.forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateZ(12px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });
}

initTilt(document.querySelectorAll('.refresh-panel, .search-box'));

/* ----------------------------------------------------------
   Fondo 3D · Three.js
---------------------------------------------------------- */
function initBackground3D() {
  if (typeof THREE === 'undefined') return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.getElementById('bg3d');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07070f, 0.05);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 14;

  // Campo de partículas
  const COUNT = 1600;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const palette = [new THREE.Color(0x25f4ee), new THREE.Color(0xfe2c55), new THREE.Color(0x8b5cf6)];
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 50;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 32;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
    const c = palette[(Math.random() * palette.length) | 0];
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const particles = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false })
  );
  scene.add(particles);

  // Figuras geométricas flotantes (wireframe)
  const shapes = [];
  const geometries = [
    new THREE.IcosahedronGeometry(1.6, 0),
    new THREE.TorusGeometry(1.4, 0.4, 10, 40),
    new THREE.OctahedronGeometry(1.3, 0),
    new THREE.TorusKnotGeometry(1, 0.28, 80, 12),
  ];
  const shapeColors = [0x25f4ee, 0xfe2c55, 0x8b5cf6, 0x25f4ee];
  geometries.forEach((g, i) => {
    const mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ color: shapeColors[i], wireframe: true, transparent: true, opacity: 0.16 })
    );
    mesh.position.set((i - 1.5) * 8 + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8, -6 - Math.random() * 6);
    mesh.userData = { speed: 0.15 + Math.random() * 0.25, offset: Math.random() * Math.PI * 2 };
    scene.add(mesh);
    shapes.push(mesh);
  });

  // Parallax con el ratón
  const mouse = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    particles.rotation.y = t * 0.02;
    particles.rotation.x = Math.sin(t * 0.1) * 0.04;

    shapes.forEach((m) => {
      m.rotation.x += 0.0016 * m.userData.speed * 60 * 0.016;
      m.rotation.y += 0.0022 * m.userData.speed * 60 * 0.016;
      m.position.y += Math.sin(t * m.userData.speed + m.userData.offset) * 0.004;
    });

    camera.position.x += (mouse.x * 1.6 - camera.position.x) * 0.03;
    camera.position.y += (-mouse.y * 1.0 - camera.position.y) * 0.03;
    camera.lookAt(scene.position);

    renderer.render(scene, camera);
  }

  if (reduced) {
    renderer.render(scene, camera);
  } else {
    animate();
  }
}

initBackground3D();
loadLeaderboard();
