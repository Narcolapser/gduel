import { BOUNDARY, MISSILE, NO_FUEL_TIMEOUT_MS, SHIP, TICK_MS, WINNING_SCORE } from './constants.js';
import { applyGravity } from './gravity.js';
import { createExplosionParticles, drawExplosions, updateExplosions } from './explosions.js';
import { burnFuel, canFire, countActiveMissiles, respawnShip, spawnMissile } from './spawn.js';
import { cleanupDead } from './world.js';

function dtFactorFromMs(dtMs) {
  // Keep legacy "per-frame" tuning stable.
  return dtMs / TICK_MS;
}

function getWells(world) {
  const wells = [];
  for (const [id, well] of world.stores.gravityWell) {
    const t = world.stores.transform.get(id);
    if (!t) continue;
    wells.push({ id, x: t.x, y: t.y, mu: well.mu, radius: well.radius, softening: well.softening });
  }
  return wells;
}

function isInvulnerable(world, shipId) {
  const until = world.stores.invulnerableUntilMs.get(shipId) ?? 0;
  return world.resources.now() < until;
}

function markExplosion(world, x, y, color) {
  world.resources.explosions.push(createExplosionParticles({ x, y, color }));
}

function killMissilesOwnedByShip(world, shipId, { explode }) {
  for (const [missileId, owner] of world.stores.owner) {
    if (owner.id !== shipId) continue;
    if (world.dead.has(missileId)) continue;
    if (!world.entities.has(missileId)) continue;
    if (!world.stores.missile.has(missileId)) continue;

    if (explode) {
      const t = world.stores.transform.get(missileId);
      const m = world.stores.missile.get(missileId);
      if (t && m) markExplosion(world, t.x, t.y, m.color);
    }
    world.dead.add(missileId);
  }
}

function shipIds(world) {
  const ids = [];
  for (const [id] of world.stores.ship) ids.push(id);
  return ids;
}

function isRespawning(world, shipId) {
  return world.stores.respawnAtMs.has(shipId);
}

function scheduleRespawnIfNeeded(world, shipId, nowMs) {
  if (world.stores.respawnAtMs.has(shipId)) return false;
  world.stores.respawnAtMs.set(shipId, nowMs + SHIP.respawnDelayMs);
  return true;
}

function ensureStats(world, shipId) {
  let stats = world.stores.stats.get(shipId);
  if (!stats) {
    stats = { kills: 0, deaths: 0, crashes: 0 };
    world.stores.stats.set(shipId, stats);
  }
  return stats;
}

function recordDeath(world, shipId, { crash = false } = {}) {
  const stats = ensureStats(world, shipId);
  stats.deaths += 1;
  if (crash) stats.crashes += 1;
}

function recordKill(world, shipId) {
  const stats = ensureStats(world, shipId);
  stats.kills += 1;
}

function missileIds(world) {
  const ids = [];
  for (const [id] of world.stores.missile) ids.push(id);
  return ids;
}

function applyPlayerAndBotInput(world, keys, justPressed, dtFactor) {
  for (const shipId of shipIds(world)) {
    if (isRespawning(world, shipId)) continue;

    const ship = world.stores.ship.get(shipId);
    const input = world.stores.playerInput.get(shipId);
    const isBot = world.stores.bot.get(shipId)?.enabled ?? false;

    ship.thrusted = false;

    if (isBot) continue;
    if (!input) continue;

    const t = world.stores.transform.get(shipId);
    const v = world.stores.velocity.get(shipId);

    if (keys[input.left]) t.angle -= ship.rotationSpeed * dtFactor;
    if (keys[input.right]) t.angle += ship.rotationSpeed * dtFactor;

    if (keys[input.thrust]) {
      if (burnFuel(world, shipId, dtFactor)) {
        v.x += ship.thrustPower * Math.cos(t.angle) * dtFactor;
        v.y += ship.thrustPower * Math.sin(t.angle) * dtFactor;
        ship.thrusted = true;
      }
    }

    if (justPressed.has(input.fire)) {
      ship._wantsFire = true;
    }
  }
}

