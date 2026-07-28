const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function updateIncidentEngine(observatory, deltaSeconds) {
  const { resources, receiver, array, environment, incidents } = observatory;
  incidents.cooldownSeconds = Math.max(0, incidents.cooldownSeconds - deltaSeconds);
  if (incidents.active && incidents.active.remainingSeconds > 0) {
    incidents.active.remainingSeconds -= deltaSeconds;
    if (incidents.active.remainingSeconds <= 0 && incidents.active.resolved) incidents.active = null;
  }
  if (incidents.cooldownSeconds > 0) return incidents;

  let next = null;
  if (resources.cryogenicReserve < 24 || resources.thermalLoad > 62) {
    next = {
      id: `INC-CRYO-${Math.floor(observatory.clock.elapsedMs / 1000)}`,
      type: 'CRYOGENIC_INSTABILITY',
      title: 'CRYOGENIC INSTABILITY',
      message: 'Receiver thermal noise is rising as the cryogenic reserve approaches its warning floor.',
      severity: 'warning',
      cause: 'Low cryogenic reserve or elevated thermal load',
      resolution: 'Flush the reserve loop and allow thermal load to settle below 48%.',
      remainingSeconds: 120,
      resolved: false,
    };
  } else if (environment.rfiLevel > 0.68) {
    next = {
      id: `INC-RFI-${Math.floor(observatory.clock.elapsedMs / 1000)}`,
      type: 'LOCAL_INTERFERENCE',
      title: 'LOCAL INTERFERENCE BURST',
      message: 'A terrestrial sideband is widening the receiver noise floor.',
      severity: 'critical',
      cause: 'Deterministic horizon-source interference window',
      resolution: 'Apply the RFI notch in Signal Lab or wait for the source to clear.',
      remainingSeconds: 46,
      resolved: false,
    };
  } else if (Math.abs(array.clockOffsetNs) > 18 || array.phaseError > 2.2) {
    next = {
      id: `INC-CLOCK-${Math.floor(observatory.clock.elapsedMs / 1000)}`,
      type: 'CLOCK_DISCIPLINE',
      title: 'CLOCK-DISCIPLINE FAULT',
      message: 'Baseline clock offsets are outside the coherent integration envelope.',
      severity: 'warning',
      cause: 'Accumulated phase and clock drift',
      resolution: 'Run baseline calibration from Live Ops.',
      remainingSeconds: 90,
      resolved: false,
    };
  }

  if (next) {
    incidents.active = next;
    incidents.history.unshift({ ...next, occurredAt: new Date(observatory.clock.utcMs).toISOString() });
    incidents.history = incidents.history.slice(0, 40);
    incidents.cooldownSeconds = 32;
  }
  receiver.rfiContribution = clamp(receiver.rfiContribution, 0, 24);
  return incidents;
}

export function resolveIncident(observatory, type) {
  const incident = observatory.incidents.active;
  if (!incident || incident.type !== type) return false;
  incident.resolved = true;
  incident.remainingSeconds = Math.min(incident.remainingSeconds, 4);
  return true;
}
