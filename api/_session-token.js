import crypto from 'node:crypto';

const FALLBACK_SECRET = 'the-last-signal-local-signed-simulation-v2';
const SECRET = process.env.SESSION_SIGNING_SECRET || FALLBACK_SECRET;
export const PERSISTENCE_MODE = process.env.SESSION_SIGNING_SECRET
  ? 'SIGNED_STATELESS_PRODUCTION'
  : 'LOCAL_SIGNED_SIMULATION';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const signature = (encoded) => crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');

export function issueToken(payload) {
  const encoded = encode(payload);
  return `${encoded}.${signature(encoded)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 8192) return null;
  const [encoded, provided] = token.split('.');
  if (!encoded || !provided) return null;
  const expected = signature(encoded);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload || payload.version !== 2 || typeof payload.sessionId !== 'string') return null;
    if (Number(payload.expiresAt) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionPayload(sessionId) {
  return {
    version: 2,
    sessionId,
    decodeStages: {},
    committedSignalIds: [],
    issuedAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
}
