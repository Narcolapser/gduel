export function createExplosionParticles({ x, y, color, rng = Math.random }) {
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
      alpha: 1.0,
    });
  }

  return { particles };
}

export function updateExplosions(explosions, dtFactor) {
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

export function drawExplosions(ctx, explosions) {
  for (const explosion of explosions) {
    for (const p of explosion.particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1.0;
}
