export const TICK_MS = 1000 / 60;

export const WINNING_SCORE = 5;

export const MAX_FUEL_SECONDS = 10;
export const TOTAL_FUEL_LINES = 57;
// Matches the old per-frame burn: (1/(MAX_FUEL_SECONDS*60))*2
export const FUEL_PER_FRAME = (1 / (MAX_FUEL_SECONDS * 60)) * 2;
export const NO_FUEL_TIMEOUT_MS = 30_000;

export const SHIP = {
  width: 10,
  height: 20,
  rotationSpeed: 0.025,
  thrustPower: 0.002,
  maxMissiles: 3,
  initialDistance: 100,
  respawnDelayMs: 3000,
  invulnerableMs: 3000,
};

export const MISSILE = {
  speed: 1,
  ttlMs: 30_000,
  collisionGraceMs: 1000,
  offscreenKillBuffer: 50,
};

export const PLANET = {
  radius: 30,
  color: '#ffffff',
  // Old ship gravity constant.
  mu: 50,
  // Softening keeps forces finite very near the center.
  softening: 2,
};

export const GRAVITY_MULTIPLIERS = {
  ship: 1,
  missile: 4, // Old missile gravity constant was 200 vs ship 50.
};

export const BOUNDARY = {
  dragZoneWidth: 100,
  dragCoeff: 0.2,
};
