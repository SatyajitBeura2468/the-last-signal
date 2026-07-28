import { updateArrayModel } from './array-model.js';
import { approximateSunHorizontal, equatorialToHorizontal, estimateRiseSetWindow, formatSiderealTime } from './astronomy.js';
import { updateIncidentEngine } from './incident-engine.js';
import { updateMissionEngine } from './mission-engine.js';
import { updateReceiverModel } from './receiver-model.js';
import { updateResourceModel } from './resource-model.js';
import { tickSimulationClock } from '../core/simulation-clock.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function updateAstronomy(observatory) {
  const { coordinates } = observatory.station;
  const date = new Date(observatory.clock.utcMs);
  const target = observatory.activeTarget;
  const horizontal = equatorialToHorizontal({
    raHours: target.raHours,
    decDeg: target.decDeg,
    latitudeDeg: coordinates.latitudeDeg,
    longitudeDeg: coordinates.longitudeDeg,
    date,
  });
  const sun = approximateSunHorizontal({
    latitudeDeg: coordinates.latitudeDeg,
    longitudeDeg: coordinates.longitudeDeg,
    date,
  });
  const window = estimateRiseSetWindow({
    raHours: target.raHours,
    decDeg: target.decDeg,
    latitudeDeg: coordinates.latitudeDeg,
    longitudeDeg: coordinates.longitudeDeg,
    date,
  });
  Object.assign(observatory.astronomy, horizontal, {
    sunAltitudeDeg: sun.altitudeDeg,
    windowLabel: window.status === 'WINDOW' ? `${window.riseUtc}–${window.setUtc}` : window.status,
  });
  observatory.sources.astronomy.value = {
    lst: formatSiderealTime(horizontal.lstHours),
    altitudeDeg: horizontal.altitudeDeg,
    azimuthDeg: horizontal.azimuthDeg,
    sunAltitudeDeg: sun.altitudeDeg,
  };
  observatory.sources.astronomy.fetchedAt = date.toISOString();
  observatory.sources.astronomy.sourceTimestamp = date.toISOString();
}

function updateEnvironment(observatory) {
  const seconds = observatory.clock.elapsedMs / 1000;
  const kp = observatory.environment.kpIndex;
  const deterministicRfi = 0.08
    + Math.max(0, Math.sin(seconds * 0.021 - 1.4)) * 0.42
    + Math.max(0, Math.sin(seconds * 0.0063 - 2.1)) * 0.24;
  observatory.environment.rfiLevel += (clamp(deterministicRfi, 0.03, 0.92) - observatory.environment.rfiLevel) * 0.025;
  observatory.environment.spaceWeatherPenalty = clamp(
    Math.max(0, observatory.environment.solarWindSpeed - 450) / 180 + kp * 0.07,
    0,
    3.8,
  );
  observatory.array.windSpeedKph = 12 + Math.abs(Math.sin(seconds * 0.0047)) * 18;
}

function bridgeLegacyState(state) {
  const observatory = state.observatory;
  const activeIncident = observatory.incidents.active;
  const event = activeIncident
    ? { severity: activeIncident.severity, title: activeIncident.title, message: activeIncident.message }
    : observatory.mission.stage === 'CANDIDATE'
      ? { severity: 'signal', title: 'CANDIDATE EMERGED', message: `${observatory.mission.candidateId} accumulated enough coherent evidence for analysis.` }
      : { severity: 'nominal', title: 'ARRAY NOMINAL', message: 'Receiver, timing and array resources are inside the active observing envelope.' };
  const changed = event.title !== state.operations.currentEvent.title;
  state.operations.currentEvent = event;
  state.operations.alignment = observatory.array.alignment;
  state.operations.power = observatory.resources.mainPower;
  state.operations.temperature = -196.2 + observatory.resources.thermalLoad * 0.055;
  state.operations.boost = observatory.receiver.gain;
  state.operations.clockDrift = observatory.array.clockOffsetNs / 100;
  if (changed) {
    state.operations.eventNumber += 1;
    state.operations.lastEmittedEvent = {
      ...event,
      eventNumber: state.operations.eventNumber,
      time: performance.now(),
    };
  } else {
    state.operations.lastEmittedEvent = null;
  }
}

export function stepObservatory(state, time, baseTelemetry, deltaMs = 16) {
  const observatory = state.observatory;
  tickSimulationClock(observatory.clock, time);
  const realDeltaSeconds = Math.max(0.001, Math.min(0.25, deltaMs / 1000 || 0.016));
  const deltaSeconds = realDeltaSeconds * Math.max(0.1, observatory.clock.speed || 1);
  observatory.array.elapsedSeconds = observatory.clock.elapsedMs / 1000;
  updateAstronomy(observatory);
  updateEnvironment(observatory);
  updateArrayModel(observatory.array, observatory.astronomy, observatory.resources, deltaSeconds);
  observatory.array.clockOffsetNs = observatory.array.dishes.reduce((sum, dish) => sum + Math.abs(dish.clockOffset), 0) / observatory.array.dishes.length;

  const signalContribution = Math.max(0, (baseTelemetry?.strength ?? -112) + 112);
  updateReceiverModel(observatory.receiver, {
    targetAltitude: observatory.astronomy.altitudeDeg,
    thermalLoad: observatory.resources.thermalLoad,
    rfiLevel: observatory.environment.rfiLevel,
    spaceWeatherPenalty: observatory.environment.spaceWeatherPenalty,
    clockOffsetNs: observatory.array.clockOffsetNs,
    signalContribution,
    arrayCoherence: observatory.array.coherence,
    slewProgress: observatory.array.slewProgress,
  }, deltaSeconds);
  updateResourceModel(observatory.resources, {
    slewProgress: observatory.array.slewProgress,
    missionStage: observatory.mission.stage,
    thermalContribution: observatory.receiver.thermalContribution,
    solarCharging: observatory.astronomy.sunAltitudeDeg > -4,
  }, deltaSeconds);
  updateMissionEngine(observatory, deltaSeconds);
  updateIncidentEngine(observatory, deltaSeconds);

  const adjustedQuality = clamp(
    (baseTelemetry?.quality ?? 4)
      * (0.52 + observatory.array.coherence * 0.48)
      - observatory.environment.rfiLevel * 18
      - Math.max(0, observatory.receiver.thermalContribution - 2) * 1.7,
    1,
    99,
  );
  const adjustedStability = clamp(
    (baseTelemetry?.stability ?? 8) * (0.5 + observatory.array.slewProgress * 0.5)
      - Math.abs(observatory.array.clockOffsetNs) * 0.35,
    1,
    99,
  );
  const telemetry = {
    ...baseTelemetry,
    quality: Math.round(adjustedQuality),
    stability: Math.round(adjustedStability),
    coherence: observatory.receiver.coherence,
    noiseFloor: observatory.receiver.noiseFloor,
    interference: observatory.environment.rfiLevel,
    lockable: Boolean(
      baseTelemetry?.signal
      && observatory.receiver.lockState === 'LOCKABLE'
      && adjustedQuality >= 38
      && adjustedStability >= 34
    ),
    provenance: {
      spaceWeather: observatory.sources.spaceWeather.status,
      astronomy: observatory.sources.astronomy.status,
    },
  };
  state.buffer = observatory.resources.dataBuffer;
  bridgeLegacyState(state);
  return telemetry;
}
