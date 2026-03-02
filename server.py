import asyncio
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any

from aiohttp import WSMsgType, web


TICK_MS = 1000 / 60
TICK_S = TICK_MS / 1000
MAX_PLAYERS = 8


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
				"players": [{"playerIndex": p.player_index, "ready": p.ready} for p in self.players()],
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


room = Room()


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
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
		room.players_by_index.pop(player.player_index, None)
		await room.stop()
		await room.broadcast_status()

	return ws


def create_app(static_dir: str) -> web.Application:
	app = web.Application()
	app.router.add_get("/ws", ws_handler)
	app.router.add_static("/", static_dir, show_index=True)
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
