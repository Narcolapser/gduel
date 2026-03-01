export function applyGravity({
  targetTransform,
  targetVelocity,
  wells,
  multiplier,
  ignoreWellId,
  dtFactor,
}) {
  let ax = 0;
  let ay = 0;

  for (const well of wells) {
    if (ignoreWellId != null && well.id === ignoreWellId) continue;
    const dx = well.x - targetTransform.x;
    const dy = well.y - targetTransform.y;

    const soft = well.softening ?? 0;
    const distSq = dx * dx + dy * dy + soft * soft;
    if (distSq <= 0.000001) continue;

    const dist = Math.sqrt(distSq);
    const accel = (well.mu * multiplier) / distSq;

    ax += (accel * dx) / dist;
    ay += (accel * dy) / dist;
  }

  targetVelocity.x += ax * dtFactor;
  targetVelocity.y += ay * dtFactor;
}
