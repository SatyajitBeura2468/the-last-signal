export function createSimulationClock({ now = Date.now(), speed = 1 } = {}) {
  return {
    epochMs: now,
    utcMs: now,
    elapsedMs: 0,
    speed,
    paused: false,
    lastRealMs: null,
  };
}

export function tickSimulationClock(clock, realNowMs) {
  if (!Number.isFinite(realNowMs)) return clock;
  if (clock.lastRealMs === null) {
    clock.lastRealMs = realNowMs;
    return clock;
  }
  const delta = Math.max(0, Math.min(250, realNowMs - clock.lastRealMs));
  clock.lastRealMs = realNowMs;
  if (!clock.paused) {
    const simulatedDelta = delta * clock.speed;
    clock.elapsedMs += simulatedDelta;
    clock.utcMs = clock.epochMs + clock.elapsedMs;
  }
  return clock;
}

export function setClockPaused(clock, paused) {
  clock.paused = Boolean(paused);
  clock.lastRealMs = null;
}