function botSystem(world, dtFactor) {
  // Basic port of ai.js: acts by writing to velocity/angle and setting _wantsFire.
  const ships = shipIds(world);
  if (ships.length < 2) return;

  const [a, b] = ships;
  const pairs = [
    [a, b],
    [b, a],
  ];

  for (const [botId, targetId] of pairs) {
    if (isRespawning(world, botId) || isRespawning(world, targetId)) continue;

    const bot = world.stores.ship.get(botId);
    const botEnabled = world.stores.bot.get(botId)?.enabled ?? false;
    if (!botEnabled) continue;

    const tBot = world.stores.transform.get(botId);
    const vBot = world.stores.velocity.get(botId);
    const tTarget = world.stores.transform.get(targetId);

    const dx = tTarget.x - tBot.x;
    const dy = tTarget.y - tBot.y;
    let angleToTarget = Math.atan2(dy, dx);

    const randomness = (Math.random() - 0.5) * 0.5;
    angleToTarget += randomness;

    let angleDiff = angleToTarget - tBot.angle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    if (Math.abs(angleDiff) > 0.05) {
      if (angleDiff > 0) tBot.angle += bot.rotationSpeed * dtFactor;
      else tBot.angle -= bot.rotationSpeed * dtFactor;
    }

    const preferredDistance = 150;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > preferredDistance) {
      if (burnFuel(world, botId, dtFactor)) {
        vBot.x += bot.thrustPower * Math.cos(tBot.angle) * dtFactor;
        vBot.y += bot.thrustPower * Math.sin(tBot.angle) * dtFactor;
        bot.thrusted = true;
      }
    }

    const angleTolerance = 0.1;
    const firingDistance = 180;
    const firingChance = 0.05;

    if (
      canFire(world, botId) &&
      Math.abs(angleDiff) < angleTolerance &&
      distance < firingDistance &&
      Math.random() < firingChance
    ) {
      bot._wantsFire = true;
    }
  }
}

function fireSystem(world) {
  for (const shipId of shipIds(world)) {
    if (isRespawning(world, shipId)) {
      const ship = world.stores.ship.get(shipId);
      if (ship) ship._wantsFire = false;
      continue;
    }

    const ship = world.stores.ship.get(shipId);
    if (!ship._wantsFire) continue;
    ship._wantsFire = false;

    if (canFire(world, shipId)) {
      spawnMissile(world, { shipId });
    }
  }
}

function gravitySystem(world, dtFactor) {
  const wells = getWells(world);

  for (const id of world.entities) {
    // Ships scheduled to respawn are removed from simulation immediately.
    if (world.stores.ship.has(id) && isRespawning(world, id)) continue;

    const t = world.stores.transform.get(id);
    const v = world.stores.velocity.get(id);
    if (!t || !v) continue;

    const mult = world.stores.gravityMultiplier.get(id);
    if (!mult) continue;

    applyGravity({
      targetTransform: t,
      targetVelocity: v,
      wells,
      multiplier: mult,
      ignoreWellId: id,
      dtFactor,
    });
  }
}

function orbitSystem(world) {
  if (!world.stores.orbit || world.stores.orbit.size === 0) return;
  const tSec = world.resources.now() / 1000;

  for (const [id, orbit] of world.stores.orbit) {
    const t = world.stores.transform.get(id);
    if (!t) continue;

    const centerT = world.stores.transform.get(orbit.centerId);
    if (!centerT) continue;

    const angle = (orbit.phase ?? 0) + (orbit.angularSpeed ?? 0) * tSec;
    t.x = centerT.x + orbit.radius * Math.cos(angle);
    t.y = centerT.y + orbit.radius * Math.sin(angle);
  }
}

function movementSystem(world, dtFactor) {
  for (const id of world.entities) {
    // Ships scheduled to respawn are removed from simulation immediately.
    if (world.stores.ship.has(id) && isRespawning(world, id)) continue;

    const t = world.stores.transform.get(id);
    const v = world.stores.velocity.get(id);
    if (!t || !v) continue;
    t.x += v.x * dtFactor;
    t.y += v.y * dtFactor;
  }
}

function radiusFor(world, id) {
  return world.stores.collider.get(id)?.radius ?? 0;
}

