export const COLOR_PALETTE = [
  '#00f5ff',
  '#ff3b30',
  '#34ff00',
  '#ffd60a',
  '#7b2cff',
  '#ff9500',
  '#00d4ff',
  '#ff006e',
  '#1e90ff',
  '#a3ff12',
  '#ff66cc',
  '#00ffb3',
  '#c77d00',
  '#5e60ce',
  '#9ef01a',
  '#ffffff',
];

const STORAGE_KEYS = {
  name: 'gduel.playerName',
  color: 'gduel.playerColor',
  observer: 'gduel.playerObserver',
};

function resolveValue(value, fallback) {
  if (value != null) return value;
  return typeof fallback === 'function' ? fallback() : fallback;
}

function normalizeName(name, fallbackName) {
  const resolvedFallback = resolveValue(null, fallbackName) ?? 'Pilot';
  if (typeof name === 'string' && name.trim()) return name.trim();
  return String(resolvedFallback).trim() || 'Pilot';
}

export function isPaletteColor(color) {
  return typeof color === 'string' && COLOR_PALETTE.includes(color.toLowerCase());
}

function normalizeColor(color, fallbackColor) {
  const resolvedFallback = resolveValue(null, fallbackColor) ?? COLOR_PALETTE[0];
  if (isPaletteColor(color)) return color.toLowerCase();
  if (isPaletteColor(resolvedFallback)) return resolvedFallback.toLowerCase();
  return COLOR_PALETTE[0];
}

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    // Ignore storage failures.
  }
}

export function loadStoredProfile({
  defaultName = 'Pilot',
  fallbackColor = COLOR_PALETTE[0],
  includeObserver = false,
} = {}) {
  const name = normalizeName(safeGetItem(STORAGE_KEYS.name), defaultName);
  const color = normalizeColor(safeGetItem(STORAGE_KEYS.color), fallbackColor);

  let observer = false;
  if (includeObserver) {
    observer = safeGetItem(STORAGE_KEYS.observer) !== '0';
  }

  safeSetItem(STORAGE_KEYS.name, name);
  safeSetItem(STORAGE_KEYS.color, color);
  if (includeObserver) {
    safeSetItem(STORAGE_KEYS.observer, observer ? '1' : '0');
  }

  return { name, color, observer };
}

export function saveStoredProfile({
  name,
  color,
  observer = false,
  defaultName = 'Pilot',
  fallbackColor = COLOR_PALETTE[0],
  includeObserver = false,
} = {}) {
  const normalizedName = normalizeName(name, defaultName);
  const normalizedColor = normalizeColor(color, fallbackColor);

  safeSetItem(STORAGE_KEYS.name, normalizedName);
  safeSetItem(STORAGE_KEYS.color, normalizedColor);
  if (includeObserver) {
    safeSetItem(STORAGE_KEYS.observer, observer ? '1' : '0');
  }

  return {
    name: normalizedName,
    color: normalizedColor,
    observer: Boolean(observer),
  };
}
