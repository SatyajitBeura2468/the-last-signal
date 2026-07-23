import crypto from 'node:crypto';

const BASE = [
  { id: 'TLS-4217812651', frequencyMHz: 4217.812651, strength: -37.2, quality: 78, stability: 92, ra: '19h 42m 11.6s', dec: '−02° 35′ 47.3″', distance: 14218, className: 'T7N', fragments: ['... we watched as the cycle completed ...', '... the stars die and are reborn ...', '... the signal is a seed ...', '... not a message ... a promise ...', '... if you are listening, continue ...', '... you are not the first ...', '... we wait beyond the last ...'] },
  { id: 'TLS-1582049930', frequencyMHz: 1582.04993, strength: -62.8, quality: 56, stability: 63, ra: '04h 18m 42.1s', dec: '+19° 07′ 02.8″', distance: 906, className: 'HYD', fragments: ['... carrier repeats every 113 seconds ...', '... origin obscured by local hydrogen ...'] },
  { id: 'TLS-7123284400', frequencyMHz: 7123.2844, strength: -71.1, quality: 44, stability: 51, ra: '22h 07m 05.4s', dec: '−41° 52′ 16.1″', distance: 3191, className: 'NRW', fragments: ['... narrow pulse train detected ...', '... sequence may encode prime intervals ...'] },
];

function checksum(session, value) {
  return crypto.createHash('sha256').update(`${session}:${value}`).digest('hex').slice(0, 10).toUpperCase();
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = String(req.query?.session || 'anonymous').slice(0, 80);
  const signals = BASE.map((signal) => ({ ...signal, checksum: checksum(session, signal.id) }));
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).json({ generatedAt: new Date().toISOString(), session, signals });
}