function borderSystem(world, { borderMode, planetId }) {
  if (borderMode === 'outerSpace') return;

  const canvas = world.resources.canvas;
  const width = canvas.width;
  const height = canvas.height;
  const nowMs = world.resources.now();

  const wrapCenter = (value, max) => {
    // Keep within [0, max] while preserving velocity.
    // Using while avoids edge issues with huge dt.
    while (value < 0) value += max;
    while (value > max) value -= max;
    return value;
  };

  // Ships.
  for (const shipId of shipIds(world)) {
    if (isRespawning(world, shipId)) continue;

    const t = world.stores.transform.get(shipId);
    const v = world.stores.velocity.get(shipId);
    const ship = world.stores.ship.get(shipId);
    if (!t || !v || !ship) continue;

    const r = radiusFor(world, shipId);
    const hitLeft = t.x - r < 0;
    const hitRight = t.x + r > width;
    const hitTop = t.y - r < 0;
    const hitBottom = t.y + r > height;

    const wrapLeft = t.x < 0;
    const wrapRight = t.x > width;
    const wrapTop = t.y < 0;
    const wrapBottom = t.y > height;

    if (borderMode === 'wrap') {
      if (wrapLeft || wrapRight || wrapTop || wrapBottom) {
        t.x = wrapCenter(t.x, width);
        t.y = wrapCenter(t.y, height);
      }
      continue;
    }

    if (!(hitLeft || hitRight || hitTop || hitBottom)) continue;

    if (borderMode === 'concrete') {
      if (scheduleRespawnIfNeeded(world, shipId, nowMs)) {
        markExplosion(world, t.x, t.y, ship.color);
        if (world.resources.missilesDieWithShip) {
          killMissilesOwnedByShip(world, shipId, { explode: true });
        }
        recordDeath(world, shipId);
        v.x = 0;
        v.y = 0;
      }
      continue;
    }

    if (borderMode === 'rubber') {
      if (hitLeft) {
        t.x = r;
        v.x = Math.abs(v.x);
      }
      if (hitRight) {
        t.x = width - r;
        v.x = -Math.abs(v.x);
      }
      if (hitTop) {
        t.y = r;
        v.y = Math.abs(v.y);
      }
      if (hitBottom) {
        t.y = height - r;
        v.y = -Math.abs(v.y);
      }
      continue;
    }

    // wrap handled above
  }

  // Missiles.
  for (const missileId of missileIds(world)) {
    if (world.dead.has(missileId)) continue;

    const t = world.stores.transform.get(missileId);
    const v = world.stores.velocity.get(missileId);
    if (!t || !v) continue;

    const r = radiusFor(world, missileId);
    const hitLeft = t.x - r < 0;
    const hitRight = t.x + r > width;
    const hitTop = t.y - r < 0;
    const hitBottom = t.y + r > height;

    const wrapLeft = t.x < 0;
    const wrapRight = t.x > width;
    const wrapTop = t.y < 0;
    const wrapBottom = t.y > height;

    if (borderMode === 'wrap') {
      if (wrapLeft || wrapRight || wrapTop || wrapBottom) {
        t.x = wrapCenter(t.x, width);
        t.y = wrapCenter(t.y, height);
      }
      continue;
    }

    if (!(hitLeft || hitRight || hitTop || hitBottom)) continue;

    if (borderMode === 'concrete') {
      world.dead.add(missileId);
      continue;
    }

    if (borderMode === 'rubber') {
      if (hitLeft) {
        t.x = r;
        v.x = Math.abs(v.x);
      }
      if (hitRight) {
        t.x = width - r;
        v.x = -Math.abs(v.x);
      }
      if (hitTop) {
        t.y = r;
        v.y = Math.abs(v.y);
      }
      if (hitBottom) {
        t.y = height - r;
        v.y = -Math.abs(v.y);
      }
      continue;
    }

    // wrap handled above
  }
}

function lifetimeSystem(world) {
  const nowMs = world.resources.now();

  for (const [mid, m] of world.stores.missile) {
    if (nowMs - m.spawnMs > m.ttlMs) {
      const t = world.stores.transform.get(mid);
      world.dead.add(mid);
      if (t) markExplosion(world, t.x, t.y, m.color);
    }
  }
}

