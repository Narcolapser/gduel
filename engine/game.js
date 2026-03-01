import { PLANET, SHIP } from './constants.js';
import { createWorld } from './world.js';
import { createMap } from './maps.js';
import { resetScores, respawnShip, spawnShip } from './spawn.js';

export function createMatch({ canvas, ctx, document, maxMissiles = SHIP.maxMissiles, mapId = 'classic' }) {
  const world = createWorld({ canvas, ctx, document });

  const map = createMap(world, { mapId, width: canvas.width, height: canvas.height });
  const planetId = map.anchorId;

  // Per-map spawn tuning (used for initial spawn + respawns).
  world.resources.spawnDistance = map.spawnDistance ?? SHIP.initialDistance;

  // Choose a reasonable spawn mu: if the anchor isn't a well (most maps),
  // use the default PLANET tuning.
  const spawnMu = PLANET.mu;

  const distance = world.resources.spawnDistance;
  const circularVelocity = 0.9 * Math.sqrt(spawnMu / distance);

  const anchorT = world.stores.transform.get(planetId);
  const cx = anchorT?.x ?? canvas.width / 2;
  const cy = anchorT?.y ?? canvas.height / 2;

  const ship1Id = spawnShip(world, {
    playerIndex: 1,
    color: '#00ff00',
    x: cx - distance,
    y: cy,
    vx: 0,
    vy: -circularVelocity,
    angle: 1.5,
    inputKeys: { thrust: 'w', left: 'a', right: 'd', fire: 's' },
    maxMissiles,
  });

  const ship2Id = spawnShip(world, {
    playerIndex: 2,
    color: '#ff0000',
    x: cx + distance,
    y: cy,
    vx: 0,
    vy: circularVelocity,
    angle: 4.75,
    inputKeys: { thrust: 'arrowup', left: 'arrowleft', right: 'arrowright', fire: 'arrowdown' },
    maxMissiles,
  });

  return { world, planetId, ship1Id, ship2Id, mapId: map.id };
}

export function setBotEnabled(world, shipId, enabled) {
  world.stores.bot.set(shipId, { enabled: Boolean(enabled) });
}

export function resetMatch(world, { planetId, ship1Id, ship2Id }) {
  resetScores(world);
  respawnShip(world, ship1Id, planetId, 0);
  respawnShip(world, ship2Id, planetId, 0);

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
