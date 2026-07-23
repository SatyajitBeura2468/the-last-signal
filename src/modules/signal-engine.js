import { CONFIG } from './config.js';

export const logFrequency = (mhz) => {
  const min = Math.log10(CONFIG.minFrequencyMHz);
  const max = Math.log10(CONFIG.maxFrequencyMHz);
  return (Math.log10(mhz) - min) / (max - min);
};

export const frequencyFromRatio = (ratio) => {
  const min = Math.log10(CONFIG.minFrequencyMHz);
  const max = Math.log10(CONFIG.maxFrequencyMHz);
  return 10 ** (min + Math.max(0, Math.min(1, ratio)) * (max - min));
};

export function formatFrequency(mhz) {
  if (mhz >= 1000) {
    const ghz = mhz / 1000;
    const [whole, fraction = ''] = ghz.toFixed(9).split('.');
    return `${whole}.${fraction.slice(0, 3)}.${fraction.slice(3, 6)}.${fraction.slice(6, 9)}`;
  }
  return mhz.toFixed(6);
}

export function findNearestSignal(frequencyMHz, signals) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const signal of signals) {
    const distance = Math.abs(logFrequency(signal.frequencyMHz) - logFrequency(frequencyMHz));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = signal;
    }
  }
  return { signal: nearest, distance: nearestDistance };
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function randomBetween(random, min, max) {
  return min + random() * (max - min);
}

function xorshift(seed) {
  let value = seed || 0x7f4a7c15;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return ((value >>> 0) / 4294967296);
  };
}

export function createRadioState(seed = Math.floor(Math.random() * 0xffffffff)) {
  return {
    random: xorshift(seed),
    lastTime: 0,
    noiseFloor: -106,
    noiseTarget: -106,
    interference: 0,
    carrierJitter: 0,
    scanCandidateSince: 0,
    scanCandidateId: null,
    sampleCount: 0,
  };
}

function signalDrift(signal, time) {
  const phase = signal.id.split('').reduce((total, character) => total + character.charCodeAt(0), 0);
  return Math.sin(time * 0.00019 + phase) * 0.00042 + Math.sin(time * 0.000071 + phase * 1.7) * 0.00018;
}

export function getSignalFrequency(signal, time = 0) {
  return signal.frequencyMHz * (1 + signalDrift(signal, time));
}

export function sampleTelemetry(frequencyMHz, signals, time, radio, options = {}) {
  const elapsed = radio.lastTime ? Math.min(0.08, Math.max(0, (time - radio.lastTime) / 1000)) : 0.016;
  radio.lastTime = time;
  radio.sampleCount += 1;
  const random = radio.random;

  if (radio.sampleCount % 16 === 0) {
    radio.noiseTarget = randomBetween(random, -111, -98);
    if (random() > 0.82) radio.interference = randomBetween(random, 0.2, 1);
  }
  radio.noiseFloor += (radio.noiseTarget - radio.noiseFloor) * elapsed * 0.9;
  radio.interference = Math.max(0, radio.interference - elapsed * 0.11);
  radio.carrierJitter += (random() - 0.5) * elapsed * 0.65;
  radio.carrierJitter *= 0.985;

  const nearest = findNearestSignal(frequencyMHz, signals);
  const signal = nearest.signal;
  const centerFrequency = signal ? getSignalFrequency(signal, time) : frequencyMHz;
  const distance = signal ? Math.abs(logFrequency(centerFrequency) - logFrequency(frequencyMHz)) : 1;
  const bandwidth = options.bandwidth ?? 0.014;
  const proximity = clamp(1 - distance / bandwidth, 0, 1);
  const carrierJitter = Math.abs(radio.carrierJitter);
  const atmosphericNoise = Math.sin(time * 0.0013) * 1.1 + Math.sin(time * 0.0037) * 0.55;
  const impulse = random() > 0.992 ? randomBetween(random, 5, 15) : 0;
  const coherentCarrier = signal ? clamp(proximity * (1 - carrierJitter * 0.8) * (0.82 + random() * 0.18), 0, 1) : 0;
  const strength = clamp(radio.noiseFloor + coherentCarrier * (signal ? 69 + signal.quality * 0.16 : 0) + atmosphericNoise + radio.interference * 6 + impulse, -120, -14);
  const quality = Math.round(clamp(4 + coherentCarrier * (signal?.quality ?? 50) - radio.interference * 12 + atmosphericNoise * 0.7 + (random() - 0.5) * 5, 1, 99));
  const stability = Math.round(clamp(8 + coherentCarrier * (signal?.stability ?? 55) - carrierJitter * 31 - radio.interference * 15 + (random() - 0.5) * 8, 2, 99));
  const coherence = clamp((quality / 100) * 0.6 + (stability / 100) * 0.4 - radio.interference * 0.08, 0, 1);
  const lockable = Boolean(signal && proximity > 0.78 && quality >= 42 && stability >= 38 && coherence >= 0.46);

  return {
    signal,
    distance,
    proximity,
    strength,
    quality,
    stability,
    coherence,
    lockable,
    noiseFloor: radio.noiseFloor,
    interference: radio.interference,
    bandwidth: signal && proximity > 0.5 ? 0.6 + (1 - quality / 100) * 2.4 : 0.5 + random() * 1.8,
    centerFrequency,
  };
}

export function deriveTelemetry(frequencyMHz, signals, time) {
  return sampleTelemetry(frequencyMHz, signals, time, createRadioState(0x4f1bbcdc));
}
