export function drawShip(ship, ctx) {
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

    if (ship.thrust !== 0) {
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
}

export function updateAmmoContainer(ship, containerId, document) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    for (let i = 0; i < ship.missiles; i++) {
        const missileDiv = document.createElement('div');
        missileDiv.className = 'missile-icon';
        container.appendChild(missileDiv)
    }
}

const MAX_FUEL_SECONDS = 10;
const TOTAL_FUEL_LINES = 57;
const FUEL_PER_FRAME = (1 / (MAX_FUEL_SECONDS * 60)) * 2;

export function updateFuelDisplay(ship, fuelElementid, document) {
    const fuelElement = document.getElementById(fuelElementid);
    const fuelLines = Math.max(0, Math.floor((ship.fuel / MAX_FUEL_SECONDS) * TOTAL_FUEL_LINES));
    fuelElement.innerHTML = '';
    for (let i = 0; i < fuelLines; i++) {
        const fuelLineDiv = document.createElement('div');
        fuelLineDiv.className = 'fuel-line';
        fuelElement.appendChild(fuelLineDiv);
    }
}