function collisionSystem(world) {
  const shipList = shipIds(world).filter((id) => !isRespawning(world, id));
  const missileList = missileIds(world);

  // Ship-well and missile-well collisions (supports multiple wells).
  const wellIds = Array.from(world.stores.gravityWell.keys());

  for (const shipId of shipList) {
    const ship = world.stores.ship.get(shipId);
    const t = world.stores.transform.get(shipId);
    let collidingAnyWell = false;

    for (const wellId of wellIds) {
      const wellT = world.stores.transform.get(wellId);
      const well = world.stores.gravityWell.get(wellId);
      if (!wellT || !well) continue;

      const dx = wellT.x - t.x;
      const dy = wellT.y - t.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const colliding = dist < (well.radius + 10);
      if (colliding) {
        collidingAnyWell = true;
        world.events.push({ type: 'shipHitGravityWell', shipId, wellId });
        break;
      }
    }

    ship._wellContactThisFrame = collidingAnyWell;
  }

  for (const mid of missileList) {
    const t = world.stores.transform.get(mid);
    for (const wellId of wellIds) {
      const wellT = world.stores.transform.get(wellId);
      const well = world.stores.gravityWell.get(wellId);
      if (!wellT || !well) continue;

      const dx = wellT.x - t.x;
      const dy = wellT.y - t.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < well.radius + 5) {
        world.dead.add(mid);
        break;
      }
    }
  }

  // Missile-ship.
  for (const mid of missileList) {
    if (world.dead.has(mid)) continue;
    const mT = world.stores.transform.get(mid);
    const owner = world.stores.owner.get(mid)?.id;

    for (const shipId of shipList) {
      if (shipId === owner) continue;

      const ship = world.stores.ship.get(shipId);
      const sT = world.stores.transform.get(shipId);

      if (isInvulnerable(world, shipId)) continue;

      const dist = Math.sqrt((mT.x - sT.x) ** 2 + (mT.y - sT.y) ** 2);
      if (dist < ship.width) {
        world.events.push({ type: 'missileHitShip', missileId: mid, shipId, ownerShipId: owner });
        break;
      }
    }
  }

  // Ship-ship.
  if (shipList.length >= 2) {
    for (let i = 0; i < shipList.length; i++) {
      for (let j = i + 1; j < shipList.length; j++) {
        const a = shipList[i];
        const b = shipList[j];
        const aT = world.stores.transform.get(a);
        const bT = world.stores.transform.get(b);
        const aShip = world.stores.ship.get(a);
        const bShip = world.stores.ship.get(b);

        const dist = Math.sqrt((aT.x - bT.x) ** 2 + (aT.y - bT.y) ** 2);
        if (dist < aShip.width + bShip.width) {
          world.events.push({ type: 'shipRammed', a, b });
        }
      }
    }
  }

  // Missile-missile (global, with same-owner grace period).
  const nowMs = world.resources.now();
  for (let i = 0; i < missileList.length; i++) {
    const a = missileList[i];
    if (world.dead.has(a)) continue;
    const aT = world.stores.transform.get(a);
    const aM = world.stores.missile.get(a);
    const aOwner = world.stores.owner.get(a)?.id;

    for (let j = i + 1; j < missileList.length; j++) {
      const b = missileList[j];
      if (world.dead.has(b)) continue;
      const bT = world.stores.transform.get(b);
      const bM = world.stores.missile.get(b);
      const bOwner = world.stores.owner.get(b)?.id;

      const sameOwner = aOwner && bOwner && aOwner === bOwner;
      if (sameOwner) {
        const aPast = nowMs - aM.spawnMs > aM.graceMs;
        const bPast = nowMs - bM.spawnMs > bM.graceMs;
        if (!(aPast && bPast)) continue;
      }

      const dist = Math.sqrt((aT.x - bT.x) ** 2 + (aT.y - bT.y) ** 2);
      if (dist < 8) {
        world.events.push({ type: 'missileHitMissile', a, b, x: aT.x, y: aT.y, color: aM.color });
      }
    }
  }
}

