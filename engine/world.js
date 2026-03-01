function makeStores() {
  return {
    transform: new Map(), // {x,y,angle}
    velocity: new Map(), // {x,y}
    collider: new Map(), // {radius}

    ship: new Map(), // {playerIndex,color,width,height,rotationSpeed,thrustPower,maxMissiles,thrusted,wellContact}
    missile: new Map(), // {color,spawnMs,ttlMs,graceMs}
    owner: new Map(), // {id}

    score: new Map(), // {value}
    fuel: new Map(), // {value,max}
    invulnerableUntilMs: new Map(), // number
    respawnAtMs: new Map(), // number

    gravityWell: new Map(), // {mu,radius,color,softening}
    gravityMultiplier: new Map(), // number

    playerInput: new Map(), // {thrust,left,right,fire}
    bot: new Map(), // {enabled:boolean}

    // Render tags
    planet: new Set(),
  };
}

export function createWorld({ canvas, ctx, document, now = () => performance.now() }) {
  const stores = makeStores();

  // The engine uses `resources.now()` for all timers (missile TTL, respawns, etc.).
  // We keep a separate game-time clock so the simulation speed can be scaled
  // deterministically by the main loop.
  const resources = {
    canvas,
    ctx,
    document,
    realNow: now,
    gameTimeMs: 0,
    now: () => resources.gameTimeMs,
    explosions: [],
    noFuelStartMs: null,
  };

  return {
    nextId: 1,
    entities: new Set(),
    dead: new Set(),
    events: [],
    stores,
    resources,
  };
}

export function createEntity(world) {
  const id = world.nextId++;
  world.entities.add(id);
  return id;
}

export function killEntity(world, entityId) {
  world.dead.add(entityId);
}

export function cleanupDead(world) {
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

export function has(store, id) {
  return store instanceof Map ? store.has(id) : store.has(id);
}

export function get(store, id) {
  return store instanceof Map ? store.get(id) : store.has(id);
}

export function set(store, id, value) {
  if (!(store instanceof Map)) throw new Error('set() expects a Map store');
  store.set(id, value);
}
