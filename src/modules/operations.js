const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const EVENTS = [
  { severity: 'nominal', title: 'ARRAY NOMINAL', message: 'Listening window clear. Deep field telemetry is stable.', duration: 4200 },
  { severity: 'info', title: 'CLOCK DISCIPLINE', message: 'Atomic reference reacquired. Phase drift corrected by 0.04 ms.', duration: 3600 },
  { severity: 'info', title: 'IONOSPHERE CLEAR', message: 'Local propagation conditions improved across the narrowband.', duration: 4200 },
  { severity: 'warning', title: 'DUST LANE CROSSING', message: 'Broadband scatter rising. Signal confidence may fluctuate.', duration: 4200 },
  { severity: 'warning', title: 'THERMAL RECALIBRATION', message: 'Cryogenic receiver is trimming gain against a slow thermal drift.', duration: 3900 },
  { severity: 'info', title: 'RELAY HANDSHAKE', message: 'Archive relay acknowledged the current listening session.', duration: 3200 },
  { severity: 'warning', title: 'BACKGROUND BURST', message: 'A short-lived interference impulse crossed the receiver band.', duration: 3000 },
];

function xorshift(seed) {
  let value = seed || 0x31f0a7b;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

export function createOperationsState(seed = Math.floor(Math.random() * 0xffffffff)) {
  return {
    random: xorshift(seed),
    lastTime: 0,
    nextEventAt: 3500,
    currentEvent: EVENTS[0],
    alertUntil: 0,
    eventNumber: 0,
    alignment: 87.4,
    power: 98.1,
    temperature: -195.2,
    boost: 22.7,
    clockDrift: 0.04,
    carrierSeen: null,
    lastInterferenceEventAt: -Infinity,
    lastEmittedEvent: null,
  };
}

function chooseAmbientEvent(random, previous) {
  const choices = EVENTS.filter((event) => event !== previous);
  return choices[Math.floor(random() * choices.length)];
}

function emit(state, event, time) {
  state.currentEvent = event;
  state.alertUntil = time + event.duration;
  state.nextEventAt = time + 4800 + state.random() * 6200;
  state.eventNumber += 1;
  state.lastEmittedEvent = { ...event, eventNumber: state.eventNumber, time };
}

export function updateOperations(state, time, telemetry, mode) {
  const elapsed = state.lastTime ? Math.min(0.12, Math.max(0, (time - state.lastTime) / 1000)) : 0.016;
  state.lastTime = time;
  const random = state.random;
  const interference = telemetry.interference ?? 0;
  const quality = telemetry.quality ?? 0;
  const signalId = telemetry.signal?.id ?? null;

  const alignmentTarget = clamp(85 + quality * 0.08 - interference * 4 + (random() - 0.5) * 2.2, 76, 98.8);
  const powerTarget = clamp(95 + quality * 0.03 - interference * 1.8 + (random() - 0.5) * 1.2, 88, 99.8);
  const temperatureTarget = -195.4 + interference * 2.7 + (random() - 0.5) * 0.45;
  const boostTarget = clamp(15 + quality * 0.13 + (random() - 0.5) * 2, 10, 31);
  state.alignment += (alignmentTarget - state.alignment) * elapsed * 0.55;
  state.power += (powerTarget - state.power) * elapsed * 0.45;
  state.temperature += (temperatureTarget - state.temperature) * elapsed * 0.35;
  state.boost += (boostTarget - state.boost) * elapsed * 0.7;
  state.clockDrift = clamp(state.clockDrift + (random() - 0.5) * elapsed * 0.03 + (quality > 55 ? -elapsed * 0.015 : elapsed * 0.012), -0.18, 0.32);

  if (signalId && telemetry.lockable && state.carrierSeen !== signalId) {
    state.carrierSeen = signalId;
    emit(state, {
      severity: 'signal',
      title: 'COHERENT CARRIER',
      message: `${signalId} is rising above the noise floor. Lock window is open.`,
      duration: 4600,
      signalId,
    }, time);
  } else if (!signalId || !telemetry.lockable) {
    state.carrierSeen = null;
  }

  if (interference > 0.72 && time > state.alertUntil - 900 && time - state.lastInterferenceEventAt > 5200) {
    state.lastInterferenceEventAt = time;
    emit(state, {
      severity: 'critical',
      title: 'RADIATION BURST',
      message: 'A transient particle event is contaminating the listening band.',
      duration: 3100,
    }, time);
  } else if (time >= state.nextEventAt) {
    emit(state, chooseAmbientEvent(random, state.currentEvent), time);
  }

  if (time > state.alertUntil && state.currentEvent.severity !== 'nominal') {
    state.currentEvent = EVENTS[0];
  }
  if (mode === 'decode' && state.currentEvent.severity === 'nominal' && time > state.nextEventAt - 2500) {
    state.currentEvent = { severity: 'info', title: 'DECODER LISTENING', message: 'Fragment reconstruction is sampling the locked carrier.', duration: 2400 };
    state.alertUntil = time + 2400;
  }
  return state;
}

export function getOperationsLog(event) {
  return {
    time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
    frequency: event.signalId ? 'CARRIER' : 'OPS EVENT',
    status: event.severity.toUpperCase(),
    id: event.signalId ?? event.title,
    title: event.title,
    message: event.message,
    operational: !event.signalId,
  };
}