function rulesSystem(world, planetId) {
  const nowMs = world.resources.now();

  for (const event of world.events) {
    if (event.type === 'shipHitGravityWell') {
      const shipId = event.shipId;
      if (isRespawning(world, shipId)) continue;

      const ship = world.stores.ship.get(shipId);
      const t = world.stores.transform.get(shipId);

      // Apply penalty only once per contact.
      if (!ship.wellContact && ship._wellContactThisFrame) {
        const score = world.stores.score.get(shipId);
        score.value = Math.max(0, score.value - 1);
      }

      ship.wellContact = true;

      // Destroy + respawn.
      if (scheduleRespawnIfNeeded(world, shipId, nowMs)) {
        markExplosion(world, t.x, t.y, ship.color);
        if (world.resources.missilesDieWithShip) {
          killMissilesOwnedByShip(world, shipId, { explode: true });
        }
        recordDeath(world, shipId, { crash: true });
        // Freeze immediately so it stops participating in the sim.
        const v = world.stores.velocity.get(shipId);
        if (v) {
          v.x = 0;
          v.y = 0;
        }
      }
    }

    if (event.type === 'missileHitShip') {
      const { missileId, shipId, ownerShipId } = event;
      if (isRespawning(world, shipId)) {
        world.dead.add(missileId);
        continue;
      }

      const ship = world.stores.ship.get(shipId);
      const shipT = world.stores.transform.get(shipId);
      const missile = world.stores.missile.get(missileId);

      world.dead.add(missileId);
      if (scheduleRespawnIfNeeded(world, shipId, nowMs)) {
        markExplosion(world, shipT.x, shipT.y, ship.color);
        if (world.resources.missilesDieWithShip) {
          killMissilesOwnedByShip(world, shipId, { explode: true });
        }
        recordDeath(world, shipId);
        const v = world.stores.velocity.get(shipId);
        if (v) {
          v.x = 0;
          v.y = 0;
        }
      }

      if (ownerShipId && world.stores.score.has(ownerShipId)) {
        world.stores.score.get(ownerShipId).value++;
        recordKill(world, ownerShipId);
      }

      // Preserve old behavior: missile hit instantly kills even if it would also hit planet.
      if (missile) {
        // no-op for now
      }
    }

    if (event.type === 'shipRammed') {
      const { a, b } = event;
      if (isRespawning(world, a) || isRespawning(world, b)) continue;

      const aT = world.stores.transform.get(a);
      const bT = world.stores.transform.get(b);
      const aV = world.stores.velocity.get(a);
      const bV = world.stores.velocity.get(b);
      const aShip = world.stores.ship.get(a);
      const bShip = world.stores.ship.get(b);

      const aSpeed = Math.sqrt(aV.x ** 2 + aV.y ** 2);
      const bSpeed = Math.sqrt(bV.x ** 2 + bV.y ** 2);

      if (aSpeed > bSpeed) {
        if (scheduleRespawnIfNeeded(world, b, nowMs)) {
          markExplosion(world, bT.x, bT.y, bShip.color);
          if (world.resources.missilesDieWithShip) {
            killMissilesOwnedByShip(world, b, { explode: true });
          }
          recordDeath(world, b);
          const v = world.stores.velocity.get(b);
          if (v) {
            v.x = 0;
            v.y = 0;
          }
        }
        world.stores.score.get(a).value++;
        recordKill(world, a);
      } else if (bSpeed > aSpeed) {
        if (scheduleRespawnIfNeeded(world, a, nowMs)) {
          markExplosion(world, aT.x, aT.y, aShip.color);
          if (world.resources.missilesDieWithShip) {
            killMissilesOwnedByShip(world, a, { explode: true });
          }
          recordDeath(world, a);
          const v = world.stores.velocity.get(a);
          if (v) {
            v.x = 0;
            v.y = 0;
          }
        }
        world.stores.score.get(b).value++;
        recordKill(world, b);
      } else {
        if (scheduleRespawnIfNeeded(world, a, nowMs)) {
          markExplosion(world, aT.x, aT.y, aShip.color);
          if (world.resources.missilesDieWithShip) {
            killMissilesOwnedByShip(world, a, { explode: true });
          }
          recordDeath(world, a);
          const v = world.stores.velocity.get(a);
          if (v) {
            v.x = 0;
            v.y = 0;
          }
        }
        if (scheduleRespawnIfNeeded(world, b, nowMs)) {
          markExplosion(world, bT.x, bT.y, bShip.color);
          if (world.resources.missilesDieWithShip) {
            killMissilesOwnedByShip(world, b, { explode: true });
          }
          recordDeath(world, b);
          const v = world.stores.velocity.get(b);
          if (v) {
            v.x = 0;
            v.y = 0;
          }
        }
      }
    }

    if (event.type === 'missileHitMissile') {
      world.dead.add(event.a);
      world.dead.add(event.b);
      markExplosion(world, event.x, event.y, event.color);
    }
  }

  // Clear events.
  world.events.length = 0;

  // Update contact flags (edge detection support).
  for (const shipId of shipIds(world)) {
    const ship = world.stores.ship.get(shipId);
    if (!ship._wellContactThisFrame) ship.wellContact = false;
    ship._wellContactThisFrame = false;
  }

  // Respawns.
  for (const [shipId, atMs] of world.stores.respawnAtMs) {
    if (nowMs >= atMs) {
      world.stores.respawnAtMs.delete(shipId);
      respawnShip(world, shipId, planetId, SHIP.invulnerableMs);
    }
  }
}

