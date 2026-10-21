import { MAX_FUEL_SECONDS, TOTAL_FUEL_LINES } from './constants.js';

// Pip-style layouts for showing 1-9 missiles as icons instead of digits.
// Each entry is the list of icon counts per row, top to bottom.
const AMMO_ICON_LAYOUTS = {
  1: [1],
  2: [1, 1],
  3: [1, 1, 1],
  4: [2, 2],
  5: [1, 2, 2],
  6: [2, 2, 2],
  7: [2, 3, 2],
  8: [3, 2, 3],
  9: [3, 3, 3],
};

function updateAmmoDisplay(document, containerId, remaining, total) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  const count = Math.max(0, Math.min(9, Math.round(remaining)));
  if (count === 0) return;

  // 1-3: single column of full-size icons (unchanged from before).
  if (count <= 3) {
    for (let i = 0; i < count; i++) {
      const missileDiv = document.createElement('div');
      missileDiv.className = 'missile-icon';
      container.appendChild(missileDiv);
    }
    return;
  }

  // 4-9: compact grid, arranged per AMMO_ICON_LAYOUTS.
  const rows = AMMO_ICON_LAYOUTS[count];
  for (const rowCount of rows) {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'missile-icon-row';
    for (let i = 0; i < rowCount; i++) {
      const missileDiv = document.createElement('div');
      missileDiv.className = 'missile-icon-sm';
      rowDiv.appendChild(missileDiv);
    }
    container.appendChild(rowDiv);
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
      updateAmmoDisplay(
        document,
        'missile-icons-p1',
        ship.maxMissiles - ship.activeMissiles,
        ship.maxMissiles,
      );
    } else if (ship.playerIndex === 2) {
      const scoreEl = document.getElementById('score-p2');
      if (scoreEl) scoreEl.textContent = String(ship.score);
      updateFuelDisplay(document, 'fuel-display-p2', ship.fuel);
      updateAmmoDisplay(
        document,
        'missile-icons-p2',
        ship.maxMissiles - ship.activeMissiles,
        ship.maxMissiles,
      );
    }
  }
}
