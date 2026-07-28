import { issueToken, PERSISTENCE_MODE, verifyToken } from './_session-token.js';

const SIGNALS = {
  'TLS-4217812651': [
    '... we watched as the cycle completed ...',
    '... the stars die and are reborn ...',
    '... the signal is a seed ...',
    '... not a message ... a promise ...',
    '... if you are listening, continue ...',
    '... you are not the first ...',
    '... we wait beyond the last ...',
  ],
  'TLS-1582049930': [
    '... carrier repeats every 113 seconds ...',
    '... origin obscured by local hydrogen ...',
  ],
  'TLS-7123284400': [
    '... narrow pulse train detected ...',
    '... sequence may encode prime intervals ...',
  ],
};

const REQUIRED_EVIDENCE = ['locked', 'observed', 'corrected', 'correlated', 'revisit', 'committed'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { signalId, sessionId, token, evidence } = req.body || {};
  const payload = verifyToken(token);
  if (!payload || payload.sessionId !== sessionId) return res.status(401).json({ error: 'Invalid or expired session token' });
  if (!SIGNALS[signalId]) return res.status(400).json({ error: 'Unknown decode target' });
  if (!evidence || REQUIRED_EVIDENCE.some((key) => evidence[key] !== true)) {
    return res.status(409).json({
      error: 'Observation evidence incomplete',
      required: REQUIRED_EVIDENCE,
      received: REQUIRED_EVIDENCE.filter((key) => evidence?.[key] === true),
    });
  }

  const fragments = SIGNALS[signalId];
  const previousStage = Number(payload.decodeStages[signalId] ?? 0);
  const nextStage = Math.min(fragments.length, previousStage + 1);
  payload.decodeStages[signalId] = nextStage;
  payload.committedSignalIds = [...new Set([...payload.committedSignalIds, signalId])];
  payload.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  await new Promise((resolve) => setTimeout(resolve, 80));
  return res.status(200).json({
    signalId,
    stage: nextStage,
    totalStages: fragments.length,
    progress: Math.round((nextStage / fragments.length) * 100),
    fragment: nextStage > previousStage ? fragments[nextStage - 1] : null,
    completed: nextStage >= fragments.length,
    token: issueToken(payload),
    source: 'SIGNED_STATELESS_VALIDATION',
    persistenceMode: PERSISTENCE_MODE,
  });
}
