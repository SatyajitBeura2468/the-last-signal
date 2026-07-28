import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFreshness, validateRegistryEntry } from '../../src/data/source-registry.js';
import { sanitizePersistedState } from '../../src/core/state-schema.js';

test('restored state rejects malformed identifiers and control characters', () => {
  const restored = sanitizePersistedState({
    version: 2,
    frequencyMHz: 4217.8,
    unlockedSignalIds: ['../../bad', 'TLS-4217812651'],
    logs: [{ message: 'safe\u0000text' }],
    observatory: { notebook: '<script>alert(1)</script>\u0000' },
  });
  assert.deepEqual(restored.unlockedSignalIds, ['TLS-4217812651']);
  assert.equal(restored.logs[0].message, 'safetext');
  assert.ok(!restored.observatory.notebook.includes('\u0000'));
});

test('source registry classifies fresh and stale records', () => {
  const now = Date.parse('2026-07-28T18:00:00Z');
  const fresh = validateRegistryEntry({
    source: 'NOAA SWPC',
    fetchedAt: '2026-07-28T17:59:00Z',
    sourceTimestamp: '2026-07-28T17:59:00Z',
    status: 'LIVE',
    staleAfter: 120000,
    value: { solarWindSpeed: 380 },
  });
  assert.equal(classifyFreshness(fresh, now), 'LIVE');
  assert.equal(classifyFreshness({ ...fresh, staleAfter: 1000 }, now), 'STALE');
});
