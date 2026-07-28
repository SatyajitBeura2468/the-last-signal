const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value, fallback, min = -Infinity, max = Infinity) => (
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
);

export const OBSERVATORY_STATE_VERSION = 2;
export const CANDIDATE_ID_PATTERN = /^(TLS|CND)-[A-Z0-9-]{3,32}$/;

export function sanitizeText(value, maxLength = 5000) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, maxLength)
    : '';
}

export function sanitizePersistedState(raw) {
  if (!isObject(raw)) return null;
  const version = Number(raw.version);
  if (version !== 1 && version !== OBSERVATORY_STATE_VERSION) return null;

  const logs = Array.isArray(raw.logs)
    ? raw.logs.slice(0, 40).map((entry) => ({
      time: sanitizeText(entry?.time, 16),
      frequency: sanitizeText(entry?.frequency, 40),
      status: sanitizeText(entry?.status, 20),
      id: sanitizeText(entry?.id, 40),
      title: sanitizeText(entry?.title, 80),
      message: sanitizeText(entry?.message, 240),
      operational: Boolean(entry?.operational),
    }))
    : [];

  const unlockedSignalIds = Array.isArray(raw.unlockedSignalIds)
    ? raw.unlockedSignalIds.filter((id) => typeof id === 'string' && CANDIDATE_ID_PATTERN.test(id)).slice(0, 30)
    : [];

  const settings = isObject(raw.settings) ? {
    audio: raw.settings.audio !== false,
    reducedMotion: Boolean(raw.settings.reducedMotion),
    sensitivity: finite(Number(raw.settings.sensitivity), 1, 0.5, 2),
    renderQuality: ['AUTO', 'HIGH', 'BALANCED', 'BATTERY', 'REDUCED_MOTION'].includes(raw.settings.renderQuality)
      ? raw.settings.renderQuality
      : 'AUTO',
  } : null;

  const observatory = isObject(raw.observatory) ? {
    selectedWorld: ['live-ops', 'lab', 'sky', 'evidence', 'systems'].includes(raw.observatory.selectedWorld)
      ? raw.observatory.selectedWorld
      : 'live-ops',
    selectedDish: sanitizeText(raw.observatory.selectedDish, 20),
    selectedCandidate: sanitizeText(raw.observatory.selectedCandidate, 40),
    selectedSector: sanitizeText(raw.observatory.selectedSector, 30),
    notebook: sanitizeText(raw.observatory.notebook, 5000),
    sealed: Boolean(raw.observatory.sealed),
    baseline: ['COMPACT', 'LONG', 'POLAR'].includes(raw.observatory.baseline) ? raw.observatory.baseline : 'LONG',
    evidence: Array.isArray(raw.observatory.evidence)
      ? raw.observatory.evidence.filter(isObject).slice(0, 30).map((item) => ({
        id: sanitizeText(item.id, 50),
        title: sanitizeText(item.title, 90),
        detail: sanitizeText(item.detail, 240),
        time: sanitizeText(item.time, 32),
        type: sanitizeText(item.type, 30),
      }))
      : [],
    scheduled: Array.isArray(raw.observatory.scheduled)
      ? raw.observatory.scheduled.filter(isObject).slice(0, 20).map((item) => ({
        id: sanitizeText(item.id, 40),
        name: sanitizeText(item.name, 100),
        baseline: sanitizeText(item.baseline, 20),
        time: sanitizeText(item.time, 32),
        window: sanitizeText(item.window, 80),
      }))
      : [],
  } : null;

  return {
    version: OBSERVATORY_STATE_VERSION,
    frequencyMHz: finite(Number(raw.frequencyMHz), 4217.812651, 10, 100000),
    unlockedSignalIds,
    logs,
    settings,
    observatory,
    sessionToken: sanitizeText(raw.sessionToken, 4096),
    lastSavedAt: finite(Number(raw.lastSavedAt), 0, 0),
  };
}

export function isValidCandidateId(id) {
  return typeof id === 'string' && CANDIDATE_ID_PATTERN.test(id);
}
