import test from 'node:test';
import assert from 'node:assert/strict';
import { localSiderealTime } from '../../src/simulation/astronomy.js';
import { stepObservatory } from '../../src/simulation/observatory-engine.js';
import { queueCommand, updateMissionEngine } from '../../src/simulation/mission-engine.js';
import { createObservatoryFixture } from '../helpers/observatory-fixture.js';

test('target selection propagates into dish pointing and receiver readiness', () => {
  const state = createObservatoryFixture();
  const observatory = state.observatory;
  const date = observatory.clock.utcMs;
  observatory.activeTarget.raHours = localSiderealTime(date, observatory.station.coordinates.longitudeDeg);
  observatory.activeTarget.decDeg = observatory.station.coordinates.latitudeDeg;
  const beforeAzimuth = observatory.array.dishes[0].targetAzimuth;
  stepObservatory(state, 1000, {
    signal: observatory.activeTarget,
    strength: -38,
    quality: 84,
    stability: 91,
    proximity: 1,
    distance: 0,
    centerFrequency: observatory.activeTarget.frequencyMHz,
    bandwidth: 0.5,
  }, 100);
  assert.notEqual(observatory.array.dishes[0].targetAzimuth, beforeAzimuth);
  assert.ok(observatory.astronomy.altitudeDeg > 80);
  assert.ok(Number.isFinite(state.operations.alignment));
});

test('forensic, revisit and evidence commands create a validated lifecycle', () => {
  const observatory = createObservatoryFixture().observatory;
  observatory.mission.stage = 'CANDIDATE';
  observatory.mission.sampleCount = 1;
  for (const type of ['APPLY_RFI', 'APPLY_DOPPLER', 'RUN_CORRELATION', 'SCHEDULE_REVISIT', 'CONFIRM_REVISIT', 'COMMIT_EVIDENCE']) {
    const result = queueCommand(observatory, type);
    assert.equal(result.accepted, true);
    updateMissionEngine(observatory, 10);
  }
  assert.ok(observatory.mission.correctionsApplied >= 2);
  assert.ok(observatory.mission.correlation >= 55);
  assert.equal(observatory.mission.revisitConfirmed, true);
  assert.equal(observatory.mission.evidenceCommitted, true);
  assert.equal(observatory.vault.entries.length, 1);
});
