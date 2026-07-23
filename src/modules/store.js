import { CONFIG } from './config.js';

const createSessionId = () => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `TLS-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

export function getSessionId() {
  let id = sessionStorage.getItem(CONFIG.sessionKey);
  if (!id) {
    id = createSessionId();
    sessionStorage.setItem(CONFIG.sessionKey, id);
  }
  return id;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveState(state) {
  const safe = {
    version: 1,
    frequencyMHz: state.frequencyMHz,
    unlockedSignalIds: [...state.unlockedSignalIds],
    logs: state.logs.slice(0, CONFIG.maxLogs),
    settings: state.settings,
    lastSavedAt: Date.now(),
  };
  localStorage.setItem(CONFIG.storageKey, JSON.stringify(safe));
}
