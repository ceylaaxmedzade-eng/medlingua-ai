MedLingua AI — Local prototype

This repository contains a small frontend (HTML/CSS/JS) and a minimal Node/Express backend that proxies calls to the OpenAI API.

Files:
- `index.html`, `style.css`, `app.js` — frontend
- `server.js` — minimal Express backend with `/api/translate`
- `package.json` — Node dependencies
- `.env.example` — copy to `.env` and add `OPENAI_API_KEY`

Quick setup (manual steps):
1. Copy `.env.example` to `.env` and add your OpenAI key.
2. Install dependencies:
   - `npm install`
3. Start server:
   - `npm start`
4. Open `index.html` in browser or use Live Server in VS Code, then set frontend to call backend at `http://localhost:3000` (if served separately). 

Security notes:
- Do NOT commit your API key. Keep it in `.env` or a secure secret store.
- For production, add authentication and rate limiting.
