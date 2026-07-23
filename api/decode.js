const SIGNALS = {
  'TLS-4217812651': ['... we watched as the cycle completed ...', '... the stars die and are reborn ...', '... the signal is a seed ...', '... not a message ... a promise ...', '... if you are listening, continue ...', '... you are not the first ...', '... we wait beyond the last ...'],
  'TLS-1582049930': ['... carrier repeats every 113 seconds ...', '... origin obscured by local hydrogen ...'],
  'TLS-7123284400': ['... narrow pulse train detected ...', '... sequence may encode prime intervals ...'],
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { signalId, progress, sessionId } = req.body || {};
  if (!SIGNALS[signalId] || typeof progress !== 'number' || !sessionId) return res.status(400).json({ error: 'Invalid decode request' });
  const safeProgress = Math.max(0, Math.min(100, progress));
  const fragments = SIGNALS[signalId];
  const index = Math.min(fragments.length - 1, Math.floor((safeProgress / 100) * fragments.length));
  await new Promise((resolve) => setTimeout(resolve, 80));
  return res.status(200).json({ signalId, progress: safeProgress, fragment: fragments[index], completed: safeProgress >= 100, source: 'server' });
}
