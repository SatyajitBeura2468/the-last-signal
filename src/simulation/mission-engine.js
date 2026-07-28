const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const COMMAND_DEFINITIONS = {
  SLEW_TARGET: { duration: 5.5, label: 'SLEW TO TARGET' },
  START_OBSERVATION: { duration: 2.4, label: 'START OBSERVATION' },
  CALIBRATE_BASELINES: { duration: 4.2, label: 'CALIBRATE BASELINES' },
  FLUSH_CRYO: { duration: 3.4, label: 'FLUSH CRYOGENIC LOOP' },
  REROUTE_POWER: { duration: 2.8, label: 'REROUTE RECEIVER POWER' },
  PARK_DISH: { duration: 4, label: 'PARK SELECTED DISH' },
  APPLY_RFI: { duration: 2.1, label: 'APPLY RFI NOTCH' },
  APPLY_DOPPLER: { duration: 2.7, label: 'APPLY BARYCENTRIC CORRECTION' },
  APPLY_PHASE: { duration: 3.2, label: 'SOLVE MULTI-BASELINE PHASE' },
  APPLY_FOLD: { duration: 3.6, label: 'FOLD PERIODIC SAMPLES' },
  RUN_CORRELATION: { duration: 4.8, label: 'RUN CATALOGUE CORRELATION' },
  SCHEDULE_REVISIT: { duration: 1.8, label: 'SCHEDULE REVISIT' },
  CONFIRM_REVISIT: { duration: 5.2, label: 'CONFIRM REVISIT WINDOW' },
  COMMIT_EVIDENCE: { duration: 2.6, label: 'COMMIT EVIDENCE' },
  FULL_DIAGNOSTIC: { duration: 6.5, label: 'FULL ARRAY DIAGNOSTIC' },
};

export function queueCommand(observatory, type, payload = {}) {
  const definition = COMMAND_DEFINITIONS[type];
  if (!definition) return { accepted: false, reason: 'UNKNOWN_COMMAND' };
  if (type === 'COMMIT_EVIDENCE' && observatory.mission.evidenceCommitted) {
    return { accepted: false, reason: 'ALREADY_COMMITTED' };
  }
  if (observatory.commands.some((command) => ['QUEUED', 'RUNNING'].includes(command.status) && command.type === type)) {
    return { accepted: false, reason: 'ALREADY_RUNNING' };
  }
  const command = {
    id: `CMD-${String(observatory.commandSequence += 1).padStart(4, '0')}`,
    type,
    label: definition.label,
    payload,
    status: 'QUEUED',
    progress: 0,
    durationSeconds: definition.duration,
    elapsedSeconds: 0,
    queuedAt: new Date(observatory.clock.utcMs).toISOString(),
  };
  observatory.commands.push(command);
  observatory.eventLog.unshift({
    time: new Date(observatory.clock.utcMs).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' }),
    severity: 'info',
    title: 'COMMAND QUEUED',
    message: `${command.label} entered the observatory command bus.`,
  });
  return { accepted: true, command };
}

