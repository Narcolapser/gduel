#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse, urlunparse

from aiohttp import ClientSession, WSMsgType


DEFAULT_CONFIG = {
	"mapId": "classic",
	"borderMode": "outerSpace",
	"maxShots": 3,
	"gameMode": "point",
	"objectiveScore": 5,
	"stockLives": 5,
	"timedLengthSeconds": 120,
	"missilesDieWithShip": False,
	"gameSpeed": 1.0,
	"extraBots": 0,
}

CLIENT_PALETTE = [
	"#00F5FF",
	"#FF3B30",
	"#34FF00",
	"#FFD60A",
	"#7B2CFF",
	"#FF9500",
	"#00D4FF",
	"#FF006E",
]


def ws_url_for(base_url: str, room_id: str) -> str:
	parsed = urlparse(base_url)
	scheme = "wss" if parsed.scheme == "https" else "ws"
	path = f"/ws/{room_id}" if room_id else "/ws"
	return urlunparse((scheme, parsed.netloc, path, "", "", ""))


async def wait_for_server(base_url: str, timeout_s: float) -> None:
	deadline = time.monotonic() + timeout_s
	last_error = None
	while time.monotonic() < deadline:
		try:
			async with ClientSession() as session:
				async with session.get(base_url) as response:
					if response.status < 500:
						return
		except Exception as exc:
			last_error = exc
		await asyncio.sleep(0.1)
	raise RuntimeError(f"server did not become ready at {base_url}: {last_error}")


async def create_room(base_url: str) -> str:
	async with ClientSession() as session:
		async with session.post(f"{base_url.rstrip('/')}/api/rooms", json={}) as response:
			if response.status != 200:
				raise RuntimeError(f"create room failed with HTTP {response.status}")
			payload = await response.json()
	room_id = payload.get("roomId")
	if not isinstance(room_id, str) or not room_id:
		raise RuntimeError(f"create room response missing roomId: {payload}")
	return room_id


@dataclass
class BotObservation:
	bot_id: int
	name_requested: str
	color_requested: str
	player_index: int | None = None
	observer: bool = False
	profile_name_observed: str | None = None
	lobby_color_observed: str | None = None
	game_color_observed: str | None = None
	ready_observed: bool = False
	room_players_seen: list[dict[str, Any]] = field(default_factory=list)
	start_config: dict[str, Any] | None = None
	missile_capacity_observed: int | None = None
	ticks_observed: int = 0
	inputs_sent: int = 0
	fire_presses_sent: int = 0
	messages_seen: dict[str, int] = field(default_factory=dict)
	errors: list[str] = field(default_factory=list)

	def bump(self, message_type: str) -> None:
		self.messages_seen[message_type] = self.messages_seen.get(message_type, 0) + 1


