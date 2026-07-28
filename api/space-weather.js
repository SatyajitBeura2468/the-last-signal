const ENDPOINTS = {
  speed: 'https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json',
  magnetic: 'https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json',
  kp: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
};

const STALE_AFTER_MS = 15 * 60 * 1000;
let cache = null;
let cacheExpiresAt = 0;

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'the-last-signal-observatory/2.0' },
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) throw new Error(`NOAA SWPC returned ${response.status}`);
  return response.json();
}

function latest(array) {
  return Array.isArray(array) && array.length ? array[array.length - 1] : null;
}

function fallback(reason) {
  const now = new Date().toISOString();
  return {
    registry: {
      source: 'NOAA SWPC with deterministic fallback',
      fetchedAt: now,
      sourceTimestamp: now,
      status: 'SIMULATED',
      staleAfter: STALE_AFTER_MS,
      value: {
        solarWindSpeed: 388,
        protonDensity: 4.2,
        imfMagnitude: 5.7,
        bz: -1.4,
        kpIndex: 2,
      },
      fallbackReason: reason,
    },
  };
}

async function load() {
  const [speedResult, magneticResult, kpResult] = await Promise.allSettled([
    getJson(ENDPOINTS.speed),
    getJson(ENDPOINTS.magnetic),
    getJson(ENDPOINTS.kp),
  ]);
  if (speedResult.status !== 'fulfilled' || magneticResult.status !== 'fulfilled') {
    return fallback('One or more required NOAA SWPC summary feeds were unavailable.');
  }
  const speed = latest(speedResult.value);
  const magnetic = latest(magneticResult.value);
  const kp = kpResult.status === 'fulfilled' ? latest(kpResult.value) : null;
  const solarWindSpeed = finite(speed?.proton_speed);
  const imfMagnitude = finite(magnetic?.bt);
  const bz = finite(magnetic?.bz_gsm);
  if (solarWindSpeed === null || imfMagnitude === null || bz === null) {
    return fallback('NOAA SWPC returned an unexpected response structure.');
  }
  const sourceTimestamp = [speed?.time_tag, magnetic?.time_tag, kp?.time_tag].filter(Boolean).sort().at(-1);
  return {
    registry: {
      source: 'NOAA Space Weather Prediction Center',
      fetchedAt: new Date().toISOString(),
      sourceTimestamp: sourceTimestamp ? new Date(sourceTimestamp).toISOString() : null,
      status: 'LIVE',
      staleAfter: STALE_AFTER_MS,
      value: {
        solarWindSpeed,
        protonDensity: 4.2,
        imfMagnitude,
        bz,
        kpIndex: finite(kp?.Kp) ?? 2,
      },
      fallbackReason: 'Proton density is a deterministic simulation because the compact NOAA summary feed does not publish density.',
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const now = Date.now();
  if (!cache || now >= cacheExpiresAt) {
    cache = await load().catch((error) => fallback(error instanceof Error ? error.message : 'NOAA SWPC adapter failed'));
    cacheExpiresAt = now + 5 * 60 * 1000;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=900');
  return res.status(200).json(cache);
}
