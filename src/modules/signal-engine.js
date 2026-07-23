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

export function deriveTelemetry(frequencyMHz, signals, time) {
  const { signal, distance } = findNearestSignal(frequencyMHz, signals);
  const proximity = Math.max(0, 1 - distance / 0.08);
  const oscillation = Math.sin(time * 0.0032) * 2.2 + Math.sin(time * 0.0011) * 1.4;
  const strength = Math.min(-18, -112 + proximity * 78 + oscillation);
  const quality = Math.max(2, Math.min(99, Math.round(proximity * (signal?.quality ?? 72) + 5 + oscillation)));
  const stability = Math.max(4, Math.min(99, Math.round(proximity * (signal?.stability ?? 78) + 8 + Math.sin(time * 0.002) * 4)));
  return { signal, distance, proximity, strength, quality, stability };
}
