# 🎙️ TTS Web App - Generador de Voz con IA

Una aplicación web moderna para convertir texto a voz usando la API de **tik.tools**. Características completas de personalización con interfaz intuitiva.

## ✨ Características

- 🎙️ **6 voces diferentes** con personalización de velocidad y volumen
- 🌍 **8 idiomas soportados** (Inglés, Español, Portugués, Francés, Alemán, Italiano, Japonés, Chino)
- 🎚️ **Controles avanzados** de velocidad y volumen en tiempo real
- 📥 **Descarga de audio** en formato MP3
- 🔄 **Conexión estable en segundo plano** con health checks automáticos
- 🎨 **Diseño responsivo y moderno** con gradientes
- ⚡ **Interfaz rápida y fluid**
- 🔐 **API Key segura** en variables de entorno

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
- npm o yarn

### Instalación
\`\`\`bash
npm install
\`\`\`

### Variables de entorno
Crear archivo \`.env\`:
\`\`\`
TIK_TOOLS_API_KEY=tu_api_key_aqui
PORT=3000
NODE_ENV=development
\`\`\`

### Ejecutar en desarrollo
\`\`\`bash
npm run dev
\`\`\`

Acceder a \`http://localhost:3000\`

## 🏗️ Estructura del Proyecto

\`\`\`
tts-web-app/
├── server.js              # Backend Express.js
├── package.json           # Dependencias
├── Dockerfile             # Contenedor Docker
├── fly.toml              # Configuración Fly.io
├── .env                  # Variables de entorno (no compartir)
├── .env.example          # Template de variables
├── public/
│   ├── index.html        # HTML principal
│   ├── app.js            # Frontend JavaScript
│   └── styles.css        # Estilos CSS
└── README.md             # Este archivo
\`\`\`

## 🛠️ Tecnología Stack

**Backend:**
- Node.js 18
- Express.js
- Axios
- CORS

**Frontend:**
- HTML5
- CSS3 (Gradientes, Flexbox, Grid)
- Vanilla JavaScript
- Web Audio API

**Deployment:**
- Fly.io
- Docker

## 📡 API Endpoints

### POST \`/api/tts\`
Genera TTS desde texto

**Body:**
\`\`\`json
{
  "text": "Hola mundo",
  "voice": "voice1",
  "language": "es",
  "speed": 1,
  "volume": 1
}
\`\`\`

**Response:**
\`\`\`json
{
  "success": true,
  "audioUrl": "https://...",
  "duration": 2.5
}
\`\`\`

### GET \`/api/health\`
Verifica estado del servidor

**Response:**
\`\`\`json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z"
}
\`\`\`

## 🎨 Personalización

### Agregar más voces
Editar \`public/app.js\`:
\`\`\`javascript
const VOICES = [
  // ... voces existentes
  { id: 'voice7', name: 'Mi Voz', icon: '🎯' },
];
\`\`\`

### Agregar más idiomas
\`\`\`javascript
const LANGUAGES = [
  // ... idiomas existentes
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
];
\`\`\`

### Cambiar colores
Editar \`public/styles.css\`:
\`\`\`css
:root {
  --primary: #667eea;  /* Cambiar color primario */
  --secondary: #764ba2; /* Cambiar color secundario */
}
\`\`\`

## 🔒 Variables de Entorno

- \`TIK_TOOLS_API_KEY\` - Tu API key de tik.tools (requerido)
- \`PORT\` - Puerto del servidor (default: 3000)
- \`NODE_ENV\` - Entorno (development/production)

## 📊 Monitoreo

En Fly.io puedes monitorear:
\`\`\`bash
fly logs
fly status
fly metrics
\`\`\`

## 🐛 Troubleshooting

### "Error de conexión a API"
- Verifica que tu API key sea válida
- Comprueba el archivo \`.env\`
- Revisa los logs: \`fly logs\`

### "Audio no se reproduce"
- Comprueba los permisos de audio del navegador
- Verifica la conexión a internet
- Revisa la consola del navegador (F12)

### "App se cae en Fly.io"
\`\`\`bash
fly logs -a tts-web-app
\`\`\`

## 📝 Licencia

MIT

## 👨‍💻 Autor

Noah

---

**🎉 ¡Disfruta generando voces!**
