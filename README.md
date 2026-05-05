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

## Multiplayer AI harness

Run protocol-level AI clients against a local game. Bot 1 creates/hosts the room settings, all bots set name/color, ready up, send movement/fire inputs, and print JSON observations for assigned seats, lobby colors, game-start colors, missile capacity, ticks, and inputs sent.

```bash
./.venv/bin/python tools/ai_harness.py --start-server --port 8765 --base-url http://127.0.0.1:8765 --bots 2 --duration 1
```

Useful options:

- `--bots 8` exercises the full room size.
- `--game-mode stock --stock-lives 3 --max-shots 4` verifies host-controlled mode settings.
- Exit code is `0` only when validation passes; color mismatches are reported in `validation.errors`.