function noFuelSystem(world, planetId) {
  const ships = shipIds(world);
  if (ships.length === 0) return;

  const nowMs = world.resources.now();

  // Consider only ships that are currently in simulation.
  const activeShips = ships.filter((sid) => !world.stores.respawnAtMs.has(sid));
  if (activeShips.length === 0) {
    world.resources.noFuelStartMs = null;
    return;
  }

  const allOut = activeShips.every((sid) => (world.stores.fuel.get(sid)?.value ?? 0) <= 0);

  if (allOut) {
    if (world.resources.noFuelStartMs === null) world.resources.noFuelStartMs = nowMs;

    if (nowMs - world.resources.noFuelStartMs > NO_FUEL_TIMEOUT_MS) {
      for (const sid of activeShips) {
        const t = world.stores.transform.get(sid);
        const c = world.stores.ship.get(sid)?.color;
        if (t && c) markExplosion(world, t.x, t.y, c);

        if (world.resources.missilesDieWithShip) {
          killMissilesOwnedByShip(world, sid, { explode: true });
        }

        if (scheduleRespawnIfNeeded(world, sid, nowMs)) {
          recordDeath(world, sid);
        }
      }

      world.resources.noFuelStartMs = null;
    }
  } else {
    world.resources.noFuelStartMs = null;
  }
}

function checkWin(world, winningScore) {
  for (const [shipId, score] of world.stores.score) {
    if (score.value >= winningScore) return shipId;
  }
  return null;
}

