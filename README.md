# 🍿 WatchParty — Ve videos juntos

Una aplicación web para ver videos de **YouTube** o de **internet** en sincronía con tus amigos: mismos play, pausa y saltos para todos, con chat en vivo, lista de participantes y reacciones flotantes. Inspirada en [howardchung/watchparty](https://github.com/howardchung/watchparty), reconstruida aquí como una app ligera (Node.js + Socket.IO, sin build step) con un diseño oscuro moderno tipo *glassmorphism*.

## ✨ Características

- 🔗 **Salas instantáneas**: crea una sala y comparte el código o el enlace, sin registro
- ▶️ **Reproducción sincronizada**: play, pausa y seek se replican para todos los presentes
- 🎥 **YouTube y video directo**: pega un link de YouTube o una URL de video (mp4, etc.)
- 💬 **Chat en tiempo real** por sala
- 👥 **Lista de participantes** con avatares de color únicos
- 🎉 **Reacciones flotantes** (👍 ❤️ 😂 😮 🎉 👏) en tiempo real
- 🎨 **Diseño oscuro moderno**, responsivo, con acentos en gradiente
- 🕒 **Recuperación de estado** para quien se une a una sala ya iniciada

> Fuera de alcance en esta versión (a diferencia del proyecto original): compartir pantalla / video chat vía WebRTC, navegador virtual en la nube, torrents, persistencia en base de datos y autenticación — todo eso requiere infraestructura adicional (Redis, Postgres, Firebase, Docker/Neko). Esta versión se enfoca en la experiencia central de ver-juntos con una interfaz muy cuidada.

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

### Ejecutar en desarrollo
\`\`\`bash
npm run dev
\`\`\`

Acceder a \`http://localhost:8080\` (o el puerto configurado en la variable \`PORT\`).

## 🏗️ Estructura del Proyecto

\`\`\`
tts-web-app/
├── server.js              # Backend Express + Socket.IO (salas, sync, chat)
├── package.json           # Dependencias
├── Dockerfile              # Contenedor Docker
├── fly.toml                # Configuración Fly.io
├── public/
│   ├── index.html         # Landing + interfaz de sala
│   ├── app.js              # Lógica de cliente (Socket.IO, YouTube IFrame API)
│   └── styles.css          # Estilos (tema oscuro, glassmorphism)
└── README.md               # Este archivo
\`\`\`

## 🛠️ Tecnología Stack

**Backend:**
- Node.js 18
- Express.js
- Socket.IO (salas y sincronización en tiempo real)

**Frontend:**
- HTML5 / CSS3 (variables, grid, flexbox, animaciones)
- Vanilla JavaScript
- YouTube IFrame API

**Deployment:**
- Fly.io
- Docker

## 🎮 Cómo funciona

1. Escribe tu nombre y crea una sala (o únete con un código de 6 caracteres).
2. Pega el enlace de un video de YouTube o una URL de video directo — se carga para todos.
3. Cualquiera puede darle play/pausa/seek al video: el cambio se sincroniza al instante en toda la sala.
4. Usa el chat o las reacciones para comentar mientras ven juntos.
5. Copia el enlace de la sala (botón junto al código) para invitar a más gente.

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

El resto de la interacción ocurre por **Socket.IO** (eventos \`create-room\`, \`join-room\`, \`set-video\`, \`play\`, \`pause\`, \`seek\`, \`chat\`, \`reaction\`).

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
