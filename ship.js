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
        missiles: 3,
        invulnerable: false,
        hasBeenPenalized: false,
        fuel: MAX_FUEL_SECONDS,
        isPlayer1,
        score: 0,
    };

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
    };

    function updateAmmoContainer(containerId) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        for (let i = 0; i < ship.missiles; i++) {
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
        ship.missiles = 3;
        ship.fuel = MAX_FUEL_SECONDS;

        const gravityConstant = 50; 
        const circularVelocity = 0.9 * Math.sqrt(gravityConstant / INITIAL_DISTANCE); 

        ship.x = canvas.width / 2 + (ship.isPlayer1 ? INITIAL_DISTANCE : -INITIAL_DISTANCE);
        ship.y = canvas.height / 2;
        ship.velocityX = 0;
        ship.velocityY = ship.isPlayer1 ? circularVelocity : -circularVelocity;
        ship.angle = Math.PI * ship.isPlayer1 ? 1.5 : 4.75;
        ship.destroyed = false;
        ship.missiles = 3;
        ship.fuel = MAX_FUEL_SECONDS;
        ship.invulnerable = true;
        ship.hasBeenPenalized = false;
        setTimeout(() => ship.invulnerable = false, invulnerabilitySeconds ?? 0);
    }

    function updateShip(planet, createExplosion, respawnShip) {
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

    ship.drawShip = drawShip;
    ship.updateAmmoContainer = updateAmmoContainer;
    ship.updateFuelDisplay = updateFuelDisplay;
    ship.resetInitialPosition = resetInitialPosition;
    ship.updateShip = updateShip;
    ship.engageThrust = engageThrust;
    ship.rotateLeft = rotateLeft;
    ship.rotateRight = rotateRight;
    return ship;
};
