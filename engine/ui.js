import { MAX_FUEL_SECONDS, TOTAL_FUEL_LINES } from './constants.js';

function updateAmmoContainer(document, containerId, emptySlots) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < emptySlots; i++) {
    const missileDiv = document.createElement('div');
    missileDiv.className = 'missile-icon';
    container.appendChild(missileDiv);
  }
}

function updateFuelDisplay(document, elementId, fuelSeconds) {
  const fuelElement = document.getElementById(elementId);
  if (!fuelElement) return;

  const fuelLines = Math.max(0, Math.floor((fuelSeconds / MAX_FUEL_SECONDS) * TOTAL_FUEL_LINES));
  fuelElement.innerHTML = '';

  for (let i = 0; i < fuelLines; i++) {
    const fuelLineDiv = document.createElement('div');
    fuelLineDiv.className = 'fuel-line';
    fuelElement.appendChild(fuelLineDiv);
  }
}

export function updateUi(document, snapshot) {
  for (const ship of snapshot.ships) {
    if (ship.playerIndex === 1) {
      const scoreEl = document.getElementById('score-p1');
      if (scoreEl) scoreEl.textContent = String(ship.score);
      updateFuelDisplay(document, 'fuel-display-p1', ship.fuel);
      updateAmmoContainer(document, 'missile-icons-p1', ship.maxMissiles - ship.activeMissiles);
    } else if (ship.playerIndex === 2) {
      const scoreEl = document.getElementById('score-p2');
      if (scoreEl) scoreEl.textContent = String(ship.score);
      updateFuelDisplay(document, 'fuel-display-p2', ship.fuel);
      updateAmmoContainer(document, 'missile-icons-p2', ship.maxMissiles - ship.activeMissiles);
    }
  }
}
