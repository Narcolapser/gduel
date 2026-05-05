import { MAX_FUEL_SECONDS, TOTAL_FUEL_LINES } from './constants.js';

function setHudColor(document, slot, color) {
  const fuelEl = document.getElementById(`fuel-display-${slot}`);
  if (fuelEl) fuelEl.style.borderColor = color || '';

  const ammoEl = document.getElementById(`ammo-display-${slot}`);
  if (ammoEl) ammoEl.style.borderColor = color || '';
}

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

function updateFuelDisplay(document, elementId, fuelSeconds, color = null) {
  const fuelElement = document.getElementById(elementId);
  if (!fuelElement) return;

  const fuelLines = Math.max(0, Math.floor((fuelSeconds / MAX_FUEL_SECONDS) * TOTAL_FUEL_LINES));
  fuelElement.innerHTML = '';

  for (let i = 0; i < fuelLines; i++) {
    const fuelLineDiv = document.createElement('div');
    fuelLineDiv.className = 'fuel-line';
    if (color) {
      fuelLineDiv.style.backgroundColor = color;
      fuelLineDiv.style.boxShadow = `0 0 5px ${color}`;
    }
    fuelElement.appendChild(fuelLineDiv);
  }
}

export function updateUi(document, snapshot, { activePlayerIndex = null } = {}) {
  const active = activePlayerIndex == null
    ? null
    : snapshot.ships.find((s) => s.playerIndex === activePlayerIndex);

  if (!active) {
    setHudColor(document, 'active', null);
    updateFuelDisplay(document, 'fuel-display-active', 0, null);
    updateAmmoDisplay(document, 'missile-icons-active', 0, 0);
    return;
  }

  setHudColor(document, 'active', active.color);
  updateFuelDisplay(document, 'fuel-display-active', active.fuel, active.color);
  updateAmmoDisplay(
    document,
    'missile-icons-active',
    active.maxMissiles - active.activeMissiles,
    active.maxMissiles,
  );
}
