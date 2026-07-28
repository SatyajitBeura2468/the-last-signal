export function detectRenderQuality(settings = {}) {
  if (settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) return 'REDUCED_MOTION';
  if (settings.renderQuality && settings.renderQuality !== 'AUTO') return settings.renderQuality;
  const narrow = matchMedia('(max-width: 700px)').matches;
  const memory = navigator.deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (narrow && (memory <= 4 || cores <= 4)) return 'BATTERY';
  if (narrow || memory <= 4) return 'BALANCED';
  return 'HIGH';
}

export function createRenderScheduler(settings = {}) {
  const tasks = new Map();
  let frameId = 0;
  let running = false;
  let lastFrame = 0;
  let quality = detectRenderQuality(settings);

  const targetInterval = () => quality === 'HIGH' ? 1000 / 60 : quality === 'REDUCED_MOTION' ? 1000 : 1000 / 30;
  const loop = (time) => {
    if (!running) return;
    const interval = targetInterval();
    if (time - lastFrame >= interval - 1) {
      const delta = Math.min(250, time - lastFrame || interval);
      lastFrame = time;
      for (const task of tasks.values()) {
        if (task.enabled !== false) task.callback(time, delta, quality);
      }
    }
    frameId = requestAnimationFrame(loop);
  };

  return {
    add(id, callback) {
      tasks.set(id, { callback, enabled: true });
      return () => tasks.delete(id);
    },
    setEnabled(id, enabled) {
      const task = tasks.get(id);
      if (task) task.enabled = Boolean(enabled);
    },
    setQuality(next) {
      quality = next;
      lastFrame = 0;
    },
    getQuality() {
      return quality;
    },
    start() {
      if (running) return;
      running = true;
      lastFrame = 0;
      frameId = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frameId);
    },
  };
}
