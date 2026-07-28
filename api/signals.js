import crypto from 'node:crypto';
import { UNIFIED_SIGNAL_CATALOG, publicSignalRecord } from '../src/simulation/signal-model.js';

function checksum(session, value) {
  return crypto.createHash('sha256').update(`${session}:${value}`).digest('hex').slice(0, 10).toUpperCase();
}

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = String(req.query?.session || 'anonymous').replace(/[^A-Za-z0-9-]/g, '').slice(0, 80);
  const signals = UNIFIED_SIGNAL_CATALOG.map((signal) => ({
    ...publicSignalRecord(signal),
    checksum: checksum(session, signal.id),
  }));
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    session,
    source: 'DETERMINISTIC_SIMULATION_CATALOGUE',
    signals,
  });
}
