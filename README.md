# gduel

Local multiplayer browser game + optional single-room online mode (WebSocket).

## Deploy with Docker Compose

On your server (with Docker + Docker Compose v2):

```bash
git clone <your-repo-url>
cd gduel
docker compose up -d --build
```

Then open:
- `http://<server-ip-or-hostname>:8000/` (or `http://.../game.html`)

### Notes
- The WebSocket endpoint is served from the same origin at `/ws`.
- For HTTPS + WSS, put this behind a reverse proxy (nginx/caddy/traefik) and forward the same port/path.

## Development (no Docker)

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python server.py 8000 .
```
