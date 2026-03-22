import asyncio
import json
import os
import secrets
import sys
import re
from dataclasses import dataclass, field
from typing import Any

from aiohttp import WSMsgType, web


TICK_MS = 1000 / 60
TICK_S = TICK_MS / 1000
MAX_PLAYERS = 8
ROOM_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{6,16}$")
COLOR_PALETTE = [
	"#00d9ff",
	"#ff6b35",
	"#ffd166",
	"#06d6a0",
	"#8ecae6",
	"#b5179e",
	"#f72585",
	"#3a86ff",
	"#8338ec",
	"#ffbe0b",
	"#fb5607",
	"#ff006e",
	"#3a0ca3",
	"#4cc9f0",
	"#2ec4b6",
	"#a7c957",
]


def _json_dumps(obj: Any) -> str:
	return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


async def ws_send_json(ws: web.WebSocketResponse, obj: Any) -> None:
	if ws.closed:
		return
	await ws.send_str(_json_dumps(obj))


def clamp_int(value: Any, default: int, *, min_value: int, max_value: int) -> int:
	try:
		n = int(value)
	except Exception:
		return default
	return max(min_value, min(max_value, n))


def clamp_float(value: Any, default: float, *, min_value: float, max_value: float) -> float:
	try:
		n = float(value)
	except Exception:
		return default
	return max(min_value, min(max_value, n))


def normalize_key(k: Any) -> str:
	if not isinstance(k, str):
		return ""
	return k.lower().strip()


VALID_ACTIONS = {"thrust", "left", "right", "fire"}



@dataclass
class PlayerConn:
	ws: web.WebSocketResponse
	player_index: int
	ready: bool = False
	actions: dict[str, bool] = field(default_factory=dict)
	pending_just_pressed_actions: set[str] = field(default_factory=set)
	name: str | None = None
	color: str | None = None

	def set_action(self, action: str, down: bool) -> None:
		if action not in VALID_ACTIONS:
			return
		prev = bool(self.actions.get(action, False))
		if down and not prev:
			self.pending_just_pressed_actions.add(action)
		self.actions[action] = bool(down)

	def drain_just_pressed_actions(self) -> list[str]:
		out = list(self.pending_just_pressed_actions)
		self.pending_just_pressed_actions.clear()
		return out


@dataclass
class Room:
	players_by_index: dict[int, PlayerConn] = field(default_factory=dict)
	started: bool = False
	tick_task: asyncio.Task | None = None
	config: dict[str, Any] | None = None

	def connected_count(self) -> int:
		return len(self.players_by_index)

	def ready_count(self) -> int:
		return sum(1 for p in self.players_by_index.values() if p.ready)

	def both_connected(self) -> bool:
		return self.connected_count() >= 2

	def both_ready(self) -> bool:
		# Start when >= 75% of connected users are ready.
		n = self.connected_count()
		if n < 2:
			return False
		return (self.ready_count() / n) >= 0.75

	def players(self) -> list[PlayerConn]:
		return [self.players_by_index[i] for i in sorted(self.players_by_index.keys())]

	async def broadcast(self, obj: Any) -> None:
		for p in self.players():
			try:
				await ws_send_json(p.ws, obj)
			except Exception:
				# We'll clean up on disconnect.
				pass

	async def broadcast_status(self) -> None:
		await self.broadcast(
			{
				"type": "room",
				"connected": self.connected_count(),
				"readyCount": self.ready_count(),
				"readyThreshold": 0.75,
				"players": [
					{
						"playerIndex": p.player_index,
						"ready": p.ready,
						"name": p.name,
						"color": p.color,
					}
					for p in self.players()
				],
				"started": self.started,
			}
		)

	def sanitize_config(self, incoming: Any) -> dict[str, Any]:
		cfg = incoming if isinstance(incoming, dict) else {}

		map_id = cfg.get("mapId") if cfg.get("mapId") in {"classic", "earth", "pluto"} else "classic"
		border_mode = (
			cfg.get("borderMode")
			if cfg.get("borderMode") in {"outerSpace", "concrete", "rubber", "wrap"}
			else "outerSpace"
		)

		return {
			"mapId": map_id,
			"borderMode": border_mode,
			"maxShots": clamp_int(cfg.get("maxShots"), 3, min_value=0, max_value=999),
			"objectiveScore": clamp_int(cfg.get("objectiveScore"), 5, min_value=1, max_value=999),
			"missilesDieWithShip": bool(cfg.get("missilesDieWithShip", False)),
			"gameSpeed": clamp_float(cfg.get("gameSpeed"), 1.0, min_value=0.5, max_value=4.0),
		}

	async def maybe_start(self) -> None:
		if self.started:
			return
		if not self.both_ready():
			return

		self.started = True
		player_order = [p.player_index for p in self.players()]
		player_colors = {
			str(p.player_index): p.color
			for p in self.players()
			if isinstance(p.color, str) and p.color
		}
		await self.broadcast(
			{
				"type": "start",
				"config": self.config
				or {
					"mapId": "classic",
					"borderMode": "outerSpace",
					"maxShots": 3,
					"objectiveScore": 5,
					"missilesDieWithShip": False,
					"gameSpeed": 1.0,
				},
				"tickMs": TICK_MS,
				"playerOrder": player_order,
				"playerColors": player_colors,
			}
		)

		if self.tick_task is None or self.tick_task.done():
			self.tick_task = asyncio.create_task(self.tick_loop())

	async def stop(self) -> None:
		self.started = False
		self.config = None
		if self.tick_task is not None:
			self.tick_task.cancel()
			try:
				await self.tick_task
			except Exception:
				pass
		self.tick_task = None

	async def tick_loop(self) -> None:
		loop = asyncio.get_running_loop()
		next_t = loop.time()
		while self.started and self.connected_count() >= 1:
			next_t += TICK_S

			# Build pseudo-key state the existing engine can consume.
			# Each ship listens to: p{idx}:thrust/left/right/fire
			keys: dict[str, bool] = {}
			just_pressed: set[str] = set()
			for p in self.players_by_index.values():
				prefix = f"p{p.player_index}:"
				for action, down in p.actions.items():
					keys[prefix + action] = bool(down)
				for action in p.drain_just_pressed_actions():
					if action == "fire":
						just_pressed.add(prefix + action)

			msg = {
				"type": "tick",
				"dtMs": TICK_MS,
				"keys": keys,
				"justPressed": sorted(just_pressed),
			}
			await self.broadcast(msg)

			# Sleep with drift correction.
			delay = next_t - loop.time()
			if delay > 0:
				await asyncio.sleep(delay)


