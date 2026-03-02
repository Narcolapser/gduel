import asyncio
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any

from aiohttp import WSMsgType, web


TICK_MS = 1000 / 60
TICK_S = TICK_MS / 1000


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


P1_KEYS = {"w", "a", "d", "s"}
P2_KEYS = {"arrowup", "arrowleft", "arrowright", "arrowdown"}


@dataclass
class PlayerConn:
	ws: web.WebSocketResponse
	player_index: int
	ready: bool = False
	keys: dict[str, bool] = field(default_factory=dict)
	pending_just_pressed: set[str] = field(default_factory=set)

	def allowed_keys(self) -> set[str]:
		return P1_KEYS if self.player_index == 1 else P2_KEYS

	def set_key(self, key: str, down: bool) -> None:
		allowed = self.allowed_keys()
		if key not in allowed:
			return
		prev = bool(self.keys.get(key, False))
		if down and not prev:
			self.pending_just_pressed.add(key)
		self.keys[key] = bool(down)

	def drain_just_pressed(self) -> list[str]:
		out = list(self.pending_just_pressed)
		self.pending_just_pressed.clear()
		return out


@dataclass
class Room:
	p1: PlayerConn | None = None
	p2: PlayerConn | None = None
	started: bool = False
	tick_task: asyncio.Task | None = None
	config: dict[str, Any] | None = None

	def connected_count(self) -> int:
		return int(self.p1 is not None) + int(self.p2 is not None)

	def ready_count(self) -> int:
		return int(bool(self.p1 and self.p1.ready)) + int(bool(self.p2 and self.p2.ready))

	def both_connected(self) -> bool:
		return self.p1 is not None and self.p2 is not None

	def both_ready(self) -> bool:
		return bool(self.p1 and self.p2 and self.p1.ready and self.p2.ready)

	def players(self) -> list[PlayerConn]:
		return [p for p in [self.p1, self.p2] if p is not None]

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
				"ready": {
					"1": bool(self.p1 and self.p1.ready),
					"2": bool(self.p2 and self.p2.ready),
				},
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
		while self.started and self.both_connected():
			next_t += TICK_S

			# Merge keys for lockstep simulation.
			keys: dict[str, bool] = {}
			just_pressed: set[str] = set()
			if self.p1 is not None:
				keys.update(self.p1.keys)
				just_pressed.update(self.p1.drain_just_pressed())
			if self.p2 is not None:
				keys.update(self.p2.keys)
				just_pressed.update(self.p2.drain_just_pressed())

			msg = {"type": "tick", "dtMs": TICK_MS, "keys": keys, "justPressed": sorted(just_pressed)}
			await self.broadcast(msg)

			# Sleep with drift correction.
			delay = next_t - loop.time()
			if delay > 0:
				await asyncio.sleep(delay)


room = Room()


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
	ws = web.WebSocketResponse(heartbeat=20)
	await ws.prepare(request)

	player: PlayerConn | None = None
	if room.p1 is None:
		player = PlayerConn(ws=ws, player_index=1)
		room.p1 = player
	elif room.p2 is None:
		player = PlayerConn(ws=ws, player_index=2)
		room.p2 = player
	else:
		await ws_send_json(ws, {"type": "full", "message": "Room is full (2 players)."})
		await ws.close()
		return ws

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
					key = normalize_key(data.get("key"))
					down = bool(data.get("down"))
					player.set_key(key, down)

				elif mtype == "end":
					# Either client can end the current match.
					await room.stop()
					for p in room.players():
						p.ready = False
						p.keys.clear()
						p.pending_just_pressed.clear()
					await room.broadcast_status()

				elif mtype == "ping":
					await ws_send_json(ws, {"type": "pong"})

			elif msg.type in (WSMsgType.CLOSE, WSMsgType.ERROR):
				break
	finally:
		# Cleanup.
		if room.p1 is player:
			room.p1 = None
		if room.p2 is player:
			room.p2 = None
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
