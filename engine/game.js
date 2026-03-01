import { PLANET, SHIP } from './constants.js';
import { createWorld } from './world.js';
import { resetScores, respawnShip, spawnPlanet, spawnShip } from './spawn.js';

export function createMatch({ canvas, ctx, document }) {
  const world = createWorld({ canvas, ctx, document });

  const planetId = spawnPlanet(world, { x: canvas.width / 2, y: canvas.height / 2 });

  const distance = SHIP.initialDistance;
  const circularVelocity = 0.9 * Math.sqrt(PLANET.mu / distance);

  const ship1Id = spawnShip(world, {
    playerIndex: 1,
    color: '#00ff00',
    x: canvas.width / 2 - distance,
    y: canvas.height / 2,
    vx: 0,
    vy: -circularVelocity,
    angle: 1.5,
    inputKeys: { thrust: 'w', left: 'a', right: 'd', fire: 's' },
  });

  const ship2Id = spawnShip(world, {
    playerIndex: 2,
    color: '#ff0000',
    x: canvas.width / 2 + distance,
    y: canvas.height / 2,
    vx: 0,
    vy: circularVelocity,
    angle: 4.75,
    inputKeys: { thrust: 'arrowup', left: 'arrowleft', right: 'arrowright', fire: 'arrowdown' },
  });

  return { world, planetId, ship1Id, ship2Id };
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

  const planetT = world.stores.transform.get(planetId);
  if (planetT) {
    planetT.x = width / 2;
    planetT.y = height / 2;
  }
}
