export function Missile(ctx, ship) {
    const missileSpeed = 1;
    const missileX = ship.x + (ship.height / 2) * Math.cos(ship.angle);
    const missileY = ship.y + (ship.height / 2) * Math.sin(ship.angle);

    const missile = {
        x: missileX,
        y: missileY,
        velocityX: ship.velocityX + missileSpeed * Math.cos(ship.angle),
        velocityY: ship.velocityY + missileSpeed * Math.sin(ship.angle),
        color: ship.color,
        destroyed: false,
        parent: ship,
        timestamp: Date.now()
    };

    function drawMissile() {
        console.log('drawing missile');
        if (missile.destroyed) return;
        ctx.save();
        ctx.translate(missile.x, missile.y);
        ctx.fillStyle = missile.color;
        ctx.shadowColor = missile.color;
        ctx.shadowBlur = 10;
        ctx.fillRect(-2, -2, 4, 4);
        ctx.restore();
        ctx.shadowBlur = 0;
    }

    missile.drawMissile = drawMissile;
    return missile;
}
