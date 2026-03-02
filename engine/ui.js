import { MAX_FUEL_SECONDS, TOTAL_FUEL_LINES } from './constants.js';

function updateAmmoDisplay(document, containerId, remaining, total) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  // For larger counts, avoid creating lots of DOM nodes.
  if (total > 3) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ammo-count';

    const remainingEl = document.createElement('div');
    remainingEl.className = 'ammo-count-line';
    remainingEl.textContent = String(Math.max(0, remaining));

    const totalEl = document.createElement('div');
    totalEl.className = 'ammo-count-line';
    totalEl.textContent = String(Math.max(0, total));

    wrapper.appendChild(remainingEl);
    wrapper.appendChild(totalEl);
    container.appendChild(wrapper);
    return;
  }

  for (let i = 0; i < Math.max(0, remaining); i++) {
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

export function updateUi(document, snapshot, { activePlayerIndex = null } = {}) {
  if (activePlayerIndex != null) {
    const active = snapshot.ships.find((s) => s.playerIndex === activePlayerIndex);
    if (!active) return;

    const scoreEl = document.getElementById('score-p1');
    if (scoreEl) scoreEl.textContent = String(active.score);
    updateFuelDisplay(document, 'fuel-display-p1', active.fuel);
    updateAmmoDisplay(
      document,
      'missile-icons-p1',
      active.maxMissiles - active.activeMissiles,
      active.maxMissiles,
    );

    // Clear the second panel if it exists.
    const scoreEl2 = document.getElementById('score-p2');
    if (scoreEl2) scoreEl2.textContent = '';
    updateFuelDisplay(document, 'fuel-display-p2', 0);
    updateAmmoDisplay(document, 'missile-icons-p2', 0, 0);
    return;
  }

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
