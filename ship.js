import { Missile } from './missile.js';

export function Ship(canvas, ctx, document, isPlayer1) {
    const MAX_FUEL_SECONDS = 10;
    const TOTAL_FUEL_LINES = 57;
    const FUEL_PER_FRAME = (1 / (MAX_FUEL_SECONDS * 60)) * 2;
    const INITIAL_DISTANCE = 100;

    const ship = {
        x: 0,
        y: 0,
        width: 10,
        height: 20,
        angle: Math.PI,
        thrust: 0,
        rotationSpeed: 0.025,
        velocityX: 0,
        velocityY: 0,
        color: isPlayer1 ? '#00ff00' :'#ff0000',
        destroyed: false,
        maxMissiles: 3,
        invulnerable: false,
        hasBeenPenalized: false,
        fuel: MAX_FUEL_SECONDS,
        isPlayer1,
        score: 0,
    };

    let _missiles = [];
    Object.defineProperty(ship, 'missiles', {
        get() {
            return _missiles;
        },
        set(value) {
            if (Number.isNaN(value)) {
                // Throwing here gives you a stack trace for the bad assignment
                throw new Error('ship.missiles was set to NaN');
            }
            if (!Array.isArray(value)) {
                console.warn('ship.missiles was set to a non-array value:', value);
            }
            _missiles = value;
        },
        enumerable: true,
        configurable: true
    });


    function drawShip() {
        if (ship.destroyed) return;
        ctx.save();
        ctx.translate(ship.x, ship.y);
        ctx.rotate(ship.angle);

        ctx.fillStyle = ship.color;
        ctx.shadowColor = ship.color;
        ctx.shadowBlur = 15;

        if (ship.invulnerable) {
            ctx.globalAlpha = Math.abs(Math.sin(Date.now() / 150));
        }

        ctx.beginPath();
        ctx.moveTo(ship.height / 2, 0);
        ctx.lineTo(-ship.height / 2, -ship.width / 2);
        ctx.lineTo(-ship.height / 2, ship.width / 2);
        ctx.closePath();
        ctx.fill();

        if (ship.thrusted) {
            ctx.fillStyle = '#ff8000'
            ctx.beginPath();
            ctx.moveTo(-ship.height / 2, 0);
            ctx.lineTo(-ship.height / 1.5, -ship.width / 2);
            ctx.lineTo(-ship.height / 1.5, ship.width / 2);
            ctx.closePath();
            ctx.fill()
        }

        ctx.restore();
        ctx.globalAlpha = 1.0;
        ctx.shadowBlur = 0;
        drawOffscreenIndicator();
        ship.missiles.forEach((m) => m.drawMissile());
    };

    function drawOffscreenIndicator() {
        const buffer = 10;
        const canvasLeft = buffer;
        const canvasRight = canvas.width - buffer;
        const canvasTop = buffer;
        const canvasBottom = canvas.height - buffer;

        if (ship.x > canvas.width || ship.x < 0 || ship.y > canvas.height || ship.y < 0) {
            const dx = ship.x - canvas.width / 2;
            const dy = ship.y - canvas.height / 2;
            const angle = Math.atan2(dy, dx);

            let indicatorX, indicatorY;
            let m = dy / dx;

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
            ctx.fillStyle = ship.color;
            ctx.shadowColor = ship.color;
            ctx.shadowBlur = 15;
            ctx.beginPath();
            ctx.arc(indicatorX, indicatorY, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function updateAmmoContainer(containerId) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        for (let i = ship.missiles.length; i < ship.maxMissiles; i++) {
            const missileDiv = document.createElement('div');
            missileDiv.className = 'missile-icon';
            container.appendChild(missileDiv)
        }
    }

    function updateFuelDisplay(fuelElementid) {
        const fuelElement = document.getElementById(fuelElementid);
        const fuelLines = Math.max(0, Math.floor((ship.fuel / MAX_FUEL_SECONDS) * TOTAL_FUEL_LINES));
        fuelElement.innerHTML = '';
        for (let i = 0; i < fuelLines; i++) {
            const fuelLineDiv = document.createElement('div');
            fuelLineDiv.className = 'fuel-line';
            fuelElement.appendChild(fuelLineDiv);
        }
    }

    function resetInitialPosition(invulnerabilitySeconds) {
        ship.destroyed = false;
        ship.fuel = MAX_FUEL_SECONDS;

        const gravityConstant = 50; 
        const circularVelocity = 0.9 * Math.sqrt(gravityConstant / INITIAL_DISTANCE); 

        ship.x = canvas.width / 2 + (ship.isPlayer1 ? INITIAL_DISTANCE : -INITIAL_DISTANCE);
        ship.y = canvas.height / 2;
        ship.velocityX = 0;
        ship.velocityY = ship.isPlayer1 ? circularVelocity : -circularVelocity;
        ship.angle = Math.PI * ship.isPlayer1 ? 1.5 : 4.75;
        ship.destroyed = false;
        ship.missiles = [];
        ship.fuel = MAX_FUEL_SECONDS;
        ship.invulnerable = true;
        ship.hasBeenPenalized = false;
        setTimeout(() => ship.invulnerable = false, invulnerabilitySeconds ?? 0);
    }

    function updateShip(planet, createExplosion, respawnShip, opponent) {
        if (ship.destroyed) return;
        
        let dx = planet.x - ship.x;
        let dy = planet.y - ship.y;
        let distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 1) {
            const gravityConstant = 50; 
            let gravityForce = gravityConstant / (distance * distance);
            ship.velocityX += gravityForce * dx / distance;
            ship.velocityY += gravityForce * dy / distance;
        }
        
        if (ship.thrust !== 0) {
            ship.velocityX += ship.thrust * Math.cos(ship.angle);
            ship.velocityY += ship.thrust * Math.sin(ship.angle);
            ship.thrusted = true;
            ship.thrust = 0;
        } else {
            ship.thrusted = false;
        }

        ship.x += ship.velocityX;
        ship.y += ship.velocityY;

        if (distance < planet.radius + 10) {
            if (!ship.hasBeenPenalized) {
                    ship.score = Math.max(0, ship.score - 1);
                    ship.hasBeenPenalized = true;
            }
            
            ship.destroyed = true;
            createExplosion(ship.x, ship.y, ship.color);
            respawnShip(ship);
        } else {
            ship.hasBeenPenalized = false;
        }

        const dragZoneWidth = 100;
        const canvasCenterX = canvas.width / 2;
        const canvasCenterY = canvas.height / 2;

        const distToCenter = Math.sqrt(Math.pow(ship.x - canvasCenterX, 2) + Math.pow(ship.y - canvasCenterY, 2));
        const canvasMaxDist = Math.sqrt(Math.pow(canvas.width / 2, 2) + Math.pow(canvas.height / 2, 2));

        if (distToCenter > canvasMaxDist) {
            const dragStrength = (distToCenter - canvasMaxDist) / dragZoneWidth;
            const dragAngle = Math.atan2(canvasCenterY - ship.y, canvasCenterX - ship.x);
            
            ship.velocityX += dragStrength * Math.cos(dragAngle) * 0.2;
            ship.velocityY += dragStrength * Math.sin(dragAngle) * 0.2;
        }

        ship.missiles.forEach(m => m.updateMissle(planet, ship.missiles, [ship, opponent], createExplosion, respawnShip));
        ship.missiles = ship.missiles.filter(m => !m.destroyed);
    }

    function engageThrust() {
        if (ship.fuel) {
            ship.thrust = 0.002;
            ship.fuel -= FUEL_PER_FRAME;
        }
    }

    function rotateLeft() {
        ship.angle -= ship.rotationSpeed;
    }

    function rotateRight() {
        ship.angle += ship.rotationSpeed;
    }

    function fire() {
        if (ship.missiles.length < ship.maxMissiles) {
            ship.missiles.push(Missile(ctx, canvas, ship));
        }
    }

    function isCollidingShip(other, createExplosion, respawnShip) {
        if (!ship.destroyed && !other.destroyed) {
            let shipDistance = Math.sqrt(Math.pow(ship.x - other.x, 2) + Math.pow(ship.y - other.y, 2));
            let collisionDistance = ship.width + other.width;

            if (shipDistance < collisionDistance) {
                const player1Velocity = Math.sqrt(Math.pow(ship.velocityX, 2) + Math.pow(ship.velocityY, 2));
                const player2Velocity = Math.sqrt(Math.pow(other.velocityX, 2) + Math.pow(other.velocityY, 2));

                if (player1Velocity > player2Velocity) {
                    other.destroyed = true;
                    ship.score++;
                    createExplosion(other.x, other.y, other.color);
                    respawnShip(other);
                } else if (player2Velocity > player1Velocity) {
                    ship.destroyed = true;
                    other.score++;
                    createExplosion(ship.x, ship.y, ship.color);
                    respawnShip(ship);
                } else {
                    ship.destroyed = true;
                    other.destroyed = true;
                    createExplosion(ship.x, ship.y, ship.color);
                    createExplosion(other.x, other.y, other.color);
                    respawnShip(ship);
                    respawnShip(other);
                }        
            }
        }
    }

    ship.drawShip = drawShip;
    ship.updateAmmoContainer = updateAmmoContainer;
    ship.updateFuelDisplay = updateFuelDisplay;
    ship.resetInitialPosition = resetInitialPosition;
    ship.updateShip = updateShip;
    ship.engageThrust = engageThrust;
    ship.rotateLeft = rotateLeft;
    ship.rotateRight = rotateRight;
    ship.fire = fire;
    ship.isCollidingShip = isCollidingShip;
    return ship;
};
