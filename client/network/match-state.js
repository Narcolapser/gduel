function mapToArray(map) {
  return Array.from(map.entries());
}

function setMapFromArray(map, entries) {
  map.clear();
  for (const [key, value] of entries) map.set(key, value);
}

function setSetFromArray(setObj, entries) {
  setObj.clear();
  for (const value of entries) setObj.add(value);
}

export function serializeWorld(world) {
  return {
    nextId: world.nextId,
    entities: Array.from(world.entities),
    dead: Array.from(world.dead),
    stores: {
      transform: mapToArray(world.stores.transform),
      velocity: mapToArray(world.stores.velocity),
      collider: mapToArray(world.stores.collider),
      ship: mapToArray(world.stores.ship),
      missile: mapToArray(world.stores.missile),
      owner: mapToArray(world.stores.owner),
      score: mapToArray(world.stores.score),
      stats: mapToArray(world.stores.stats),
      fuel: mapToArray(world.stores.fuel),
      invulnerableUntilMs: mapToArray(world.stores.invulnerableUntilMs),
      respawnAtMs: mapToArray(world.stores.respawnAtMs),
      gravityWell: mapToArray(world.stores.gravityWell),
      gravityMultiplier: mapToArray(world.stores.gravityMultiplier),
      orbit: mapToArray(world.stores.orbit),
      playerInput: mapToArray(world.stores.playerInput),
      bot: mapToArray(world.stores.bot),
      planet: Array.from(world.stores.planet),
    },
    resources: {
      gameTimeMs: world.resources.gameTimeMs,
      explosions: world.resources.explosions,
      noFuelStartMs: world.resources.noFuelStartMs,
      spawnDistance: world.resources.spawnDistance,
      missilesDieWithShip: world.resources.missilesDieWithShip,
    },
  };
}

export function applyWorldState(world, state) {
  if (!state || !state.stores) return false;
  world.nextId = Number.isFinite(state.nextId) ? state.nextId : world.nextId;
  world.entities = new Set(Array.isArray(state.entities) ? state.entities : []);
  world.dead = new Set(Array.isArray(state.dead) ? state.dead : []);

  setMapFromArray(world.stores.transform, state.stores.transform || []);
  setMapFromArray(world.stores.velocity, state.stores.velocity || []);
  setMapFromArray(world.stores.collider, state.stores.collider || []);
  setMapFromArray(world.stores.ship, state.stores.ship || []);
  setMapFromArray(world.stores.missile, state.stores.missile || []);
  setMapFromArray(world.stores.owner, state.stores.owner || []);
  setMapFromArray(world.stores.score, state.stores.score || []);
  setMapFromArray(world.stores.stats, state.stores.stats || []);
  setMapFromArray(world.stores.fuel, state.stores.fuel || []);
  setMapFromArray(world.stores.invulnerableUntilMs, state.stores.invulnerableUntilMs || []);
  setMapFromArray(world.stores.respawnAtMs, state.stores.respawnAtMs || []);
  setMapFromArray(world.stores.gravityWell, state.stores.gravityWell || []);
  setMapFromArray(world.stores.gravityMultiplier, state.stores.gravityMultiplier || []);
  setMapFromArray(world.stores.orbit, state.stores.orbit || []);
  setMapFromArray(world.stores.playerInput, state.stores.playerInput || []);
  setMapFromArray(world.stores.bot, state.stores.bot || []);
  setSetFromArray(world.stores.planet, state.stores.planet || []);

  if (state.resources && typeof state.resources === 'object') {
    world.resources.gameTimeMs = Number(state.resources.gameTimeMs) || 0;
    world.resources.explosions = Array.isArray(state.resources.explosions)
      ? state.resources.explosions
      : [];
    world.resources.noFuelStartMs = state.resources.noFuelStartMs ?? null;
    world.resources.spawnDistance = state.resources.spawnDistance ?? null;
    world.resources.missilesDieWithShip = Boolean(state.resources.missilesDieWithShip);
  }
  return true;
}

export function serializeMatchState(matchState) {
  return {
    world: serializeWorld(matchState.world),
    shipIds: Array.isArray(matchState.shipIds) ? matchState.shipIds : null,
    ship1Id: matchState.ship1Id ?? null,
    ship2Id: matchState.ship2Id ?? null,
    planetId: matchState.planetId ?? null,
    mapId: matchState.mapId ?? null,
    playerOrder: matchState.playerOrder ?? null,
  };
}

export function applyMatchState(matchState, snapshot) {
  if (!snapshot || !snapshot.world) return false;
  if (!applyWorldState(matchState.world, snapshot.world)) return false;
  matchState.shipIds = Array.isArray(snapshot.shipIds) ? snapshot.shipIds : matchState.shipIds;
  matchState.ship1Id = snapshot.ship1Id ?? matchState.ship1Id;
  matchState.ship2Id = snapshot.ship2Id ?? matchState.ship2Id;
  matchState.planetId = snapshot.planetId ?? matchState.planetId;
  matchState.mapId = snapshot.mapId ?? matchState.mapId;
  matchState.playerOrder = snapshot.playerOrder ?? matchState.playerOrder;
  return true;
}
