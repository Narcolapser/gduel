import { PLANET, SHIP } from './constants.js';
import { createEntity, set } from './world.js';
import { spawnGravityWell } from './spawn.js';

export const MAPS = {
  classic: {
    id: 'classic',
    name: 'Classic',
  },
  earth: {
    id: 'earth',
    name: 'Earth',
  },
  pluto: {
    id: 'pluto',
    name: 'Pluto',
  },
};

function spawnAnchor(world, { x, y }) {
  const anchorId = createEntity(world);
  set(world.stores.transform, anchorId, { x, y, angle: 0 });
  return anchorId;
}

export function createMap(world, { mapId, width, height }) {
  const id = MAPS[mapId]?.id ?? MAPS.classic.id;
  const cx = width / 2;
  const cy = height / 2;

  // Anchor is the point ships spawn/respawn around. It is *not* a gravity well.
  const anchorId = spawnAnchor(world, { x: cx, y: cy });

  if (id === 'classic') {
    // Current behavior: a single well centered.
    spawnGravityWell(world, {
      x: cx,
      y: cy,
      mu: PLANET.mu,
      radius: PLANET.radius,
      color: PLANET.color,
      softening: PLANET.softening,
    });
    return { id, anchorId };
  }

  if (id === 'earth') {
    const earthId = spawnGravityWell(world, {
      x: cx,
      y: cy,
      mu: PLANET.mu,
      radius: PLANET.radius,
      color: '#2a6fdb',
      softening: PLANET.softening,
    });

    const moonOrbitRadius = 2 * SHIP.initialDistance;
    const moonId = spawnGravityWell(world, {
      x: cx + moonOrbitRadius,
      y: cy,
      mu: PLANET.mu * 0.25,
      radius: Math.max(10, Math.floor(PLANET.radius * 0.45)),
      color: '#b0b0b0',
      softening: 1,
    });

    // Orbit period ~12s at 1x game speed.
    const angularSpeed = (2 * Math.PI) / 12;
    world.stores.orbit.set(moonId, {
      centerId: earthId,
      radius: moonOrbitRadius,
      angularSpeed,
      phase: 0,
    });

    return { id, anchorId };
  }

  if (id === 'pluto') {
    // Two planetoids orbit a barycenter (anchor), opposite phases.
    const orbitRadius = 60;
    const angularSpeed = (2 * Math.PI) / 8;
    const phase = Math.PI / 2;

    const plutoId = spawnGravityWell(world, {
      x: cx,
      y: cy + orbitRadius,
      mu: PLANET.mu * 0.9,
      radius: Math.max(16, Math.floor(PLANET.radius * 0.75)),
      color: '#c8b39a',
      softening: 1,
    });

    const charonId = spawnGravityWell(world, {
      x: cx,
      y: cy - orbitRadius,
      mu: PLANET.mu * 0.45,
      radius: Math.max(12, Math.floor(PLANET.radius * 0.55)),
      color: '#9ea3a6',
      softening: 1,
    });

    world.stores.orbit.set(plutoId, {
      centerId: anchorId,
      radius: orbitRadius,
      angularSpeed,
      phase,
    });
    world.stores.orbit.set(charonId, {
      centerId: anchorId,
      radius: orbitRadius,
      angularSpeed,
      phase: phase + Math.PI,
    });

    return { id, anchorId };
  }

  // Fallback.
  spawnGravityWell(world, {
    x: cx,
    y: cy,
    mu: PLANET.mu,
    radius: PLANET.radius,
    color: PLANET.color,
    softening: PLANET.softening,
  });
  return { id: 'classic', anchorId };
}
