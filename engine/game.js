import { GRAVITY_MULTIPLIERS, PLANET, SHIP } from './constants.js';
import { createWorld } from './world.js';
import { createMap } from './maps.js';
import { resetScores, resetStats, respawnShip, spawnShip } from './spawn.js';

const DEFAULT_PLAYER_COLORS = [
  '#00ff00',
  '#ff0000',
  '#00b7ff',
  '#ffcc00',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
  '#ff8000',
];

function pseudoInputKeys(playerIndex) {
  const p = `p${playerIndex}:`;
  return {
    thrust: p + 'thrust',
    left: p + 'left',
    right: p + 'right',
    fire: p + 'fire',
  };
}

export function createMatch({
  canvas,
  ctx,
  document,
  maxMissiles = SHIP.maxMissiles,
  mapId = 'classic',
  playerOrder = null,
  playerColors = null,
  onlineControls = false,
}) {
  const world = createWorld({ canvas, ctx, document });

  const map = createMap(world, { mapId, width: canvas.width, height: canvas.height });
  const planetId = map.anchorId;

  // Per-map spawn tuning (used for initial spawn + respawns).
  world.resources.spawnDistance = map.spawnDistance ?? SHIP.initialDistance;

  // Choose a reasonable spawn mu: if the anchor isn't a well (most maps),
  // use the default PLANET tuning.
  const spawnMu = PLANET.mu;

  const shipGravityMultRaw = Number(GRAVITY_MULTIPLIERS.ship ?? 1);
  const shipGravityMult = Number.isFinite(shipGravityMultRaw) ? Math.max(0, shipGravityMultRaw) : 1;

  const distance = world.resources.spawnDistance;
  // Gravity strength is scaled by the per-entity gravity multiplier, so the
  // circular/orbital starting velocity should scale with sqrt(multiplier).
  const circularVelocity = 0.9 * Math.sqrt((spawnMu * shipGravityMult) / distance);

  const anchorT = world.stores.transform.get(planetId);
  const cx = anchorT?.x ?? canvas.width / 2;
  const cy = anchorT?.y ?? canvas.height / 2;

  const order = Array.isArray(playerOrder) && playerOrder.length > 0 ? playerOrder.slice() : [1, 2];
  const seatCount = order.length;

  const shipIds = [];
  function resolvePlayerColor(playerIndex) {
    if (playerColors && typeof playerColors === 'object') {
      const key = String(playerIndex);
      const color = playerColors[key] ?? playerColors[playerIndex];
      if (typeof color === 'string' && color.trim().length > 0) return color;
    }
    return DEFAULT_PLAYER_COLORS[(playerIndex - 1) % DEFAULT_PLAYER_COLORS.length];
  }

  for (let seatIndex = 0; seatIndex < order.length; seatIndex++) {
    const playerIndex = order[seatIndex];
    const theta = Math.PI + (seatIndex * (Math.PI * 2)) / seatCount;

    const x = cx + distance * Math.cos(theta);
    const y = cy + distance * Math.sin(theta);

    const vx = circularVelocity * -Math.sin(theta);
    const vy = circularVelocity * Math.cos(theta);
    const angle = (Math.atan2(vy, vx) + Math.PI * 2) % (Math.PI * 2);

    const inputKeys = onlineControls
      ? pseudoInputKeys(playerIndex)
      : playerIndex === 1
        ? { thrust: 'w', left: 'a', right: 'd', fire: 's' }
        : { thrust: 'arrowup', left: 'arrowleft', right: 'arrowright', fire: 'arrowdown' };

    const shipId = spawnShip(world, {
      playerIndex,
      color: resolvePlayerColor(playerIndex),
      x,
      y,
      vx,
      vy,
      angle,
      inputKeys,
      seatIndex,
      seatCount,
      maxMissiles,
    });
    shipIds.push(shipId);
  }

  // Keep legacy shape for existing codepaths.
  const ship1Id = shipIds[0] ?? null;
  const ship2Id = shipIds[1] ?? null;

  return { world, planetId, shipIds, ship1Id, ship2Id, mapId: map.id, playerOrder: order };
}

export function setBotEnabled(world, shipId, enabled) {
  world.stores.bot.set(shipId, { enabled: Boolean(enabled) });
}

export function resetMatch(world, { planetId, ship1Id, ship2Id }) {
  resetScores(world);
  resetStats(world);
  if (Array.isArray(arguments[1]?.shipIds) && arguments[1].shipIds.length > 0) {
    for (const sid of arguments[1].shipIds) respawnShip(world, sid, planetId, 0);
  } else {
    respawnShip(world, ship1Id, planetId, 0);
    respawnShip(world, ship2Id, planetId, 0);
  }

  world.resources.gameTimeMs = 0;
  world.resources.explosions = [];
  world.resources.noFuelStartMs = null;
}

export function resizeMatch(world, { planetId }, { width, height }) {
  world.resources.canvas.width = width;
  world.resources.canvas.height = height;

  const cx = width / 2;
  const cy = height / 2;

  // Always re-center the spawn anchor.
  const anchorT = world.stores.transform.get(planetId);
  if (anchorT) {
    anchorT.x = cx;
    anchorT.y = cy;
  }

  // Any non-orbiting gravity well is considered "centered".
  for (const [wellId] of world.stores.gravityWell) {
    if (world.stores.orbit.has(wellId)) continue;
    const t = world.stores.transform.get(wellId);
    if (!t) continue;
    t.x = cx;
    t.y = cy;
  }
}
