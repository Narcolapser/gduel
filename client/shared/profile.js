export const COLOR_PALETTE = [
  '#00F5FF',
  '#FF3B30',
  '#34FF00',
  '#FFD60A',
  '#7B2CFF',
  '#FF9500',
  '#00D4FF',
  '#FF006E',
  '#1E90FF',
  '#A3FF12',
  '#FF66CC',
  '#00FFB3',
  '#C77D00',
  '#5E60CE',
  '#9EF01A',
  '#FFFFFF',
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
  return typeof color === 'string' && COLOR_PALETTE.includes(color);
}

function normalizeColor(color, fallbackColor) {
  const resolvedFallback = resolveValue(null, fallbackColor) ?? COLOR_PALETTE[0];
  if (isPaletteColor(color)) return color;
  if (isPaletteColor(resolvedFallback)) return resolvedFallback;
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
