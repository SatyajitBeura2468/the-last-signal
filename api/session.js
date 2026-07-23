import crypto from 'node:crypto';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { sessionId, unlockedSignalIds = [], logs = [] } = req.body || {};
  if (typeof sessionId !== 'string' || sessionId.length > 100 || !Array.isArray(unlockedSignalIds) || !Array.isArray(logs)) {
    return res.status(400).json({ error: 'Invalid session payload' });
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify({ sessionId, unlockedSignalIds, logCount: logs.length })).digest('hex').slice(0, 16);
  return res.status(202).json({ accepted: true, digest, recordedAt: new Date().toISOString() });
}
