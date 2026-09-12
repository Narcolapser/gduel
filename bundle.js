(() => {
  // engine/constants.js
  var TICK_MS = 1e3 / 60;
  var WINNING_SCORE = 5;
  var MAX_FUEL_SECONDS = 10;
  var TOTAL_FUEL_LINES = 57;
  var FUEL_PER_FRAME = 1 / (MAX_FUEL_SECONDS * 60) * 2;
  var NO_FUEL_TIMEOUT_MS = 3e4;
  var SHIP = {
    width: 10,
    height: 20,
    rotationSpeed: 0.035,
    thrustPower: 4e-3,
    turboRotationSpeed: 0.05,
    turboThrustPower: 0.01,
    turboFuelMultiplier: 4,
    maxMissiles: 3,
    initialDistance: 100,
    respawnDelayMs: 3e3,
    invulnerableMs: 3e3
  };
  var MISSILE = {
    speed: 1,
    ttlMs: 3e4,
    collisionGraceMs: 1e3,
    offscreenKillBuffer: 50
  };
  var PLANET = {
    radius: 30,
    color: "#ffffff",
    // Old ship gravity constant.
    mu: 50,
    // Softening keeps forces finite very near the center.
    softening: 2
  };
  var GRAVITY_MULTIPLIERS = {
    ship: 4,
    missile: 4
  };
  var BOUNDARY = {
    // Outer-space "outer rim" boundary (ships only; see borderSystem in
    // step.js). Ships can drift outerRimWidth px past the visible field edge
    // before hitting a hard bounce — the same reflection mechanics as the
    // "rubber" border mode, just relocated out to the rim instead of sitting
    // right at the visible edge.
    outerRimWidth: 50
  };

  // engine/world.js
  function makeStores() {
    return {
      transform: /* @__PURE__ */ new Map(),
      // {x,y,angle}
      velocity: /* @__PURE__ */ new Map(),
      // {x,y}
      collider: /* @__PURE__ */ new Map(),
      // {radius}
      ship: /* @__PURE__ */ new Map(),
      // {playerIndex,color,width,height,rotationSpeed,thrustPower,maxMissiles,thrusted,wellContact}
      missile: /* @__PURE__ */ new Map(),
      // {color,spawnMs,ttlMs,graceMs}
      owner: /* @__PURE__ */ new Map(),
      // {id}
      score: /* @__PURE__ */ new Map(),
      // {value}
      fuel: /* @__PURE__ */ new Map(),
      // {value,max}
      invulnerableUntilMs: /* @__PURE__ */ new Map(),
      // number
      respawnAtMs: /* @__PURE__ */ new Map(),
      // number
      gravityWell: /* @__PURE__ */ new Map(),
      // {mu,radius,color,softening}
      gravityMultiplier: /* @__PURE__ */ new Map(),
      // number
      // Deterministic circular orbits (for moving gravity wells).
      // {centerId:number, radius:number, angularSpeed:number, phase:number}
      orbit: /* @__PURE__ */ new Map(),
      playerInput: /* @__PURE__ */ new Map(),
      // {thrust,left,right,fire,turbo}
      bot: /* @__PURE__ */ new Map(),
      // {enabled:boolean}
      // Render tags
      planet: /* @__PURE__ */ new Set()
    };
  }
  function createWorld({ canvas, ctx, document: document2, now = () => performance.now() }) {
    const stores = makeStores();
    const resources = {
      canvas,
      ctx,
      document: document2,
      realNow: now,
      gameTimeMs: 0,
      now: () => resources.gameTimeMs,
      explosions: [],
      noFuelStartMs: null,
      spawnDistance: null,
      missilesDieWithShip: false
    };
    return {
      nextId: 1,
      entities: /* @__PURE__ */ new Set(),
      dead: /* @__PURE__ */ new Set(),
      events: [],
      stores,
      resources
    };
  }
  function createEntity(world) {
    const id = world.nextId++;
    world.entities.add(id);
    return id;
  }
  function cleanupDead(world) {
    if (world.dead.size === 0) return;
    for (const id of world.dead) {
      world.entities.delete(id);
      for (const store of Object.values(world.stores)) {
        if (store instanceof Map) store.delete(id);
        else if (store instanceof Set) store.delete(id);
      }
    }
    world.dead.clear();
  }
  function set(store, id, value) {
    if (!(store instanceof Map)) throw new Error("set() expects a Map store");
    store.set(id, value);
  }

  // engine/spawn.js
  function spawnGravityWell(world, { x, y, mu, radius, color, softening = 0 }) {
    const wellId = createEntity(world);
    set(world.stores.transform, wellId, { x, y, angle: 0 });
    set(world.stores.collider, wellId, { radius });
    set(world.stores.gravityWell, wellId, { mu, radius, color, softening });
    return wellId;
  }
  function spawnShip(world, {
    playerIndex,
    color,
    x,
    y,
    vx,
    vy,
    angle,
    inputKeys,
    maxMissiles = SHIP.maxMissiles
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
      wellContact: false
    });
    set(world.stores.score, shipId, { value: 0 });
    set(world.stores.fuel, shipId, { value: MAX_FUEL_SECONDS, max: MAX_FUEL_SECONDS });
    set(world.stores.gravityMultiplier, shipId, GRAVITY_MULTIPLIERS.ship);
    set(world.stores.playerInput, shipId, inputKeys);
    return shipId;
  }
  function respawnShip(world, shipId, planetId, invulnerableMs = SHIP.invulnerableMs) {
    const canvas = world.resources.canvas;
    const planetT = world.stores.transform.get(planetId);
    const well = world.stores.gravityWell.get(planetId);
    const ship = world.stores.ship.get(shipId);
    world.stores.respawnAtMs.delete(shipId);
    const distance = world.resources.spawnDistance ?? SHIP.initialDistance;
    const multRaw = Number(world.stores.gravityMultiplier.get(shipId) ?? GRAVITY_MULTIPLIERS.ship ?? 1);
    const mult = Number.isFinite(multRaw) ? Math.max(0, multRaw) : 1;
    const circularVelocity = 0.9 * Math.sqrt((well?.mu ?? PLANET.mu) * mult / distance);
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
    if (world.resources.missilesDieWithShip) {
      for (const [mid, owner] of world.stores.owner) {
        if (owner.id === shipId) {
          world.dead.add(mid);
        }
      }
    }
    const t = world.stores.transform.get(shipId);
    t.x = Math.max(0, Math.min(canvas.width, t.x));
    t.y = Math.max(0, Math.min(canvas.height, t.y));
  }
  function spawnMissile(world, { shipId }) {
    const shipT = world.stores.transform.get(shipId);
    const shipV = world.stores.velocity.get(shipId);
    const ship = world.stores.ship.get(shipId);
    const missileId = createEntity(world);
    const x = shipT.x + ship.height / 2 * Math.cos(shipT.angle);
    const y = shipT.y + ship.height / 2 * Math.sin(shipT.angle);
    const vx = shipV.x + MISSILE.speed * Math.cos(shipT.angle);
    const vy = shipV.y + MISSILE.speed * Math.sin(shipT.angle);
    set(world.stores.transform, missileId, { x, y, angle: 0 });
    set(world.stores.velocity, missileId, { x: vx, y: vy });
    set(world.stores.collider, missileId, { radius: 4 });
    set(world.stores.missile, missileId, {
      color: ship.color,
      spawnMs: world.resources.now(),
      ttlMs: MISSILE.ttlMs,
      graceMs: MISSILE.collisionGraceMs
    });
    set(world.stores.owner, missileId, { id: shipId });
    set(world.stores.gravityMultiplier, missileId, GRAVITY_MULTIPLIERS.missile);
    return missileId;
  }
  function resetScores(world) {
    for (const [shipId, score] of world.stores.score) {
      score.value = 0;
    }
  }
  function countActiveMissiles(world, shipId) {
    let count = 0;
    for (const [mid, owner] of world.stores.owner) {
      if (owner.id === shipId && !world.dead.has(mid) && world.entities.has(mid)) count++;
    }
    return count;
  }
  function canFire(world, shipId) {
    const ship = world.stores.ship.get(shipId);
    const active = countActiveMissiles(world, shipId);
    return active < ship.maxMissiles;
  }
  function burnFuel(world, shipId, dtFactor, fuelMultiplier = 1) {
    const fuel = world.stores.fuel.get(shipId);
    if (!fuel || fuel.value <= 0) return false;
    fuel.value = Math.max(0, fuel.value - FUEL_PER_FRAME * dtFactor * fuelMultiplier);
    return fuel.value > 0;
  }

  // engine/maps.js
  var MAPS = {
    classic: {
      id: "classic",
      name: "Classic"
    },
    earth: {
      id: "earth",
      name: "Earth"
    },
    pluto: {
      id: "pluto",
      name: "Pluto"
    }
  };
  function spawnAnchor(world, { x, y }) {
    const anchorId = createEntity(world);
    set(world.stores.transform, anchorId, { x, y, angle: 0 });
    return anchorId;
  }
  function createMap(world, { mapId, width, height }) {
    const id = MAPS[mapId]?.id ?? MAPS.classic.id;
    const cx = width / 2;
    const cy = height / 2;
    const anchorId = spawnAnchor(world, { x: cx, y: cy });
    if (id === "classic") {
      spawnGravityWell(world, {
        x: cx,
        y: cy,
        mu: PLANET.mu,
        radius: PLANET.radius,
        color: PLANET.color,
        softening: PLANET.softening
      });
      return { id, anchorId, spawnDistance: SHIP.initialDistance };
    }
    if (id === "earth") {
      const earthId = spawnGravityWell(world, {
        x: cx,
        y: cy,
        mu: PLANET.mu,
        radius: PLANET.radius,
        color: "#2a6fdb",
        softening: PLANET.softening
      });
      const moonOrbitRadius = 2 * SHIP.initialDistance;
      const moonId = spawnGravityWell(world, {
        x: cx + moonOrbitRadius,
        y: cy,
        mu: PLANET.mu * 0.25,
        radius: Math.max(10, Math.floor(PLANET.radius * 0.45)),
        color: "#b0b0b0",
        softening: 1
      });
      const angularSpeed = 2 * Math.PI / 12;
      world.stores.orbit.set(moonId, {
        centerId: earthId,
        radius: moonOrbitRadius,
        angularSpeed,
        phase: 0
      });
      return { id, anchorId, spawnDistance: SHIP.initialDistance };
    }
    if (id === "pluto") {
      const orbitRadius = 60;
      const angularSpeed = 2 * Math.PI / 8;
      const phase = Math.PI / 2;
      const plutoId = spawnGravityWell(world, {
        x: cx,
        y: cy + orbitRadius,
        mu: PLANET.mu * 0.9,
        radius: Math.max(16, Math.floor(PLANET.radius * 0.75)),
        color: "#c8b39a",
        softening: 1
      });
      const charonId = spawnGravityWell(world, {
        x: cx,
        y: cy - orbitRadius,
        mu: PLANET.mu * 0.45,
        radius: Math.max(12, Math.floor(PLANET.radius * 0.55)),
        color: "#9ea3a6",
        softening: 1
      });
      world.stores.orbit.set(plutoId, {
        centerId: anchorId,
        radius: orbitRadius,
        angularSpeed,
        phase
      });
      world.stores.orbit.set(charonId, {
        centerId: anchorId,
        radius: orbitRadius,
        angularSpeed,
        phase: phase + Math.PI
      });
      return { id, anchorId, spawnDistance: 160 };
    }
    spawnGravityWell(world, {
      x: cx,
      y: cy,
      mu: PLANET.mu,
      radius: PLANET.radius,
      color: PLANET.color,
      softening: PLANET.softening
    });
    return { id: "classic", anchorId, spawnDistance: SHIP.initialDistance };
  }

  // engine/game.js
  function createMatch({ canvas, ctx, document: document2, maxMissiles = SHIP.maxMissiles, mapId = "classic" }) {
    const world = createWorld({ canvas, ctx, document: document2 });
    const map = createMap(world, { mapId, width: canvas.width, height: canvas.height });
    const planetId = map.anchorId;
    world.resources.spawnDistance = map.spawnDistance ?? SHIP.initialDistance;
    const spawnMu = PLANET.mu;
    const shipGravityMultRaw = Number(GRAVITY_MULTIPLIERS.ship ?? 1);
    const shipGravityMult = Number.isFinite(shipGravityMultRaw) ? Math.max(0, shipGravityMultRaw) : 1;
    const distance = world.resources.spawnDistance;
    const circularVelocity = 0.9 * Math.sqrt(spawnMu * shipGravityMult / distance);
    const anchorT = world.stores.transform.get(planetId);
    const cx = anchorT?.x ?? canvas.width / 2;
    const cy = anchorT?.y ?? canvas.height / 2;
    const ship1Id = spawnShip(world, {
      playerIndex: 1,
      color: "#00ff00",
      x: cx - distance,
      y: cy,
      vx: 0,
      vy: -circularVelocity,
      angle: (Math.atan2(-circularVelocity, 0) + Math.PI * 2) % (Math.PI * 2),
      inputKeys: { thrust: "w", left: "a", right: "d", fire: "s", turbo: "shiftleft" },
      maxMissiles
    });
    const ship2Id = spawnShip(world, {
      playerIndex: 2,
      color: "#ff0000",
      x: cx + distance,
      y: cy,
      vx: 0,
      vy: circularVelocity,
      angle: (Math.atan2(circularVelocity, 0) + Math.PI * 2) % (Math.PI * 2),
      inputKeys: { thrust: "arrowup", left: "arrowleft", right: "arrowright", fire: "arrowdown", turbo: "shiftright" },
      maxMissiles
    });
    return { world, planetId, ship1Id, ship2Id, mapId: map.id };
  }
  function setBotEnabled(world, shipId, enabled) {
    world.stores.bot.set(shipId, { enabled: Boolean(enabled) });
  }
  function resetMatch(world, { planetId, ship1Id, ship2Id }) {
    world.resources.gameTimeMs = 0;
    world.resources.explosions = [];
    world.resources.noFuelStartMs = null;
    resetScores(world);
    respawnShip(world, ship1Id, planetId, 0);
    respawnShip(world, ship2Id, planetId, 0);
  }
  function resizeMatch(world, { planetId }, { width, height }) {
    world.resources.canvas.width = width;
    world.resources.canvas.height = height;
    const cx = width / 2;
    const cy = height / 2;
    const anchorT = world.stores.transform.get(planetId);
    if (anchorT) {
      anchorT.x = cx;
      anchorT.y = cy;
    }
    for (const [wellId] of world.stores.gravityWell) {
      if (world.stores.orbit.has(wellId)) continue;
      const t = world.stores.transform.get(wellId);
      if (!t) continue;
      t.x = cx;
      t.y = cy;
    }
  }

  // engine/gravity.js
  function applyGravity({
    targetTransform,
    targetVelocity,
    wells,
    multiplier,
    ignoreWellId,
    dtFactor
  }) {
    let ax = 0;
    let ay = 0;
    for (const well of wells) {
      if (ignoreWellId != null && well.id === ignoreWellId) continue;
      const dx = well.x - targetTransform.x;
      const dy = well.y - targetTransform.y;
      const soft = well.softening ?? 0;
      const distSq = dx * dx + dy * dy + soft * soft;
      if (distSq <= 1e-6) continue;
      const dist = Math.sqrt(distSq);
      const accel = well.mu * multiplier / distSq;
      ax += accel * dx / dist;
      ay += accel * dy / dist;
    }
    targetVelocity.x += ax * dtFactor;
    targetVelocity.y += ay * dtFactor;
  }

  // engine/explosions.js
  function createExplosionParticles({ x, y, color, rng = Math.random }) {
    const particleCount = 100;
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      const angle = rng() * Math.PI * 2;
      const speed = rng() * 2 + 0.5;
      particles.push({
        x,
        y,
        size: rng() * 3 + 1,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        alpha: 1
      });
    }
    return { particles };
  }
  function updateExplosions(explosions, dtFactor) {
    for (const explosion of explosions) {
      for (const p of explosion.particles) {
        p.x += p.vx * dtFactor;
        p.y += p.vy * dtFactor;
        p.alpha -= 0.01 * dtFactor;
      }
      explosion.particles = explosion.particles.filter((p) => p.alpha > 0);
    }
    return explosions.filter((e) => e.particles.length > 0);
  }
  function drawExplosions(ctx, explosions) {
    for (const explosion of explosions) {
      for (const p of explosion.particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  // engine/step.js
  var OFFSCREEN_INDICATOR_ENABLED = false;
  function dtFactorFromMs(dtMs) {
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
      const isTurbo = input.turbo && keys[input.turbo];
      const rotSpeed = isTurbo ? SHIP.turboRotationSpeed : ship.rotationSpeed;
      const thrPow = isTurbo ? SHIP.turboThrustPower : ship.thrustPower;
      if (keys[input.left]) t.angle -= rotSpeed * dtFactor;
      if (keys[input.right]) t.angle += rotSpeed * dtFactor;
      if (keys[input.thrust]) {
        const fuelMult = isTurbo ? SHIP.turboFuelMultiplier : 1;
        if (burnFuel(world, shipId, dtFactor, fuelMult)) {
          v.x += thrPow * Math.cos(t.angle) * dtFactor;
          v.y += thrPow * Math.sin(t.angle) * dtFactor;
          ship.thrusted = true;
        }
      }
      if (justPressed.has(input.fire)) {
        ship._wantsFire = true;
      }
    }
  }
  function botSystem(world, dtFactor) {
    const ships = shipIds(world);
    if (ships.length < 2) return;
    const [a, b] = ships;
    const pairs = [
      [a, b],
      [b, a]
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
      if (canFire(world, botId) && Math.abs(angleDiff) < angleTolerance && distance < firingDistance && Math.random() < firingChance) {
        bot._wantsFire = true;
      }
    }
  }
  function fireSystem(world) {
    for (const shipId of shipIds(world)) {
      if (isRespawning(world, shipId)) {
        const ship2 = world.stores.ship.get(shipId);
        if (ship2) ship2._wantsFire = false;
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
        dtFactor
      });
    }
  }
  function orbitSystem(world) {
    if (!world.stores.orbit || world.stores.orbit.size === 0) return;
    const tSec = world.resources.now() / 1e3;
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
  function bounceOffBoundary(t, v, r, { left, right, top, bottom }) {
    if (t.x - r < left) {
      t.x = left + r;
      v.x = Math.abs(v.x);
    }
    if (t.x + r > right) {
      t.x = right - r;
      v.x = -Math.abs(v.x);
    }
    if (t.y - r < top) {
      t.y = top + r;
      v.y = Math.abs(v.y);
    }
    if (t.y + r > bottom) {
      t.y = bottom - r;
      v.y = -Math.abs(v.y);
    }
  }
  function borderSystem(world, { borderMode, planetId, dtFactor = 1 }) {
    if (borderMode === "outerSpace") {
      const canvas2 = world.resources.canvas;
      const width2 = canvas2.width;
      const height2 = canvas2.height;
      const rim = BOUNDARY.outerRimWidth;
      const bounds = { left: -rim, right: width2 + rim, top: -rim, bottom: height2 + rim };
      for (const shipId of shipIds(world)) {
        if (isRespawning(world, shipId)) continue;
        const t = world.stores.transform.get(shipId);
        const v = world.stores.velocity.get(shipId);
        const ship = world.stores.ship.get(shipId);
        if (!t || !v || !ship) continue;
        bounceOffBoundary(t, v, radiusFor(world, shipId), bounds);
      }
      for (const missileId of missileIds(world)) {
        if (world.dead.has(missileId)) continue;
        const t = world.stores.transform.get(missileId);
        const v = world.stores.velocity.get(missileId);
        if (!t || !v) continue;
        bounceOffBoundary(t, v, radiusFor(world, missileId), bounds);
      }
      return;
    }
    const canvas = world.resources.canvas;
    const width = canvas.width;
    const height = canvas.height;
    const nowMs = world.resources.now();
    const wrapCenter = (value, max) => {
      while (value < 0) value += max;
      while (value > max) value -= max;
      return value;
    };
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
      if (borderMode === "wrap") {
        if (wrapLeft || wrapRight || wrapTop || wrapBottom) {
          t.x = wrapCenter(t.x, width);
          t.y = wrapCenter(t.y, height);
        }
        continue;
      }
      if (!(hitLeft || hitRight || hitTop || hitBottom)) continue;
      if (borderMode === "concrete") {
        v.x = 0;
        v.y = 0;
        continue;
      }
      if (borderMode === "rubber") {
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
    }
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
      if (borderMode === "wrap") {
        if (wrapLeft || wrapRight || wrapTop || wrapBottom) {
          t.x = wrapCenter(t.x, width);
          t.y = wrapCenter(t.y, height);
        }
        continue;
      }
      if (!(hitLeft || hitRight || hitTop || hitBottom)) continue;
      if (borderMode === "concrete") {
        world.dead.add(missileId);
        continue;
      }
      if (borderMode === "rubber") {
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
        const colliding = dist < well.radius + 10;
        if (colliding) {
          collidingAnyWell = true;
          world.events.push({ type: "shipHitGravityWell", shipId, wellId });
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
          world.events.push({ type: "missileHitShip", missileId: mid, shipId, ownerShipId: owner });
          break;
        }
      }
    }
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
            world.events.push({ type: "shipRammed", a, b });
          }
        }
      }
    }
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
          world.events.push({ type: "missileHitMissile", a, b, x: aT.x, y: aT.y, color: aM.color });
        }
      }
    }
  }
  function rulesSystem(world, planetId) {
    const nowMs = world.resources.now();
    for (const event of world.events) {
      if (event.type === "shipHitGravityWell") {
        const shipId = event.shipId;
        if (isRespawning(world, shipId)) continue;
        const ship = world.stores.ship.get(shipId);
        const t = world.stores.transform.get(shipId);
        if (!ship.wellContact && ship._wellContactThisFrame) {
          const score = world.stores.score.get(shipId);
          score.value = Math.max(0, score.value - 1);
        }
        ship.wellContact = true;
        if (scheduleRespawnIfNeeded(world, shipId, nowMs)) {
          markExplosion(world, t.x, t.y, ship.color);
          if (world.resources.missilesDieWithShip) {
            killMissilesOwnedByShip(world, shipId, { explode: true });
          }
          const v = world.stores.velocity.get(shipId);
          if (v) {
            v.x = 0;
            v.y = 0;
          }
        }
      }
      if (event.type === "missileHitShip") {
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
          const v = world.stores.velocity.get(shipId);
          if (v) {
            v.x = 0;
            v.y = 0;
          }
        }
        if (ownerShipId && world.stores.score.has(ownerShipId)) {
          world.stores.score.get(ownerShipId).value++;
        }
        if (missile) {
        }
      }
      if (event.type === "shipRammed") {
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
            const v = world.stores.velocity.get(b);
            if (v) {
              v.x = 0;
              v.y = 0;
            }
          }
          world.stores.score.get(a).value++;
        } else if (bSpeed > aSpeed) {
          if (scheduleRespawnIfNeeded(world, a, nowMs)) {
            markExplosion(world, aT.x, aT.y, aShip.color);
            if (world.resources.missilesDieWithShip) {
              killMissilesOwnedByShip(world, a, { explode: true });
            }
            const v = world.stores.velocity.get(a);
            if (v) {
              v.x = 0;
              v.y = 0;
            }
          }
          world.stores.score.get(b).value++;
        } else {
          if (scheduleRespawnIfNeeded(world, a, nowMs)) {
            markExplosion(world, aT.x, aT.y, aShip.color);
            if (world.resources.missilesDieWithShip) {
              killMissilesOwnedByShip(world, a, { explode: true });
            }
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
            const v = world.stores.velocity.get(b);
            if (v) {
              v.x = 0;
              v.y = 0;
            }
          }
        }
      }
      if (event.type === "missileHitMissile") {
        world.dead.add(event.a);
        world.dead.add(event.b);
        markExplosion(world, event.x, event.y, event.color);
      }
    }
    world.events.length = 0;
    for (const shipId of shipIds(world)) {
      const ship = world.stores.ship.get(shipId);
      if (!ship._wellContactThisFrame) ship.wellContact = false;
      ship._wellContactThisFrame = false;
    }
    for (const [shipId, atMs] of world.stores.respawnAtMs) {
      if (nowMs >= atMs) {
        world.stores.respawnAtMs.delete(shipId);
        respawnShip(world, shipId, planetId, SHIP.invulnerableMs);
      }
    }
  }
  function noFuelSystem(world, planetId) {
    const ships = shipIds(world);
    if (ships.length < 2) return;
    const [s1, s2] = ships;
    const f1 = world.stores.fuel.get(s1)?.value ?? 0;
    const f2 = world.stores.fuel.get(s2)?.value ?? 0;
    const nowMs = world.resources.now();
    if (f1 <= 0 && f2 <= 0) {
      if (world.resources.noFuelStartMs === null) world.resources.noFuelStartMs = nowMs;
      if (nowMs - world.resources.noFuelStartMs > NO_FUEL_TIMEOUT_MS) {
        const t1 = world.stores.transform.get(s1);
        const t2 = world.stores.transform.get(s2);
        const c1 = world.stores.ship.get(s1).color;
        const c2 = world.stores.ship.get(s2).color;
        markExplosion(world, t1.x, t1.y, c1);
        markExplosion(world, t2.x, t2.y, c2);
        if (world.resources.missilesDieWithShip) {
          killMissilesOwnedByShip(world, s1, { explode: true });
          killMissilesOwnedByShip(world, s2, { explode: true });
        }
        world.stores.respawnAtMs.set(s1, nowMs + SHIP.respawnDelayMs);
        world.stores.respawnAtMs.set(s2, nowMs + SHIP.respawnDelayMs);
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
    for (const [id, ship] of world.stores.ship) {
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
        ctx.fillStyle = "#ff8000";
        ctx.beginPath();
        ctx.moveTo(-ship.height / 2, 0);
        ctx.lineTo(-ship.height / 1.5, -ship.width / 2);
        ctx.lineTo(-ship.height / 1.5, ship.width / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      drawOffscreenIndicator(ctx, canvas, t.x, t.y, radiusFor(world, id), ship.color);
    }
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
  function drawOffscreenIndicator(ctx, canvas, x, y, radius, color) {
    if (!OFFSCREEN_INDICATOR_ENABLED) return;
    const buffer = 10;
    const canvasLeft = buffer;
    const canvasRight = canvas.width - buffer;
    const canvasTop = buffer;
    const canvasBottom = canvas.height - buffer;
    const outLeft = x - radius < 0;
    const outRight = x + radius > canvas.width;
    const outTop = y - radius < 0;
    const outBottom = y + radius > canvas.height;
    if (!(outLeft || outRight || outTop || outBottom)) return;
    const dx = x - canvas.width / 2;
    const dy = y - canvas.height / 2;
    let indicatorX;
    let indicatorY;
    const m = Math.abs(dx) < 1e-4 ? Number.POSITIVE_INFINITY : dy / dx;
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
    indicatorX = Math.max(canvasLeft, Math.min(canvasRight, indicatorX));
    indicatorY = Math.max(canvasTop, Math.min(canvasBottom, indicatorY));
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(indicatorX, indicatorY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function stepWorld(world, { keys, justPressed }, {
    dtMs,
    planetId,
    borderMode = "outerSpace",
    winningScore = WINNING_SCORE,
    missilesDieWithShip = false
  }) {
    world.resources.missilesDieWithShip = Boolean(missilesDieWithShip);
    const dtFactor = dtFactorFromMs(dtMs);
    applyPlayerAndBotInput(world, keys, justPressed, dtFactor);
    botSystem(world, dtFactor);
    fireSystem(world);
    orbitSystem(world);
    gravitySystem(world, dtFactor);
    movementSystem(world, dtFactor);
    borderSystem(world, { borderMode, planetId, dtFactor });
    lifetimeSystem(world);
    collisionSystem(world);
    noFuelSystem(world, planetId);
    rulesSystem(world, planetId);
    world.resources.explosions = updateExplosions(world.resources.explosions, dtFactor);
    cleanupDead(world);
    drawWorld(world, planetId);
    return {
      winnerShipId: checkWin(world, winningScore)
    };
  }
  function getUiSnapshot(world) {
    const ships = [];
    for (const [id, ship] of world.stores.ship) {
      const score = world.stores.score.get(id)?.value ?? 0;
      const fuel = world.stores.fuel.get(id)?.value ?? 0;
      const activeMissiles = countActiveMissiles(world, id);
      ships.push({
        id,
        playerIndex: ship.playerIndex,
        score,
        fuel,
        maxFuel: world.stores.fuel.get(id)?.max ?? 0,
        activeMissiles,
        maxMissiles: ship.maxMissiles
      });
    }
    return { ships };
  }

  // engine/ui.js
  var AMMO_ICON_LAYOUTS = {
    1: [1],
    2: [1, 1],
    3: [1, 1, 1],
    4: [2, 2],
    5: [1, 2, 2],
    6: [2, 2, 2],
    7: [2, 3, 2],
    8: [3, 2, 3],
    9: [3, 3, 3]
  };
  function updateAmmoDisplay(document2, containerId, remaining, total) {
    const container = document2.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    const count = Math.max(0, Math.min(9, Math.round(remaining)));
    if (count === 0) return;
    if (count <= 3) {
      for (let i = 0; i < count; i++) {
        const missileDiv = document2.createElement("div");
        missileDiv.className = "missile-icon";
        container.appendChild(missileDiv);
      }
      return;
    }
    const rows = AMMO_ICON_LAYOUTS[count];
    for (const rowCount of rows) {
      const rowDiv = document2.createElement("div");
      rowDiv.className = "missile-icon-row";
      for (let i = 0; i < rowCount; i++) {
        const missileDiv = document2.createElement("div");
        missileDiv.className = "missile-icon-sm";
        rowDiv.appendChild(missileDiv);
      }
      container.appendChild(rowDiv);
    }
  }
  function updateFuelDisplay(document2, elementId, fuelSeconds) {
    const fuelElement = document2.getElementById(elementId);
    if (!fuelElement) return;
    const fuelLines = Math.max(0, Math.floor(fuelSeconds / MAX_FUEL_SECONDS * TOTAL_FUEL_LINES));
    fuelElement.innerHTML = "";
    for (let i = 0; i < fuelLines; i++) {
      const fuelLineDiv = document2.createElement("div");
      fuelLineDiv.className = "fuel-line";
      fuelElement.appendChild(fuelLineDiv);
    }
  }
  function updateUi(document2, snapshot) {
    for (const ship of snapshot.ships) {
      if (ship.playerIndex === 1) {
        const scoreEl = document2.getElementById("score-p1");
        if (scoreEl) scoreEl.textContent = String(ship.score);
        updateFuelDisplay(document2, "fuel-display-p1", ship.fuel);
        updateAmmoDisplay(
          document2,
          "missile-icons-p1",
          ship.maxMissiles - ship.activeMissiles,
          ship.maxMissiles
        );
      } else if (ship.playerIndex === 2) {
        const scoreEl = document2.getElementById("score-p2");
        if (scoreEl) scoreEl.textContent = String(ship.score);
        updateFuelDisplay(document2, "fuel-display-p2", ship.fuel);
        updateAmmoDisplay(
          document2,
          "missile-icons-p2",
          ship.maxMissiles - ship.activeMissiles,
          ship.maxMissiles
        );
      }
    }
  }

  // main.js
  document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("gameCanvas");
    const ctx = canvas.getContext("2d");
    const messageBox = document.getElementById("messageBox");
    const messageText = document.getElementById("messageText");
    const gameOverHeading = document.getElementById("gameOverHeading");
    const gameOverScore = document.getElementById("gameOverScore");
    const gameOverButtonContainer = document.getElementById("gameOverButtonContainer");
    const continueButton = document.getElementById("continueButton");
    const menuOptionsEl = document.getElementById("menuOptions");
    const readyP1Button = document.getElementById("readyP1Button");
    const readyBotP1Button = document.getElementById("readyBotP1Button");
    const readyP2Button = document.getElementById("readyP2Button");
    const readyBotP2Button = document.getElementById("readyBotP2Button");
    const resumeButton = document.getElementById("resumeButton");
    const quitButton = document.getElementById("quitButton");
    const readyButtonContainer = document.getElementById("ready-button-container");
    const pauseButtonContainer = document.getElementById("pause-button-container");
    const scoreP1 = document.getElementById("score-p1");
    const scoreP2 = document.getElementById("score-p2");
    const gameContainer = document.getElementById("gameContainer");
    const gameSpeedSlider = document.getElementById("gameSpeedSlider");
    const gameSpeedValue = document.getElementById("gameSpeedValue");
    const borderModeSelect = document.getElementById("borderModeSelect");
    const maxShotsInput = document.getElementById("maxShotsInput");
    const objectiveScoreInput = document.getElementById("objectiveScoreInput");
    const missilesDieWithShipCheckbox = document.getElementById("missilesDieWithShipCheckbox");
    const mapSelect = document.getElementById("mapSelect");
    let isGameRunning = false;
    let isGamePaused = false;
    let animationFrameId;
    let player1Ready = false;
    let player2Ready = false;
    let isPlayer1Bot = false;
    let isPlayer2Bot = false;
    let match = null;
    let keys = {};
    let justPressed = /* @__PURE__ */ new Set();
    let lastFrameMs = null;
    let gameSpeed = 1;
    let maxShots = 3;
    let borderMode = "outerSpace";
    let objectiveScore = 5;
    let missilesDieWithShip = true;
    let mapId = "classic";
    function clamp(n, min, max) {
      return Math.max(min, Math.min(max, n));
    }
    function formatSpeed(n) {
      return `${n.toFixed(1)}x`;
    }
    function setGameSpeed(speed) {
      gameSpeed = clamp(Number(speed) || 1, 0.5, 4);
      if (gameSpeedSlider) gameSpeedSlider.value = String(gameSpeed);
      if (gameSpeedValue) gameSpeedValue.textContent = formatSpeed(gameSpeed);
      try {
        localStorage.setItem("gduel.gameSpeed", String(gameSpeed));
      } catch (_) {
      }
    }
    function borderColorFor(mode) {
      if (mode === "concrete") return "darkgray";
      if (mode === "rubber") return "hotpink";
      if (mode === "wrap") return "yellow";
      return "white";
    }
    function applyBorderColor() {
      if (!gameContainer) return;
      gameContainer.style.borderColor = borderColorFor(borderMode);
    }
    function setBorderMode(mode) {
      borderMode = String(mode || "outerSpace");
      if (borderModeSelect) borderModeSelect.value = borderMode;
      applyBorderColor();
      try {
        localStorage.setItem("gduel.borderMode", borderMode);
      } catch (_) {
      }
    }
    function setMap(id) {
      mapId = String(id || "classic");
      if (mapSelect) mapSelect.value = mapId;
      try {
        localStorage.setItem("gduel.mapId", mapId);
      } catch (_) {
      }
      if (!isGameRunning && !isGamePaused) {
        recreateMatch();
        player1Ready = false;
        player2Ready = false;
        isPlayer1Bot = false;
        isPlayer2Bot = false;
        showMessageBox("start", 'Click "Ready" to Begin');
      }
    }
    function parseMaxShots(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 3;
      return Math.max(0, Math.min(9, Math.floor(n)));
    }
    function setMaxShots(value) {
      maxShots = parseMaxShots(value);
      if (maxShotsInput) maxShotsInput.value = String(maxShots);
      try {
        localStorage.setItem("gduel.maxShots", String(maxShots));
      } catch (_) {
      }
    }
    function applyMaxShotsToMatch() {
      if (!match) return;
      const ship1 = match.world.stores.ship.get(match.ship1Id);
      const ship2 = match.world.stores.ship.get(match.ship2Id);
      if (ship1) ship1.maxMissiles = maxShots;
      if (ship2) ship2.maxMissiles = maxShots;
    }
    function setMissilesDieWithShip(enabled) {
      missilesDieWithShip = Boolean(enabled);
      if (missilesDieWithShipCheckbox) missilesDieWithShipCheckbox.checked = missilesDieWithShip;
      if (match) match.world.resources.missilesDieWithShip = missilesDieWithShip;
      try {
        localStorage.setItem("gduel.missilesDieWithShip", missilesDieWithShip ? "1" : "0");
      } catch (_) {
      }
    }
    function parseObjectiveScore(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 5;
      return Math.max(1, Math.min(9, Math.floor(n)));
    }
    function setObjectiveScore(value) {
      objectiveScore = parseObjectiveScore(value);
      if (objectiveScoreInput) objectiveScoreInput.value = String(objectiveScore);
      try {
        localStorage.setItem("gduel.objectiveScore", String(objectiveScore));
      } catch (_) {
      }
    }
    try {
      const saved = localStorage.getItem("gduel.gameSpeed");
      if (saved != null) setGameSpeed(parseFloat(saved));
      else setGameSpeed(1);
    } catch (_) {
      setGameSpeed(1);
    }
    try {
      const savedBorder = localStorage.getItem("gduel.borderMode");
      if (savedBorder != null) setBorderMode(savedBorder);
      else setBorderMode("outerSpace");
    } catch (_) {
      setBorderMode("outerSpace");
    }
    try {
      const savedMap = localStorage.getItem("gduel.mapId");
      if (savedMap != null) setMap(savedMap);
      else setMap("classic");
    } catch (_) {
      setMap("classic");
    }
    try {
      const savedShots = localStorage.getItem("gduel.maxShots");
      if (savedShots != null) setMaxShots(savedShots);
      else setMaxShots(3);
    } catch (_) {
      setMaxShots(3);
    }
    try {
      const savedObjective = localStorage.getItem("gduel.objectiveScore");
      if (savedObjective != null) setObjectiveScore(savedObjective);
      else setObjectiveScore(5);
    } catch (_) {
      setObjectiveScore(5);
    }
    try {
      const savedMissilesDie = localStorage.getItem("gduel.missilesDieWithShip");
      if (savedMissilesDie != null) setMissilesDieWithShip(savedMissilesDie !== "0");
      else setMissilesDieWithShip(true);
    } catch (_) {
      setMissilesDieWithShip(false);
    }
    if (gameSpeedSlider) {
      gameSpeedSlider.addEventListener("input", (e) => {
        setGameSpeed(e.target.value);
      });
    }
    if (borderModeSelect) {
      borderModeSelect.addEventListener("change", (e) => {
        setBorderMode(e.target.value);
      });
    }
    if (mapSelect) {
      mapSelect.addEventListener("change", (e) => {
        if (isGameRunning || isGamePaused) return;
        setMap(e.target.value);
      });
    }
    if (maxShotsInput) {
      maxShotsInput.addEventListener("input", (e) => {
        setMaxShots(e.target.value);
        applyMaxShotsToMatch();
        if (match) updateUi(document, getUiSnapshot(match.world));
      });
    }
    if (objectiveScoreInput) {
      objectiveScoreInput.addEventListener("input", (e) => {
        setObjectiveScore(e.target.value);
      });
    }
    if (missilesDieWithShipCheckbox) {
      missilesDieWithShipCheckbox.addEventListener("change", (e) => {
        setMissilesDieWithShip(e.target.checked);
      });
    }
    document.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      const c = e.code.toLowerCase();
      if (isGameRunning && !isGamePaused) {
        if (k === "y") {
          pauseGame();
          return;
        }
        if (!keys[k]) {
          justPressed.add(k);
        }
        if (!keys[c]) {
          justPressed.add(c);
        }
        keys[k] = true;
        keys[c] = true;
      } else if (isGamePaused) {
        if (k === "y") {
          resumeGame();
        }
        if (k === "n") {
          quitGame();
        }
      }
    });
    document.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      const c = e.code.toLowerCase();
      keys[k] = false;
      keys[c] = false;
    });
    function resetGame() {
      if (!match) return;
      applyMaxShotsToMatch();
      resetMatch(match.world, match);
      lastFrameMs = null;
    }
    function recreateMatch() {
      match = createMatch({ canvas, ctx, document, maxMissiles: maxShots, mapId });
      applyMaxShotsToMatch();
      resetGame();
      stepWorld(
        match.world,
        { keys: {}, justPressed: /* @__PURE__ */ new Set() },
        {
          dtMs: 0,
          planetId: match.planetId,
          borderMode,
          winningScore: objectiveScore,
          missilesDieWithShip
        }
      );
      updateUi(document, getUiSnapshot(match.world));
    }
    function endGame() {
      isGameRunning = false;
      cancelAnimationFrame(animationFrameId);
      const player1Type = isPlayer1Bot ? "Bot" : "Human";
      const player2Type = isPlayer2Bot ? "Bot" : "Human";
      player1Ready = false;
      player2Ready = false;
      isPlayer1Bot = false;
      isPlayer2Bot = false;

      const P1_COLOR = "#00ff00";
      const P2_COLOR = "#ff0000";

      const snapshot = getUiSnapshot(match.world);
      const p1 = snapshot.ships.find((s) => s.playerIndex === 1);
      const p2 = snapshot.ships.find((s) => s.playerIndex === 2);

      let winner = null;
      let loser = null;
      if (p1 && p1.score >= objectiveScore) {
        winner = { label: "Player 1", colorName: "Green", type: player1Type, color: P1_COLOR, score: p1.score };
        loser = { color: P2_COLOR, score: p2 ? p2.score : 0 };
      } else if (p2 && p2.score >= objectiveScore) {
        winner = { label: "Player 2", colorName: "Red", type: player2Type, color: P2_COLOR, score: p2.score };
        loser = { color: P1_COLOR, score: p1 ? p1.score : 0 };
      }

      if (winner) {
        showGameOverScreen(winner, loser);
      }
    }
    function showGameOverScreen(winner, loser) {
      messageBox.style.display = "flex";
      if (menuOptionsEl) menuOptionsEl.style.display = "none";
      readyButtonContainer.style.display = "none";
      pauseButtonContainer.style.display = "none";
      if (gameOverHeading) gameOverHeading.style.display = "block";
      messageText.textContent = `${winner.label} (${winner.colorName}, ${winner.type}) wins the match!`;
      if (gameOverScore) {
        gameOverScore.innerHTML = `<span style="color:${winner.color}">${winner.score}</span><span class="game-over-score-sep">-</span><span style="color:${loser.color}">${loser.score}</span>`;
        gameOverScore.style.display = "flex";
      }
      if (gameOverButtonContainer) gameOverButtonContainer.style.display = "flex";
    }
    function resizeCanvas() {
      const gameContainer2 = document.getElementById("gameContainer");
      canvas.width = gameContainer2.clientWidth;
      canvas.height = gameContainer2.clientHeight;
      if (!match) {
        match = createMatch({ canvas, ctx, document, maxMissiles: maxShots, mapId });
      } else {
        resizeMatch(match.world, match, { width: canvas.width, height: canvas.height });
      }
      applyMaxShotsToMatch();
      resetGame();
      stepWorld(
        match.world,
        { keys: {}, justPressed: /* @__PURE__ */ new Set() },
        {
          dtMs: 0,
          planetId: match.planetId,
          borderMode,
          winningScore: objectiveScore,
          missilesDieWithShip
        }
      );
      updateUi(document, getUiSnapshot(match.world));
    }
    function goToSplashScreen() {
      // Navigate the whole tab back to the splash page. Unlike reaching into
      // the parent frame's JS, changing top.location works reliably across
      // frames regardless of how the page was opened (server or file://).
      window.top.location.href = "index.html";
      return true;
    }
    function showMessageBox(type, message) {
      messageText.textContent = message;
      messageBox.style.display = "flex";
      if (gameOverHeading) gameOverHeading.style.display = "none";
      if (gameOverScore) gameOverScore.style.display = "none";
      if (gameOverButtonContainer) gameOverButtonContainer.style.display = "none";
      if (menuOptionsEl) menuOptionsEl.style.display = "";
      if (type === "start") {
        readyButtonContainer.style.display = "flex";
        pauseButtonContainer.style.display = "none";
        document.getElementById("extraMenuOptions").style.display = "";
      } else if (type === "pause") {
        readyButtonContainer.style.display = "none";
        pauseButtonContainer.style.display = "flex";
        document.getElementById("extraMenuOptions").style.display = "none";
      }
    }
    function quitGame() {
      isGameRunning = false;
      isGamePaused = false;
      cancelAnimationFrame(animationFrameId);
      player1Ready = false;
      player2Ready = false;
      isPlayer1Bot = false;
      isPlayer2Bot = false;
      if (goToSplashScreen()) return;
      recreateMatch();
      showMessageBox("start", 'Click "Ready" to Begin');
    }
    function pauseGame() {
      isGamePaused = true;
      cancelAnimationFrame(animationFrameId);
      showMessageBox("pause", "Game Paused\nWould you like to resume?");
    }
    function resumeGame() {
      isGamePaused = false;
      messageBox.style.display = "none";
      gameLoop();
    }
    function startGame() {
      keys = {};
      justPressed = /* @__PURE__ */ new Set();
      messageBox.style.display = "none";
      isGameRunning = true;
      resetGame();
      gameLoop();
    }
    function gameLoop() {
      if (!isGameRunning || isGamePaused) return;
      const now = performance.now();
      if (lastFrameMs === null) lastFrameMs = now;
      const dtRealMs = Math.min(50, now - lastFrameMs);
      lastFrameMs = now;
      const dtMs = dtRealMs * gameSpeed;
      match.world.resources.gameTimeMs += dtMs;
      setBotEnabled(match.world, match.ship1Id, isPlayer1Bot);
      setBotEnabled(match.world, match.ship2Id, isPlayer2Bot);
      const result = stepWorld(
        match.world,
        { keys, justPressed },
        {
          dtMs,
          planetId: match.planetId,
          borderMode,
          winningScore: objectiveScore,
          missilesDieWithShip
        }
      );
      justPressed.clear();
      updateUi(document, getUiSnapshot(match.world));
      if (result.winnerShipId) {
        endGame();
        return;
      }
      animationFrameId = requestAnimationFrame(gameLoop);
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    function checkBothReady() {
      if (player1Ready && player2Ready) {
        startGame();
      } else if (player1Ready) {
        showMessageBox("start", `Player 1 (${isPlayer1Bot ? "Bot" : "Human"}) is ready. Waiting for Player 2...`);
      } else if (player2Ready) {
        showMessageBox("start", `Player 2 (${isPlayer2Bot ? "Bot" : "Human"}) is ready. Waiting for Player 1...`);
      }
    }
    readyP1Button.addEventListener("click", () => {
      player1Ready = true;
      isPlayer1Bot = false;
      checkBothReady();
    });
    readyBotP1Button.addEventListener("click", () => {
      player1Ready = true;
      isPlayer1Bot = true;
      checkBothReady();
    });
    readyP2Button.addEventListener("click", () => {
      player2Ready = true;
      isPlayer2Bot = false;
      checkBothReady();
    });
    readyBotP2Button.addEventListener("click", () => {
      player2Ready = true;
      isPlayer2Bot = true;
      checkBothReady();
    });
    resumeButton.addEventListener("click", resumeGame);
    quitButton.addEventListener("click", quitGame);
    if (continueButton) {
      continueButton.addEventListener("click", () => {
        if (goToSplashScreen()) return;
        showMessageBox("start", 'Click "Ready" to Begin');
      });
    }
    showMessageBox("start", 'Click "Ready" to Begin');
  });
})();