function drawWorld(world, planetId) {
  const { ctx, canvas } = world.resources;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Planet(s): draw all gravity wells as circles.
  for (const [id, well] of world.stores.gravityWell) {
    const t = world.stores.transform.get(id);
    ctx.fillStyle = well.color;
    ctx.shadowColor = well.color;
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(t.x, t.y, well.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Ships.
  for (const [id, ship] of world.stores.ship) {
    // Hide when scheduled for respawn.
    if (world.stores.respawnAtMs.has(id)) continue;

    const t = world.stores.transform.get(id);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.angle);

    ctx.fillStyle = ship.color;
    ctx.shadowColor = ship.color;
    ctx.shadowBlur = 15;

    if (isInvulnerable(world, id)) {
      ctx.globalAlpha = Math.abs(Math.sin(world.resources.now() / 150));
    }

    ctx.beginPath();
    ctx.moveTo(ship.height / 2, 0);
    ctx.lineTo(-ship.height / 2, -ship.width / 2);
    ctx.lineTo(-ship.height / 2, ship.width / 2);
    ctx.closePath();
    ctx.fill();

    if (ship.thrusted) {
      ctx.fillStyle = '#ff8000';
      ctx.beginPath();
      ctx.moveTo(-ship.height / 2, 0);
      ctx.lineTo(-ship.height / 1.5, -ship.width / 2);
      ctx.lineTo(-ship.height / 1.5, ship.width / 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;

    drawOffscreenIndicator(ctx, canvas, t.x, t.y, ship.color);
  }

  // Missiles.
  for (const [id, m] of world.stores.missile) {
    if (world.dead.has(id)) continue;
    const t = world.stores.transform.get(id);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = m.color;
    ctx.shadowColor = m.color;
    ctx.shadowBlur = 10;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  drawExplosions(ctx, world.resources.explosions);
}

function drawOffscreenIndicator(ctx, canvas, x, y, color) {
  const buffer = 10;
  const canvasLeft = buffer;
  const canvasRight = canvas.width - buffer;
  const canvasTop = buffer;
  const canvasBottom = canvas.height - buffer;

  if (x <= canvas.width && x >= 0 && y <= canvas.height && y >= 0) return;

  const dx = x - canvas.width / 2;
  const dy = y - canvas.height / 2;

  let indicatorX;
  let indicatorY;

  // Handle vertical line case safely.
  const m = Math.abs(dx) < 0.0001 ? Number.POSITIVE_INFINITY : dy / dx;

  if (Math.abs(dy) > Math.abs(dx)) {
    if (dy > 0) {
      indicatorY = canvasBottom;
      indicatorX = canvas.width / 2 + (canvasBottom - canvas.height / 2) / m;
    } else {
      indicatorY = canvasTop;
      indicatorX = canvas.width / 2 + (canvasTop - canvas.height / 2) / m;
    }
  } else {
    if (dx > 0) {
      indicatorX = canvasRight;
      indicatorY = canvas.height / 2 + m * (canvasRight - canvas.width / 2);
    } else {
      indicatorX = canvasLeft;
      indicatorY = canvas.height / 2 + m * (canvasLeft - canvas.width / 2);
    }
  }

  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 15;
  ctx.beginPath();
  ctx.arc(indicatorX, indicatorY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function stepWorld(
  world,
  { keys, justPressed },
  {
    dtMs,
    planetId,
    borderMode = 'outerSpace',
    winningScore = WINNING_SCORE,
    missilesDieWithShip = false,
  },
) {
  world.resources.missilesDieWithShip = Boolean(missilesDieWithShip);
  const dtFactor = dtFactorFromMs(dtMs);

  applyPlayerAndBotInput(world, keys, justPressed, dtFactor);
  botSystem(world, dtFactor);
  fireSystem(world);

  orbitSystem(world);

  gravitySystem(world, dtFactor);
  movementSystem(world, dtFactor);
  borderSystem(world, { borderMode, planetId });

  lifetimeSystem(world);
  collisionSystem(world);
  noFuelSystem(world, planetId);
  rulesSystem(world, planetId);
  world.resources.explosions = updateExplosions(world.resources.explosions, dtFactor);

  cleanupDead(world);

  drawWorld(world, planetId);

  return {
    winnerShipId: checkWin(world, winningScore),
  };

}

export function getUiSnapshot(world) {
  const ships = [];
  for (const [id, ship] of world.stores.ship) {
    const score = world.stores.score.get(id)?.value ?? 0;
    const fuel = world.stores.fuel.get(id)?.value ?? 0;
    const activeMissiles = countActiveMissiles(world, id);

    ships.push({
      id,
      playerIndex: ship.playerIndex,
      color: ship.color,
      score,
      fuel,
      maxFuel: world.stores.fuel.get(id)?.max ?? 0,
      activeMissiles,
      maxMissiles: ship.maxMissiles,
    });
  }
  return { ships };
}

export function getStatsSnapshot(world) {
  const ships = [];
  for (const [id, ship] of world.stores.ship) {
    const score = world.stores.score.get(id)?.value ?? 0;
    const stats = world.stores.stats.get(id) ?? { kills: 0, deaths: 0, crashes: 0 };
    ships.push({
      id,
      playerIndex: ship.playerIndex,
      color: ship.color,
      score,
      kills: stats.kills ?? 0,
      deaths: stats.deaths ?? 0,
      crashes: stats.crashes ?? 0,
    });
  }
  return { ships };
}
