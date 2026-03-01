import {
  FUEL_PER_FRAME,
  GRAVITY_MULTIPLIERS,
  MAX_FUEL_SECONDS,
  MISSILE,
  PLANET,
  SHIP,
} from './constants.js';
import { createEntity, set } from './world.js';

export function spawnPlanet(world, { x, y }) {
  const planetId = spawnGravityWell(world, {
    x,
    y,
    mu: PLANET.mu,
    radius: PLANET.radius,
    color: PLANET.color,
    softening: PLANET.softening,
  });
  world.stores.planet.add(planetId);
  return planetId;
}

export function spawnGravityWell(world, { x, y, mu, radius, color, softening = 0 }) {
  const wellId = createEntity(world);
  set(world.stores.transform, wellId, { x, y, angle: 0 });
  set(world.stores.collider, wellId, { radius });
  set(world.stores.gravityWell, wellId, { mu, radius, color, softening });
  return wellId;
}

export function spawnShip(world, {
  playerIndex,
  color,
  x,
  y,
  vx,
  vy,
  angle,
  inputKeys,
  maxMissiles = SHIP.maxMissiles,
}) {
  const shipId = createEntity(world);

  set(world.stores.transform, shipId, { x, y, angle });
  set(world.stores.velocity, shipId, { x: vx, y: vy });
  set(world.stores.collider, shipId, { radius: SHIP.width });
  set(world.stores.ship, shipId, {
    playerIndex,
    color,
    width: SHIP.width,
    height: SHIP.height,
    rotationSpeed: SHIP.rotationSpeed,
    thrustPower: SHIP.thrustPower,
    maxMissiles,
    thrusted: false,
    wellContact: false,
  });
  set(world.stores.score, shipId, { value: 0 });
  set(world.stores.fuel, shipId, { value: MAX_FUEL_SECONDS, max: MAX_FUEL_SECONDS });
  set(world.stores.gravityMultiplier, shipId, GRAVITY_MULTIPLIERS.ship);
  set(world.stores.playerInput, shipId, inputKeys);

  return shipId;
}

export function respawnShip(world, shipId, planetId, invulnerableMs = SHIP.invulnerableMs) {
  const canvas = world.resources.canvas;
  const planetT = world.stores.transform.get(planetId);
  const well = world.stores.gravityWell.get(planetId);
  const ship = world.stores.ship.get(shipId);

  const distance = world.resources.spawnDistance ?? SHIP.initialDistance;
  const multRaw = Number(world.stores.gravityMultiplier.get(shipId) ?? GRAVITY_MULTIPLIERS.ship ?? 1);
  const mult = Number.isFinite(multRaw) ? Math.max(0, multRaw) : 1;

  // Gravity strength is scaled by the per-entity gravity multiplier, so the
  // circular/orbital starting velocity should scale with sqrt(multiplier).
  const circularVelocity = 0.9 * Math.sqrt(((well?.mu ?? PLANET.mu) * mult) / distance);

  const isP1 = ship.playerIndex === 1;
  const x = planetT.x + (isP1 ? -distance : distance);
  const y = planetT.y;

  const vx = 0;
  const vy = isP1 ? -circularVelocity : circularVelocity;

  const angle = (Math.atan2(vy, vx) + Math.PI * 2) % (Math.PI * 2);

  set(world.stores.transform, shipId, { x, y, angle });
  set(world.stores.velocity, shipId, { x: vx, y: vy });

  const fuel = world.stores.fuel.get(shipId);
  fuel.value = fuel.max;

  ship.thrusted = false;
  ship.wellContact = false;

  const nowMs = world.resources.now();
  world.stores.invulnerableUntilMs.set(shipId, nowMs + invulnerableMs);

  // When enabled, missiles do not persist across respawns.
  // When disabled, missiles continue to exist after the ship respawns.
  if (world.resources.missilesDieWithShip) {
    // Clear missiles owned by this ship (without effects).
    for (const [mid, owner] of world.stores.owner) {
      if (owner.id === shipId) {
        world.dead.add(mid);
      }
    }
  }

  // Keep inside canvas bounds in case of tiny resize.
  const t = world.stores.transform.get(shipId);
  t.x = Math.max(0, Math.min(canvas.width, t.x));
  t.y = Math.max(0, Math.min(canvas.height, t.y));
}

export function spawnMissile(world, { shipId }) {
  const shipT = world.stores.transform.get(shipId);
  const shipV = world.stores.velocity.get(shipId);
  const ship = world.stores.ship.get(shipId);

  const missileId = createEntity(world);

  const x = shipT.x + (ship.height / 2) * Math.cos(shipT.angle);
  const y = shipT.y + (ship.height / 2) * Math.sin(shipT.angle);

  const vx = shipV.x + MISSILE.speed * Math.cos(shipT.angle);
  const vy = shipV.y + MISSILE.speed * Math.sin(shipT.angle);

  set(world.stores.transform, missileId, { x, y, angle: 0 });
  set(world.stores.velocity, missileId, { x: vx, y: vy });
  set(world.stores.collider, missileId, { radius: 4 });
  set(world.stores.missile, missileId, {
    color: ship.color,
    spawnMs: world.resources.now(),
    ttlMs: MISSILE.ttlMs,
    graceMs: MISSILE.collisionGraceMs,
  });
  set(world.stores.owner, missileId, { id: shipId });
  set(world.stores.gravityMultiplier, missileId, GRAVITY_MULTIPLIERS.missile);

  return missileId;
}

export function resetScores(world) {
  for (const [shipId, score] of world.stores.score) {
    score.value = 0;
  }
}

export function countActiveMissiles(world, shipId) {
  let count = 0;
  for (const [mid, owner] of world.stores.owner) {
    if (owner.id === shipId && !world.dead.has(mid) && world.entities.has(mid)) count++;
  }
  return count;
}

export function canFire(world, shipId) {
  const ship = world.stores.ship.get(shipId);
  const active = countActiveMissiles(world, shipId);
  return active < ship.maxMissiles;
}

export function burnFuel(world, shipId, dtFactor) {
  const fuel = world.stores.fuel.get(shipId);
  if (!fuel || fuel.value <= 0) return false;
  fuel.value = Math.max(0, fuel.value - FUEL_PER_FRAME * dtFactor);
  return fuel.value > 0;
}
