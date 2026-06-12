# 🏆 LIVEBOARD · TikTok LIVE Leaderboard

Web profesional con un **ranking global de creadores de TikTok LIVE** que se **recarga automáticamente cada 24 horas**, usando la API de [tik.tools](https://tik.tools/guides/tiktok-live-leaderboard-api).

## ✨ Características

- 🏆 **Ranking global** de creadores ordenado por puntuación (diamantes)
- 🔄 **Recarga automática diaria** (caché de 24h en el servidor + cuenta atrás en la web)
- 🥇 **Podio Top 3** con tarjetas 3D, medallas flotantes y efecto tilt
- 🌌 **Fondo 3D animado con Three.js**: campo de partículas, figuras wireframe flotantes y parallax con el ratón
- 🎬 **Animaciones pro**: entradas 3D del título, filas con stagger, contadores animados, aurora de fondo, loader cúbico 3D
- 🔍 **Buscador en vivo** de creadores
- 📱 **Diseño responsivo** con glassmorphism y modo `prefers-reduced-motion`
- 🔐 **API key segura** en variables de entorno (nunca se expone al navegador)

## 🚀 Quick Start

```bash
git clone https://github.com/noahxsu777/tts-web-app.git
cd tts-web-app
npm install
cp .env.example .env   # añade tu TIK_TOOLS_API_KEY
npm start
```

Abre `http://localhost:3000`.

## 🔒 Variables de entorno

| Variable | Descripción |
|---|---|
| `TIK_TOOLS_API_KEY` | Tu API key de tik.tools (**requerido**) |
| `PORT` | Puerto del servidor (default: 3000) |
| `TIK_TOOLS_API_BASE` | Base de la API (default: `https://api.tik.tools`) |

> ⚠️ La API key vive solo en el servidor (`.env`, ignorado por git). El frontend consume `/api/leaderboard` sin exponer credenciales.

## 📡 API interna

### GET `/api/leaderboard`
Devuelve el ranking cacheado (se refresca solo cada 24h).

```json
{
  "success": true,
  "updatedAt": "2026-06-12T08:00:00.000Z",
  "nextRefresh": "2026-06-13T08:00:00.000Z",
  "total": 50,
  "users": [
    { "rank": 1, "username": "creator", "nickname": "Creator", "avatar": "https://…", "score": 152000, "viewers": 12400, "followers": 2400000, "isLive": true }
  ]
}
```

### POST `/api/leaderboard/refresh`
Fuerza una recarga inmediata del ranking (útil para pruebas).

### GET `/api/health`
Estado del servidor.

## 🔄 Cómo funciona la recarga diaria

1. Al arrancar, el servidor carga la última caché de `data/leaderboard.json` y la refresca si tiene más de 24h.
2. Un temporizador comprueba cada 15 minutos si la caché ha caducado y, en ese caso, vuelve a llamar a la API de tik.tools.
3. El frontend muestra una **cuenta atrás en directo** hasta la próxima recarga y se actualiza solo cuando llega a cero.

## 🚀 Deploy en Fly.io

```bash
fly auth login
fly secrets set TIK_TOOLS_API_KEY=tu_api_key
fly deploy
fly open
```

## 🏗️ Estructura

```
tts-web-app/
├── server.js          # Backend Express: fetch + caché diaria + API
├── public/
│   ├── index.html     # UI principal
│   ├── styles.css     # Estilos, animaciones 3D CSS
│   └── app.js         # Three.js, podio, tabla, countdown
├── data/              # Caché del ranking (gitignored)
├── Dockerfile
├── fly.toml
└── .env.example
```

## 🛠️ Stack

- **Backend:** Node.js 18, Express, fetch nativo
- **Frontend:** HTML5, CSS3 (3D transforms, glassmorphism), Vanilla JS, Three.js
- **Deploy:** Fly.io / Docker

## 📝 Licencia

MIT — Noah