function completeCommand(observatory, command) {
  const { mission, resources, array, lab, navigation, vault } = observatory;
  const type = command.type;
  if (type === 'SLEW_TARGET') mission.stage = 'SLEWING';
  if (type === 'START_OBSERVATION') mission.stage = 'OBSERVING';
  if (type === 'CALIBRATE_BASELINES') {
    for (const dish of array.dishes) {
      dish.phaseOffset *= 0.28;
      dish.clockOffset *= 0.35;
    }
    array.phaseError *= 0.34;
    array.clockOffsetNs *= 0.35;
    if (observatory.incidents.active?.type === 'CLOCK_DISCIPLINE') observatory.incidents.active.resolved = true;
  }
  if (type === 'FLUSH_CRYO') {
    resources.cryogenicReserve = clamp(resources.cryogenicReserve - 8, 5, 100);
    resources.thermalLoad = clamp(resources.thermalLoad - 24, 8, 100);
    if (observatory.incidents.active?.type === 'CRYOGENIC_INSTABILITY') observatory.incidents.active.resolved = true;
  }
  if (type === 'REROUTE_POWER') {
    resources.reservePower = clamp(resources.reservePower - 6, 5, 100);
    resources.mainPower = clamp(resources.mainPower + 9, 0, 100);
  }
  if (type === 'PARK_DISH') {
    const dish = array.dishes.find((item) => item.id === command.payload.dishId);
    if (dish) {
      dish.currentElevation = Math.max(8, dish.currentElevation - 18);
      dish.targetElevation = 8;
      dish.availability = 'PARKED';
      dish.excluded = true;
    }
  }
  if (type.startsWith('APPLY_')) {
    const filter = {
      APPLY_RFI: 'rfi',
      APPLY_DOPPLER: 'doppler',
      APPLY_PHASE: 'phase',
      APPLY_FOLD: 'fold',
    }[type];
    if (filter && !lab.filters[filter]) {
      lab.filters[filter] = true;
      mission.correctionsApplied += 1;
    }
    if (filter === 'rfi' && observatory.incidents.active?.type === 'LOCAL_INTERFERENCE') {
      observatory.incidents.active.resolved = true;
      observatory.environment.rfiLevel *= 0.25;
    }
  }
  if (type === 'RUN_CORRELATION') {
    mission.correlation = clamp(31 + mission.correctionsApplied * 15 + mission.sampleCount * 4, 0, 96);
    lab.correlation = mission.correlation;
  }
  if (type === 'SCHEDULE_REVISIT') {
    mission.revisitScheduled = true;
    if (!navigation.scheduled.some((item) => item.id === observatory.activeTarget.id)) {
      navigation.scheduled.push({
        id: observatory.activeTarget.id,
        name: observatory.activeTarget.name,
        baseline: navigation.baseline,
        window: observatory.astronomy.windowLabel,
        time: new Date(observatory.clock.utcMs).toISOString(),
      });
    }
  }
  if (type === 'CONFIRM_REVISIT') {
    if (mission.revisitScheduled) mission.sampleCount = Math.max(2, mission.sampleCount + 1);
    mission.revisitConfirmed = mission.revisitScheduled && mission.sampleCount >= 2;
  }
  if (type === 'COMMIT_EVIDENCE' && mission.correlation >= 55 && mission.revisitConfirmed) {
    mission.evidenceCommitted = true;
    const entry = {
      id: `EVD-${command.id.replace('CMD-', '')}`,
      title: `${mission.candidateId ?? 'CANDIDATE'} OBSERVATION COMMIT`,
      detail: `${mission.sampleCount} samples / ${mission.correctionsApplied} corrections / ${mission.correlation}% correlation`,
      type: 'OBSERVATION',
      time: new Date(observatory.clock.utcMs).toISOString(),
    };
    vault.entries.unshift(entry);
  }
  if (type === 'FULL_DIAGNOSTIC') {
    array.integrity = clamp(array.integrity + 0.6, 0, 99.8);
  }
  command.status = 'COMPLETE';
  command.completedAt = new Date(observatory.clock.utcMs).toISOString();
  observatory.eventLog.unshift({
    time: new Date(observatory.clock.utcMs).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' }),
    severity: type === 'COMMIT_EVIDENCE' ? 'signal' : 'nominal',
    title: 'COMMAND COMPLETE',
    message: `${command.label} completed and propagated through the observatory state.`,
  });
}

export function updateMissionEngine(observatory, deltaSeconds) {
  const running = observatory.commands.find((command) => command.status === 'RUNNING');
  const next = running ?? observatory.commands.find((command) => command.status === 'QUEUED');
  if (next) {
    if (next.status === 'QUEUED') {
      next.status = 'RUNNING';
      next.startedAt = new Date(observatory.clock.utcMs).toISOString();
    }
    next.elapsedSeconds += deltaSeconds;
    next.progress = clamp(next.elapsedSeconds / next.durationSeconds, 0, 1);
    if (next.progress >= 1) completeCommand(observatory, next);
  }

  observatory.commands = observatory.commands.slice(-24);
  const mission = observatory.mission;
  if (mission.stage === 'SLEWING' && observatory.array.slewProgress > 0.96) mission.stage = 'READY';
  if (mission.stage === 'OBSERVING') {
    const integrationFactor = observatory.receiver.lockState === 'LOCKABLE'
      ? Math.max(0.18, observatory.receiver.coherence)
      : 0.12;
    mission.integrationSeconds += deltaSeconds * integrationFactor;
    if (mission.integrationSeconds >= mission.requiredIntegrationSeconds) {
      mission.stage = 'CANDIDATE';
      mission.sampleCount = Math.max(1, mission.sampleCount);
      mission.candidateId = observatory.activeTarget.signalId;
    }
  }
  return mission;
}
