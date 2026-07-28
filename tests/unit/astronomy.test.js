import test from 'node:test';
import assert from 'node:assert/strict';
import {
  equatorialToHorizontal,
  julianDate,
  localSiderealTime,
} from '../../src/simulation/astronomy.js';

test('Julian date matches the J2000 epoch', () => {
  assert.equal(julianDate(Date.parse('2000-01-01T12:00:00Z')), 2451545);
});

test('Greenwich sidereal time matches the J2000 reference', () => {
  const lst = localSiderealTime(Date.parse('2000-01-01T12:00:00Z'), 0);
  assert.ok(Math.abs(lst - 18.697374558) < 0.0001);
});

test('a target on the meridian at the observer declination reaches zenith', () => {
  const date = Date.parse('2026-07-28T18:00:00Z');
  const longitudeDeg = 82.257;
  const latitudeDeg = 19.145;
  const raHours = localSiderealTime(date, longitudeDeg);
  const result = equatorialToHorizontal({ raHours, decDeg: latitudeDeg, latitudeDeg, longitudeDeg, date });
  assert.ok(result.altitudeDeg > 89.99);
  assert.equal(result.visible, true);
});