rooms: dict[str, Room] = {}


def sanitize_color(value: Any) -> str | None:
	if not isinstance(value, str):
		return None
	color = value.strip()
	if re.fullmatch(r"#[0-9a-fA-F]{6}", color):
		return color.lower()
	if re.fullmatch(r"#[0-9a-fA-F]{3}", color):
		return color.lower()
	return None


def sanitize_name(value: Any) -> str | None:
	if not isinstance(value, str):
		return None
	name = value.strip()
	if not name:
		return None
	return name[:24]


def normalize_room_id(value: Any) -> str | None:
	if not isinstance(value, str):
		return None
	room_id = value.strip()
	if not ROOM_ID_RE.fullmatch(room_id):
		return None
	return room_id


def get_room(room_id: str) -> Room:
	room = rooms.get(room_id)
	if room is None:
		room = Room()
		rooms[room_id] = room
	return room


def pick_unique_color(room: Room, desired: str | None, *, player_index: int) -> str:
	used = {
		p.color
		for p in room.players_by_index.values()
		if p.player_index != player_index and isinstance(p.color, str)
	}
	palette = [c for c in COLOR_PALETTE if c not in used]

	if desired in COLOR_PALETTE and desired not in used:
		return desired
	if palette:
		return secrets.choice(palette)
	if desired in COLOR_PALETTE:
		return desired
	return secrets.choice(COLOR_PALETTE)


async def resolve_profile_color(room: Room, player: PlayerConn, desired: str | None) -> None:
	if desired not in COLOR_PALETTE:
		desired = None

	conflict = None
	if desired:
		for p in room.players_by_index.values():
			if p.player_index == player.player_index:
				continue
			if p.color == desired:
				conflict = p
				break

	if conflict is None:
		player.color = pick_unique_color(room, desired, player_index=player.player_index)
		return

	used_other = {
		p.color
		for p in room.players_by_index.values()
		if p.player_index not in (player.player_index, conflict.player_index) and isinstance(p.color, str)
	}
	available = [c for c in COLOR_PALETTE if c not in used_other and c != desired]
	if not available:
		player.color = desired
		return

	new_color = secrets.choice(available)
	if secrets.randbelow(2) == 0:
		conflict.color = new_color
		await ws_send_json(conflict.ws, {"type": "profile", "name": conflict.name, "color": conflict.color})
		player.color = desired
	else:
		player.color = new_color


