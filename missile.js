export function Missile(ctx, canvas, ship) {
    const MISSILE_LIFETIME = 30000;
    const MISSILE_COLLISION_GRACE_PERIOD = 1000;

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

    function updateMissle(planet, missiles, ships, createExplosion, respawnShip) {
        if (missile.destroyed) return;
        
        let dx = planet.x - missile.x;
        let dy = planet.y - missile.y;
        let distance = Math.sqrt(dx * dx + dy * dy);

        if (Date.now() - missile.timestamp > MISSILE_LIFETIME) {
            missile.destroyed = true;
            createExplosion(missile.x, missile.y, missile.color);
            missile.parent.missiles++;
            return;
        }

        if (distance > 1) {
            const gravityConstant = 200; 
            let gravityForce = gravityConstant / (distance * distance);
            missile.velocityX += gravityForce * dx / distance;
            missile.velocityY += gravityForce * dy / distance;
        }
        
        missile.x += missile.velocityX;
        missile.y += missile.velocityY;

        if (distance < planet.radius + 5) {
            missile.destroyed = true;
            missile.parent.missiles++;
        }

        const canvasMaxDist = Math.sqrt(Math.pow(canvas.width / 2, 2) + Math.pow(canvas.height / 2, 2));
        const distToCenter = Math.sqrt(Math.pow(missile.x - canvas.width/2, 2) + Math.pow(missile.y - canvas.height/2, 2));
        if (distToCenter > canvasMaxDist + 50) {
                missile.destroyed = true;
                missile.parent.missiles++;
        }

        const otherShip = ships.filter(s => s !== missile.parent)[0];
        if (!otherShip.destroyed && !otherShip.invulnerable) {
            const shipDistance = Math.sqrt(Math.pow(missile.x - otherShip.x, 2) + Math.pow(missile.y - otherShip.y, 2));
            if (shipDistance < otherShip.width) {
                otherShip.destroyed = true;
                missile.destroyed = true;
                createExplosion(otherShip.x, otherShip.y, otherShip.color);
                missile.parent.missiles++;
                missile.parent.score ++;
                respawnShip(otherShip);
            }
        }

        missiles.forEach(otherMissile => {
            if (missile !== otherMissile && !missile.destroyed && !otherMissile.destroyed) {
                const isSamePlayer = missile.parent === otherMissile.parent;
                const isPastGracePeriod = Date.now() - missile.timestamp > MISSILE_COLLISION_GRACE_PERIOD;
                
                if (!isSamePlayer || isPastGracePeriod) {
                    const missileDistance = Math.sqrt(Math.pow(missile.x - otherMissile.x, 2) + Math.pow(missile.y - otherMissile.y, 2));
                    if (missileDistance < 8) {
                        missile.destroyed = true;
                        otherMissile.destroyed = true;
                        createExplosion(missile.x, missile.y, missile.color);
                        missile.parent.missiles++;
                        otherMissile.parent.missiles++;
                    }
                }
            }
        });
    }

    missile.drawMissile = drawMissile;
    missile.updateMissle = updateMissle;
    return missile;
}
