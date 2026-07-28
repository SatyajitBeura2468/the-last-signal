import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicNoise } from '../../src/modules/spectrum-renderer.js';
import { formatFrequency, frequencyFromRatio, logFrequency } from '../../src/modules/signal-engine.js';
import { updateIncidentEngine } from '../../src/simulation/incident-engine.js';
import { queueCommand, updateMissionEngine } from '../../src/simulation/mission-engine.js';
import { updateResourceModel } from '../../src/simulation/resource-model.js';
import { createObservatoryFixture } from '../helpers/observatory-fixture.js';

test('frequency conversion round-trips across the logarithmic tuner', () => {
  for (const frequency of [10, 1420.405752, 4217.812651, 100000]) {
    const restored = frequencyFromRatio(logFrequency(frequency));
    assert.ok(Math.abs(restored - frequency) / frequency < 1e-10);
  }
  assert.equal(formatFrequency(4217.812651), '4.217.812.651');
});

test('render noise is deterministic for the same sample and seed', () => {
  assert.equal(deterministicNoise(19, 42, 7), deterministicNoise(19, 42, 7));
  assert.notEqual(deterministicNoise(19, 42, 7), deterministicNoise(20, 42, 7));
});

test('resource changes remain continuous and bounded', () => {
  const resources = {
    mainPower: 98,
    reservePower: 31,
    cryogenicReserve: 74,
    thermalLoad: 21,
    dataBuffer: 42,
    processingLoad: 18,
  };
  const before = structuredClone(resources);
  updateResourceModel(resources, {
    slewProgress: 0.4,
    missionStage: 'OBSERVING',
    thermalContribution: 2,
    solarCharging: false,
  }, 0.1);
  for (const key of Object.keys(resources)) {
    assert.ok(Number.isFinite(resources[key]));
    assert.ok(Math.abs(resources[key] - before[key]) < 1);
  }
});

test('incidents require physical prerequisites and respect cooldown', () => {
  const fixture = createObservatoryFixture().observatory;
  fixture.resources.cryogenicReserve = 20;
  updateIncidentEngine(fixture, 0.1);
  assert.equal(fixture.incidents.active.type, 'CRYOGENIC_INSTABILITY');
  const firstId = fixture.incidents.active.id;
  updateIncidentEngine(fixture, 1);
  assert.equal(fixture.incidents.active.id, firstId);
});

test('commands progress over time and apply their consequence only on completion', () => {
  const observatory = createObservatoryFixture().observatory;
  const result = queueCommand(observatory, 'APPLY_RFI');
  assert.equal(result.accepted, true);
  updateMissionEngine(observatory, 1);
  assert.equal(observatory.lab.filters.rfi, false);
  updateMissionEngine(observatory, 2);
  assert.equal(observatory.lab.filters.rfi, true);
  assert.equal(observatory.mission.correctionsApplied, 1);
});

test('an evidence commit is deterministic and idempotent', () => {
  const observatory = createObservatoryFixture().observatory;
  observatory.mission.correlation = 65;
  observatory.mission.revisitConfirmed = true;
  const first = queueCommand(observatory, 'COMMIT_EVIDENCE');
  updateMissionEngine(observatory, 3);
  assert.equal(observatory.vault.entries[0].id, `EVD-${first.command.id.replace('CMD-', '')}`);
  assert.equal(queueCommand(observatory, 'COMMIT_EVIDENCE').reason, 'ALREADY_COMMITTED');
  assert.equal(observatory.vault.entries.length, 1);
});
