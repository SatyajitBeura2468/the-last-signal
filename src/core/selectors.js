export const selectActiveCommand = (state) => (
  state.observatory.commands.find((command) => command.status === 'RUNNING' || command.status === 'QUEUED') ?? null
);

export const selectDecodeEvidence = (state) => {
  const mission = state.observatory.mission;
  return {
    locked: Boolean(state.lockedSignal),
    observed: mission.integrationSeconds >= mission.requiredIntegrationSeconds,
    corrected: mission.correctionsApplied >= 2,
    correlated: mission.correlation >= 55,
    revisit: mission.revisitConfirmed,
    committed: mission.evidenceCommitted,
  };
};

export const selectDecodeReady = (state) => Object.values(selectDecodeEvidence(state)).every(Boolean);

export const selectEnvironmentalProvenance = (state) => (
  Object.values(state.observatory.sources).map((entry) => ({
    source: entry.source,
    status: entry.status,
    sourceTimestamp: entry.sourceTimestamp,
    fetchedAt: entry.fetchedAt,
    fallbackReason: entry.fallbackReason,
  }))
);
