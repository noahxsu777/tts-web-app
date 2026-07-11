# 🍿 WatchParty — Ve videos juntos

Una aplicación web para ver videos de **YouTube** o de **internet** en sincronía con tus amigos: mismos play, pausa y saltos para todos, con chat en vivo, lista de participantes y reacciones flotantes. Inspirada en [howardchung/watchparty](https://github.com/howardchung/watchparty), reconstruida aquí como una app ligera (Node.js + Socket.IO, sin build step) con un diseño oscuro moderno tipo *glassmorphism*.

## ✨ Características

- 🔗 **Salas instantáneas**: crea una sala y comparte el código o el enlace, sin registro
- ▶️ **Reproducción sincronizada**: play, pausa y seek se replican para todos los presentes
- 🎥 **YouTube y video directo**: pega un link de YouTube o una URL de video (mp4, etc.)
- 💬 **Chat en tiempo real** por sala
- 👥 **Lista de participantes** con avatares de color únicos y estado de cámara/mic
- 🎉 **Reacciones flotantes** (👍 ❤️ 😂 😮 🎉 👏) en tiempo real
- 📹 **Videollamada WebRTC**: cámara, micrófono y compartir pantalla entre todos en la sala (P2P, sin servidor de medios)
- 🌐 **Navegador virtual compartido** (vía [Hyperbeam](https://hyperbeam.com)): todos navegan juntos la misma sesión de navegador en la nube
- 🎨 **Diseño oscuro moderno**, responsivo, con acentos en gradiente
- 🕒 **Recuperación de estado** para quien se une a una sala ya iniciada

> Fuera de alcance en esta versión (a diferencia del proyecto original): torrents (WebTorrent/magnet links), persistencia en base de datos y cuentas de usuario/autenticación. El video chat usa WebRTC mesh P2P (sin SFU), lo que funciona bien para grupos pequeños; el navegador virtual usa el servicio administrado Hyperbeam en vez de una integración propia con Neko/Docker.

## 🚀 Quick Start en Fly.io

### 1. Clonar el repositorio
\`\`\`bash
git clone https://github.com/noahxsu777/tts-web-app.git
cd tts-web-app
\`\`\`

### 2. Instalar Fly CLI
\`\`\`bash
curl -L https://fly.io/install.sh | sh
\`\`\`

### 3. Autenticarse
\`\`\`bash
fly auth login
\`\`\`

### 4. Desplegar
\`\`\`bash
fly deploy
\`\`\`

### 5. Ver tu app
\`\`\`bash
fly open
\`\`\`

## 📝 Configuración Local

### Requisitos
- Node.js 18+
- npm

### Instalación
\`\`\`bash
npm install
\`\`\`

### Variables de entorno (opcional)
Copia \`.env.example\` a \`.env\` si quieres habilitar el navegador virtual compartido:
\`\`\`bash
cp .env.example .env
\`\`\`
- \`HYPERBEAM_API_KEY\`: tu API key de [hyperbeam.com](https://hyperbeam.com). Sin ella, todo lo demás (video sync, chat, videollamada) funciona igual; solo el botón "Navegador" mostrará un error.
- \`PORT\`: puerto del servidor (default 8080).

### Ejecutar en desarrollo
\`\`\`bash
npm run dev
\`\`\`

Acceder a \`http://localhost:8080\` (o el puerto configurado en la variable \`PORT\`).

## 🏗️ Estructura del Proyecto

\`\`\`
tts-web-app/
├── server.js              # Backend Express + Socket.IO (salas, sync, chat, señalización WebRTC, Hyperbeam)
├── package.json           # Dependencias
├── .env.example            # Plantilla de variables de entorno
├── Dockerfile              # Contenedor Docker
├── fly.toml                # Configuración Fly.io
├── public/
│   ├── index.html         # Landing + interfaz de sala
│   ├── app.js              # Lógica de cliente (Socket.IO, YouTube IFrame API, WebRTC, Hyperbeam)
│   └── styles.css          # Estilos (tema oscuro, glassmorphism)
└── README.md               # Este archivo
\`\`\`

## 🛠️ Tecnología Stack

**Backend:**
- Node.js 18
- Express.js
- Socket.IO (salas, sincronización en tiempo real y señalización WebRTC)
- Llamadas REST a la API de Hyperbeam para el navegador virtual

**Frontend:**
- HTML5 / CSS3 (variables, grid, flexbox, animaciones)
- Vanilla JavaScript
- YouTube IFrame API
- WebRTC nativo del navegador (mesh P2P, con [perfect negotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation))
- [`@hyperbeam/web`](https://www.npmjs.com/package/@hyperbeam/web) cargado dinámicamente desde unpkg (sin bundler)

**Deployment:**
- Fly.io (recomendado — necesita un servidor persistente para Socket.IO/WebRTC; **no funciona en hosting serverless como Vercel**)
- Docker

## 🎮 Cómo funciona

1. Escribe tu nombre y crea una sala (o únete con un código de 6 caracteres).
2. Pega el enlace de un video de YouTube o una URL de video directo — se carga para todos.
3. Cualquiera puede darle play/pausa/seek al video: el cambio se sincroniza al instante en toda la sala.
4. Usa el chat o las reacciones para comentar mientras ven juntos.
5. Copia el enlace de la sala (botón junto al código) para invitar a más gente.
6. Prende tu cámara (🎥), silencia el mic (🎤) o comparte pantalla (🖥️) — se conecta automáticamente por WebRTC con todos los demás en la sala.
7. Si configuraste \`HYPERBEAM_API_KEY\`, el botón 🌐 **Navegador** abre un navegador compartido: todos ven y controlan la misma sesión en tiempo real.

## 📹 Cómo funciona el video chat (WebRTC)

Es una malla (*mesh*) peer-to-peer: cada participante abre una conexión WebRTC directa con cada otro participante (sin servidor de medios), usando Socket.IO solo para la señalización inicial (intercambio de SDP/ICE vía el evento \`rtc-signal\`, que el servidor únicamente reenvía sin inspeccionar). Funciona bien para grupos pequeños/medianos; para salas muy grandes convendría un SFU (fuera de alcance aquí). Usa un STUN público (\`stun.l.google.com\`) para resolver NAT — en redes muy restrictivas puede hacer falta además un servidor TURN, que no está incluido.

## 🌐 Cómo funciona el navegador virtual (Hyperbeam)

Cuando alguien pulsa "Navegador", el servidor pide a la API de Hyperbeam que cree una sesión de navegador en la nube y guarda su \`embed_url\` en el estado de la sala; el resto de participantes reciben ese mismo \`embed_url\` y lo montan con el SDK \`@hyperbeam/web\`, así que todos ven y controlan la misma pestaña compartida. La sesión se cierra automáticamente (llamando a la API de Hyperbeam) en cuanto la sala se queda vacía, para no dejarla facturando de más.

## 📡 API

### GET \`/api/health\`
Verifica el estado del servidor.

**Response:**
\`\`\`json
{
  "status": "ok",
  "rooms": 3,
  "timestamp": "2026-07-11T10:30:00.000Z"
}
\`\`\`

El resto de la interacción ocurre por **Socket.IO**:
- Sala/video: \`create-room\`, \`join-room\`, \`set-video\`, \`play\`, \`pause\`, \`seek\`, \`sync-time\`
- Social: \`chat\`, \`reaction\`
- Videollamada: \`rtc-signal\` (relay de SDP/ICE), \`media-state\` (estado de cámara/mic/pantalla para la lista de gente)
- Navegador virtual: \`vbrowser-start\`, \`vbrowser-stop\`

## 🎨 Personalización

### Cambiar colores
Editar \`public/styles.css\`:
\`\`\`css
:root {
  --primary: #7c6cf6;   /* Color primario */
  --primary-2: #f6779c; /* Color secundario del gradiente */
}
\`\`\`

### Agregar más reacciones
Editar el arreglo \`allowed\` en \`server.js\` y los botones \`.reaction-btn\` en \`public/index.html\`.

## 📊 Monitoreo

En Fly.io puedes monitorear:
\`\`\`bash
fly logs
fly status
\`\`\`

## 🐛 Troubleshooting

### "El video no sincroniza entre pestañas"
- Verifica que ambas pestañas estén en la misma sala (mismo código en la URL)
- Revisa la consola del navegador (F12) en busca de errores de Socket.IO

### "YouTube no reproduce automáticamente"
- Los navegadores bloquean el autoplay con sonido; dale play manualmente la primera vez

### "No veo la cámara de los demás"
- Ambos navegadores deben dar permiso de cámara/mic (revisa el candado de la barra de direcciones)
- En redes muy restrictivas (NAT simétrico, firewalls corporativos) puede que el STUN público no sea suficiente y haga falta un servidor TURN

### "El botón Navegador dice que no está configurado"
- Falta la variable de entorno \`HYPERBEAM_API_KEY\` en el servidor — consigue una key en [hyperbeam.com](https://hyperbeam.com) y configúrala (\`fly secrets set HYPERBEAM_API_KEY=...\` en Fly.io, o en tu \`.env\` local)

### "App se cae en Fly.io"
\`\`\`bash
fly logs -a tts-web-app
\`\`\`

## 📝 Licencia

MIT

## 👨‍💻 Autor

Noah

---

**🍿 ¡Disfruta viendo videos con tus amigos!**
