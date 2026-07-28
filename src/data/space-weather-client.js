import { validateRegistryEntry } from './source-registry.js';

export async function fetchSpaceWeather({ timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('/api/space-weather', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Space weather adapter returned ${response.status}`);
    const payload = await response.json();
    const registry = validateRegistryEntry(payload?.registry);
    if (!registry) throw new Error('Space weather registry payload was invalid');
    return { registry };
  } catch (error) {
    return {
      registry: {
        source: 'Deterministic observatory model',
        fetchedAt: new Date().toISOString(),
        sourceTimestamp: new Date().toISOString(),
        status: 'SIMULATED',
        staleAfter: 900000,
        value: {
          solarWindSpeed: 388,
          protonDensity: 4.2,
          imfMagnitude: 5.7,
          bz: -1.4,
          kpIndex: 2,
        },
        fallbackReason: error instanceof Error ? error.message : 'NOAA SWPC adapter unavailable',
        freshness: 'SIMULATED',
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
