export function classifyFreshness(entry, now = Date.now()) {
  if (!entry?.sourceTimestamp) return entry?.status === 'SIMULATED' ? 'SIMULATED' : 'MISSING';
  const timestamp = Date.parse(entry.sourceTimestamp);
  if (!Number.isFinite(timestamp)) return 'INVALID';
  return now - timestamp > Number(entry.staleAfter ?? 0) ? 'STALE' : entry.status || 'LIVE';
}

export function validateRegistryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.source !== 'string' || typeof entry.status !== 'string') return null;
  const result = {
    source: entry.source.slice(0, 80),
    fetchedAt: typeof entry.fetchedAt === 'string' ? entry.fetchedAt : null,
    sourceTimestamp: typeof entry.sourceTimestamp === 'string' ? entry.sourceTimestamp : null,
    status: entry.status.slice(0, 30),
    staleAfter: Number.isFinite(entry.staleAfter) ? entry.staleAfter : 900000,
    value: entry.value && typeof entry.value === 'object' ? entry.value : null,
    fallbackReason: typeof entry.fallbackReason === 'string' ? entry.fallbackReason.slice(0, 240) : null,
  };
  result.freshness = classifyFreshness(result);
  return result;
}