class HarnessBot:
	def __init__(self, bot_id: int, name: str, color: str, ws_url: str, config: dict[str, Any] | None):
		self.bot_id = bot_id
		self.name = name
		self.color = color
		self.ws_url = ws_url
		self.config = config
		self.observation = BotObservation(bot_id=bot_id, name_requested=name, color_requested=color)
		self.ws = None
		self.started = asyncio.Event()
		self.profile_seen = asyncio.Event()
		self.closed = asyncio.Event()

	async def connect(self, session: ClientSession) -> None:
		self.ws = await session.ws_connect(self.ws_url, heartbeat=20)
		await self.send({"type": "profile", "name": self.name, "color": self.color, "observer": False})

	async def send(self, payload: dict[str, Any]) -> None:
		if self.ws is None or self.ws.closed:
			return
		await self.ws.send_str(json.dumps(payload, separators=(",", ":")))

	async def receive_loop(self) -> None:
		assert self.ws is not None
		try:
			async for msg in self.ws:
				if msg.type == WSMsgType.TEXT:
					self.handle_message(json.loads(msg.data))
				elif msg.type in (WSMsgType.CLOSE, WSMsgType.ERROR):
					break
		except Exception as exc:
			self.observation.errors.append(str(exc))
		finally:
			self.closed.set()

	def handle_message(self, message: dict[str, Any]) -> None:
		message_type = message.get("type")
		if not isinstance(message_type, str):
			return
		self.observation.bump(message_type)

		if message_type == "assigned":
			self.observation.player_index = message.get("playerIndex")
			self.observation.observer = bool(message.get("observer"))
		elif message_type == "profile":
			self.observation.profile_name_observed = message.get("name")
			self.observation.lobby_color_observed = message.get("color")
			self.observation.observer = bool(message.get("observer"))
			self.profile_seen.set()
		elif message_type == "room":
			players = message.get("players")
			if isinstance(players, list):
				self.observation.room_players_seen = players
				for player in players:
					if player.get("playerIndex") == self.observation.player_index:
						self.observation.ready_observed = bool(player.get("ready"))
		elif message_type == "start":
			config = message.get("config")
			if isinstance(config, dict):
				self.observation.start_config = config
				self.observation.missile_capacity_observed = config.get("maxShots")
			player_colors = message.get("playerColors")
			if isinstance(player_colors, dict) and self.observation.player_index is not None:
				self.observation.game_color_observed = player_colors.get(str(self.observation.player_index))
			self.started.set()
		elif message_type == "tick":
			self.observation.ticks_observed += 1

	async def ready(self) -> None:
		payload: dict[str, Any] = {"type": "ready"}
		if self.config is not None:
			payload["config"] = self.config
		await self.send(payload)

	async def drive(self, duration_s: float) -> None:
		if self.observation.observer:
			return
		try:
			await asyncio.wait_for(self.started.wait(), timeout=10)
		except TimeoutError:
			self.observation.errors.append("timed out waiting for start before driving")
			return

		end_at = time.monotonic() + duration_s
		turn_action = "left" if self.bot_id % 2 else "right"
		await self.input("thrust", True)
		await self.input(turn_action, True)
		while time.monotonic() < end_at:
			await self.input("fire", True)
			self.observation.fire_presses_sent += 1
			await asyncio.sleep(0.05)
			await self.input("fire", False)
			await asyncio.sleep(0.35)
		await self.input(turn_action, False)
		await self.input("thrust", False)

	async def input(self, action: str, down: bool) -> None:
		await self.send({"type": "input", "action": action, "down": down})
		self.observation.inputs_sent += 1

	async def close(self) -> None:
		if self.ws is not None and not self.ws.closed:
			await self.ws.close()


def validate(observations: list[BotObservation]) -> list[str]:
	errors: list[str] = []
	for obs in observations:
		prefix = f"bot {obs.bot_id}"
		if obs.player_index is None:
			errors.append(f"{prefix}: was not assigned a player index")
		if obs.lobby_color_observed is None:
			errors.append(f"{prefix}: did not observe lobby profile color")
		if obs.game_color_observed is None:
			errors.append(f"{prefix}: did not observe game color in start payload")
		if obs.lobby_color_observed != obs.game_color_observed:
			errors.append(
				f"{prefix}: lobby color {obs.lobby_color_observed} did not match game color {obs.game_color_observed}"
			)
		if obs.color_requested.lower() != str(obs.lobby_color_observed).lower():
			errors.append(
				f"{prefix}: requested color {obs.color_requested} became lobby color {obs.lobby_color_observed}"
			)
		if obs.missile_capacity_observed is None:
			errors.append(f"{prefix}: did not observe missile capacity from game config")
		if obs.ticks_observed <= 0:
			errors.append(f"{prefix}: did not observe game ticks")
		errors.extend(f"{prefix}: {err}" for err in obs.errors)
	return errors


