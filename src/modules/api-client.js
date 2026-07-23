import { FALLBACK_SIGNALS } from './config.js';

async function request(path, options = {}, timeoutMs = 4500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSignalCatalog(sessionId) {
  try {
    const payload = await request(`/api/signals?session=${encodeURIComponent(sessionId)}`);
    if (!Array.isArray(payload.signals) || payload.signals.length === 0) throw new Error('Empty catalog');
    return { signals: payload.signals, source: 'server' };
  } catch {
    return { signals: FALLBACK_SIGNALS, source: 'local-fallback' };
  }
}

export async function requestDecode(signal, progress, sessionId) {
  try {
    return await request('/api/decode', {
      method: 'POST',
      body: JSON.stringify({ signalId: signal.id, progress, sessionId }),
    });
  } catch {
    const index = Math.min(signal.fragments.length - 1, Math.floor((progress / 100) * signal.fragments.length));
    return { progress, fragment: signal.fragments[index], completed: progress >= 100, source: 'local-fallback' };
  }
}

export async function syncSession(summary) {
  try {
    return await request('/api/session', { method: 'POST', body: JSON.stringify(summary) }, 3000);
  } catch {
    return { accepted: false, offline: true };
  }
}
