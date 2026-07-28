import crypto from 'node:crypto';
import { createSessionPayload, issueToken, PERSISTENCE_MODE, verifyToken } from './_session-token.js';

const SESSION_PATTERN = /^TLS-[A-F0-9]{16}$/;
const SIGNAL_PATTERN = /^(TLS|CND)-[A-Z0-9-]{3,32}$/;

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { action = 'sync', sessionId, token, evidence = [], logs = [] } = req.body || {};
  if (typeof sessionId !== 'string' || !SESSION_PATTERN.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session identifier' });
  }

  if (action === 'start') {
    const payload = createSessionPayload(sessionId);
    return res.status(201).json({
      accepted: true,
      token: issueToken(payload),
      persistenceMode: PERSISTENCE_MODE,
      expiresAt: new Date(payload.expiresAt).toISOString(),
    });
  }

  const payload = verifyToken(token);
  if (!payload || payload.sessionId !== sessionId) return res.status(401).json({ error: 'Invalid or expired session token' });
  const committed = Array.isArray(evidence)
    ? evidence.filter((id) => typeof id === 'string' && SIGNAL_PATTERN.test(id)).slice(0, 30)
    : [];
  payload.committedSignalIds = [...new Set([...payload.committedSignalIds, ...committed])].slice(0, 30);
  payload.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    sessionId,
    committed: payload.committedSignalIds,
    logCount: Array.isArray(logs) ? Math.min(logs.length, 40) : 0,
  })).digest('hex').slice(0, 16);
  return res.status(202).json({
    accepted: true,
    digest,
    token: issueToken(payload),
    persistenceMode: PERSISTENCE_MODE,
    recordedAt: new Date().toISOString(),
  });
}