async def run_harness(args: argparse.Namespace) -> dict[str, Any]:
	config = dict(DEFAULT_CONFIG)
	config.update(
		{
			"gameMode": args.game_mode,
			"maxShots": args.max_shots,
			"objectiveScore": args.objective_score,
			"stockLives": args.stock_lives,
			"timedLengthSeconds": args.timed_length_seconds,
			"missilesDieWithShip": args.missiles_die_with_ship,
			"gameSpeed": args.game_speed,
			"extraBots": args.extra_bots,
		}
	)

	room_id = args.room_id or await create_room(args.base_url)
	ws_url = ws_url_for(args.base_url, room_id)
	bots = [
		HarnessBot(i + 1, f"{args.name_prefix}{i + 1}", CLIENT_PALETTE[i % len(CLIENT_PALETTE)], ws_url, config if i == 0 else None)
		for i in range(args.bots)
	]

	async with ClientSession() as session:
		for bot in bots:
			await bot.connect(session)
		receivers = [asyncio.create_task(bot.receive_loop()) for bot in bots]
		await asyncio.gather(*(asyncio.wait_for(bot.profile_seen.wait(), timeout=5) for bot in bots))

		await bots[0].send({"type": "config", "config": config})
		await asyncio.sleep(0.2)
		await asyncio.gather(*(bot.ready() for bot in bots))
		await asyncio.gather(*(asyncio.wait_for(bot.started.wait(), timeout=10) for bot in bots))
		await asyncio.gather(*(bot.drive(args.duration) for bot in bots))
		await asyncio.sleep(0.2)
		await asyncio.gather(*(bot.close() for bot in bots))
		await asyncio.gather(*receivers, return_exceptions=True)

	observations = [bot.observation for bot in bots]
	validation_errors = validate(observations)
	return {
		"roomId": room_id,
		"wsUrl": ws_url,
		"configRequested": config,
		"observations": [obs.__dict__ for obs in observations],
		"validation": {"ok": not validation_errors, "errors": validation_errors},
	}


def start_server(args: argparse.Namespace) -> subprocess.Popen[str]:
	cmd = [sys.executable, "server.py", str(args.port), args.static_dir]
	env = os.environ.copy()
	env.setdefault("PYTHONUNBUFFERED", "1")
	return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Run WebSocket AI bots against a local gduel room.")
	parser.add_argument("--base-url", default="http://127.0.0.1:8000")
	parser.add_argument("--room-id", default=None, help="Existing room id. If omitted, the harness creates one.")
	parser.add_argument("--bots", type=int, default=2, help="Number of harness bots, 2-8.")
	parser.add_argument("--duration", type=float, default=3.0, help="Seconds to move after game start.")
	parser.add_argument("--name-prefix", default="HarnessBot")
	parser.add_argument("--start-server", action="store_true", help="Start server.py before running bots.")
	parser.add_argument("--port", type=int, default=8000)
	parser.add_argument("--static-dir", default=".")
	parser.add_argument("--server-timeout", type=float, default=5.0)
	parser.add_argument("--game-mode", choices=["point", "stock", "timed"], default="point")
	parser.add_argument("--max-shots", type=int, default=3)
	parser.add_argument("--objective-score", type=int, default=5)
	parser.add_argument("--stock-lives", type=int, default=5)
	parser.add_argument("--timed-length-seconds", type=int, default=120)
	parser.add_argument("--missiles-die-with-ship", action="store_true")
	parser.add_argument("--game-speed", type=float, default=1.0)
	parser.add_argument("--extra-bots", type=int, default=0)
	args = parser.parse_args()
	if args.bots < 2 or args.bots > 8:
		parser.error("--bots must be between 2 and 8")
	if args.start_server:
		args.base_url = re.sub(r":\d+(?=/|$)", f":{args.port}", args.base_url)
	return args


def main() -> int:
	args = parse_args()
	server = None
	try:
		if args.start_server:
			server = start_server(args)
		asyncio.run(wait_for_server(args.base_url, args.server_timeout))
		result = asyncio.run(run_harness(args))
		print(json.dumps(result, indent=2, sort_keys=True))
		return 0 if result["validation"]["ok"] else 1
	finally:
		if server is not None:
			server.send_signal(signal.SIGTERM)
			try:
				server.wait(timeout=3)
			except subprocess.TimeoutExpired:
				server.kill()


if __name__ == "__main__":
	raise SystemExit(main())
