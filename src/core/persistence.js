import { OBSERVATORY_STATE_VERSION, sanitizePersistedState } from './state-schema.js';

export const STORAGE_KEY = 'tls:observatory-state:v2';
const LEGACY_RECEIVER_KEY = 'tls:receiver-state:v1';
const LEGACY_OBSERVATORY_KEY = 'tls:observatory-expansion:v1';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadPersistedState() {
  const current = sanitizePersistedState(read(STORAGE_KEY));
  if (current) return current;

  const receiver = read(LEGACY_RECEIVER_KEY);
  const observatory = read(LEGACY_OBSERVATORY_KEY);
  if (!receiver && !observatory) return null;

  return sanitizePersistedState({
    version: OBSERVATORY_STATE_VERSION,
    frequencyMHz: receiver?.frequencyMHz,
    unlockedSignalIds: receiver?.unlockedSignalIds,
    logs: receiver?.logs,
    settings: receiver?.settings,
    observatory: observatory ? {
      selectedWorld: observatory.selectedWorld === 'array'
        ? 'live-ops'
        : observatory.selectedWorld === 'nav'
          ? 'sky'
          : observatory.selectedWorld === 'vault'
            ? 'evidence'
            : observatory.selectedWorld,
      selectedDish: observatory.selectedDish,
      selectedCandidate: observatory.selectedCandidate,
      selectedSector: observatory.selectedSector,
      notebook: observatory.vault?.notes,
      sealed: observatory.vault?.sealed,
      baseline: observatory.navigation?.baseline,
      evidence: observatory.vault?.entries,
      scheduled: observatory.navigation?.scheduled,
    } : null,
  });
}

export function savePersistedState(state) {
  const observatory = state.observatory;
  const safe = sanitizePersistedState({
    version: OBSERVATORY_STATE_VERSION,
    frequencyMHz: state.frequencyMHz,
    unlockedSignalIds: [...state.unlockedSignalIds],
    logs: state.logs,
    settings: state.settings,
    sessionToken: state.sessionToken,
    observatory: {
      selectedWorld: observatory.selectedWorld,
      selectedDish: observatory.selectedDish,
      selectedCandidate: observatory.selectedCandidate,
      selectedSector: observatory.selectedSector,
      notebook: observatory.vault.notes,
      sealed: observatory.vault.sealed,
      baseline: observatory.navigation.baseline,
      evidence: observatory.vault.entries,
      scheduled: observatory.navigation.scheduled,
    },
    lastSavedAt: Date.now(),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  return safe;
}

export function describePersistenceMode() {
  return {
    mode: 'LOCAL_SIGNED_SIMULATION',
    durable: false,
    label: 'Local browser state + signed decode token',
  };
}