def generate_room_id() -> str:
	for _ in range(10):
		room_id = secrets.token_hex(4)
		if room_id not in rooms:
			return room_id
	return secrets.token_hex(6)


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
	room_id = normalize_room_id(request.match_info.get("room_id")) or "lobby"
	room = get_room(room_id)
	ws = web.WebSocketResponse(heartbeat=20)
	await ws.prepare(request)

	if len(room.players_by_index) >= MAX_PLAYERS:
		await ws_send_json(ws, {"type": "full", "message": f"Room is full ({MAX_PLAYERS} players)."})
		await ws.close()
		return ws

	# Assign the lowest free player index.
	player_index = next(i for i in range(1, MAX_PLAYERS + 1) if i not in room.players_by_index)
	player = PlayerConn(ws=ws, player_index=player_index)
	room.players_by_index[player_index] = player

	await ws_send_json(ws, {"type": "assigned", "playerIndex": player.player_index})
	await room.broadcast_status()

	try:
		async for msg in ws:
			if msg.type == WSMsgType.TEXT:
				try:
					data = json.loads(msg.data)
				except Exception:
					continue

				if not isinstance(data, dict):
					continue

				mtype = data.get("type")

				if mtype == "profile":
					player.name = sanitize_name(data.get("name"))
					desired = sanitize_color(data.get("color"))
					await resolve_profile_color(room, player, desired)
					await ws_send_json(
						player.ws,
						{"type": "profile", "name": player.name, "color": player.color},
					)
					await room.broadcast_status()
					continue

				if mtype == "ready":
					player.ready = True
					if room.config is None:
						room.config = room.sanitize_config(data.get("config"))
					await room.broadcast_status()
					await room.maybe_start()

				elif mtype == "unready":
					player.ready = False
					await room.broadcast_status()

				elif mtype == "input":
					action = normalize_key(data.get("action"))
					down = bool(data.get("down"))
					player.set_action(action, down)

				elif mtype == "config":
					# Only Player 1 can change settings; only before the match starts.
					if player.player_index != 1:
						continue
					if room.started:
						continue
					room.config = room.sanitize_config(data.get("config"))

					# Clear readiness for everyone except player 1.
					for p in room.players_by_index.values():
						if p.player_index == 1:
							continue
						p.ready = False
						p.actions.clear()
						p.pending_just_pressed_actions.clear()

					await room.broadcast({"type": "config", "config": room.config})
					await room.broadcast_status()

				elif mtype == "end":
					# Either client can end the current match.
					await room.stop()
					for p in room.players():
						p.ready = False
						p.actions.clear()
						p.pending_just_pressed_actions.clear()
					await room.broadcast_status()

				elif mtype == "ping":
					await ws_send_json(ws, {"type": "pong"})

			elif msg.type in (WSMsgType.CLOSE, WSMsgType.ERROR):
				break
	finally:
		# Cleanup.
		left_index = player.player_index
		room.players_by_index.pop(player.player_index, None)

		if room.started:
			if room.connected_count() == 0:
				await room.stop()
			elif room.connected_count() == 1:
				await room.broadcast({"type": "leave", "playerIndex": left_index})
				winner = room.players()[0].player_index if room.players_by_index else None
				await room.broadcast({"type": "victory", "winnerPlayerIndex": winner})
				await room.stop()
				for p in room.players():
					p.ready = False
					p.actions.clear()
					p.pending_just_pressed_actions.clear()
				await room.broadcast_status()
			else:
				await room.broadcast({"type": "leave", "playerIndex": left_index})
				await room.broadcast_status()
		elif room.connected_count() == 0:
			await room.stop()
		else:
			await room.broadcast_status()
		if room.connected_count() == 0 and room_id != "lobby":
			rooms.pop(room_id, None)

	return ws


def create_app(static_dir: str) -> web.Application:
	app = web.Application()
	static_root = os.path.abspath(static_dir)

	async def index_handler(_: web.Request) -> web.FileResponse:
		path = os.path.join(static_dir, "index.html")
		return web.FileResponse(path)

	async def room_handler(request: web.Request) -> web.FileResponse:
		path = os.path.join(static_dir, "game.html")
		return web.FileResponse(path)

	async def create_room_handler(_: web.Request) -> web.Response:
		room_id = generate_room_id()
		rooms[room_id] = Room()
		payload = {"roomId": room_id, "roomUrl": f"/r/{room_id}"}
		return web.json_response(payload, dumps=_json_dumps)

	def resolve_static_path(rel_path: str) -> str | None:
		rel_path = rel_path.lstrip("/")
		if not rel_path:
			return None
		safe_path = os.path.normpath(os.path.join(static_root, rel_path))
		if not safe_path.startswith(static_root + os.sep):
			return None
		if not os.path.isfile(safe_path):
			return None
		return safe_path

	async def static_file_handler(request: web.Request) -> web.StreamResponse:
		path = resolve_static_path(request.match_info.get("path", ""))
		if path is None:
			raise web.HTTPNotFound()
		return web.FileResponse(path)

	app.router.add_get("/", index_handler)
	app.router.add_get("/r/{room_id}", room_handler)
	app.router.add_post("/api/rooms", create_room_handler)
	app.router.add_get("/ws", ws_handler)
	app.router.add_get("/ws/{room_id}", ws_handler)
	app.router.add_get("/{path:.*}", static_file_handler)
	return app


def main() -> None:
	static_dir = os.environ.get("GDUEL_STATIC", ".")
	host = os.environ.get("GDUEL_HOST", "0.0.0.0")
	port = int(os.environ.get("GDUEL_PORT", "8000"))

	# Optional CLI: python server.py [port] [static_dir]
	if len(sys.argv) >= 2:
		try:
			port = int(sys.argv[1])
		except Exception:
			pass
	if len(sys.argv) >= 3:
		static_dir = sys.argv[2]

	app = create_app(static_dir)
	print(f"Serving {static_dir} at http://{host}:{port}")
	print(f"WebSocket endpoint: ws://{host}:{port}/ws")
	web.run_app(app, host=host, port=port)


if __name__ == "__main__":
	main()
