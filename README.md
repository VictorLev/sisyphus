# Sisyphus

A personal, self-hosted alternative to Zwift for the Elite Rivo smart trainer.
See [PROMPT.md](PROMPT.md) for the full project spec.

## Structure

- `frontend/` — plain HTML/CSS/JS, PWA-installable, all Web Bluetooth (FTMS) calls
- `backend/` — Node.js + Express, serves the frontend and persists data to SQLite

## Development

```sh
cd backend
cp .env.example .env
npm install
npm run dev
```

Then open http://localhost:3000 in Chrome (Web Bluetooth requires a secure
context — `localhost` counts).
