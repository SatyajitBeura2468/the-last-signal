import { logFrequency } from './signal-engine.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function deterministicNoise(sample, frame, seed = 17) {
  const value = Math.sin(sample * 12.9898 + frame * 0.173 + seed * 0.9187) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function dprCap(quality) {
  if (quality === 'BATTERY' || quality === 'REDUCED_MOTION') return 1;
  if (quality === 'BALANCED') return 1.5;
  return 2;
}

function sizeCanvas(canvas, quality) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, dprCap(quality));
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height, ctx, ratio };
}

export class SpectrumRenderer {
  constructor({ frequencyCanvas, waterfallCanvas, stabilityCanvas, targetCanvas, noiseCanvas, alertCanvas }) {
    this.frequencyCanvas = frequencyCanvas;
    this.waterfallCanvas = waterfallCanvas;
    this.stabilityCanvas = stabilityCanvas;
    this.targetCanvas = targetCanvas;
    this.noiseCanvas = noiseCanvas;
    this.alertCanvas = alertCanvas;
    this.frame = 0;
    this.quality = 'HIGH';
    this.visible = new WeakMap();
    this.waterfallBuffer = document.createElement('canvas');
    this.waterfallRow = null;
    this.canvases = [frequencyCanvas, waterfallCanvas, stabilityCanvas, targetCanvas, noiseCanvas, alertCanvas].filter(Boolean);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) this.visible.set(entry.target, entry.isIntersecting);
    }, { rootMargin: '80px' });
    for (const canvas of this.canvases) {
      this.visible.set(canvas, true);
      this.resizeObserver.observe(canvas);
      this.intersectionObserver.observe(canvas);
    }
  }

  isVisible(canvas) {
    return this.visible.get(canvas) !== false;
  }

  resize() {
    for (const canvas of this.canvases) sizeCanvas(canvas, this.quality);
  }

  draw(state, time, quality = 'HIGH') {
    if (document.hidden) return;
    this.quality = quality;
    const lowPowerSkip = quality === 'BATTERY' && this.frame % 2 !== 0;
    if (!lowPowerSkip) {
      if (this.isVisible(this.frequencyCanvas)) this.drawFrequency(state, time);
      if (this.isVisible(this.waterfallCanvas)) this.drawWaterfall(state, time);
      if (this.isVisible(this.stabilityCanvas)) this.drawStability(state, time);
      if (this.isVisible(this.targetCanvas)) this.drawTarget(state, time);
      if (this.isVisible(this.noiseCanvas)) this.drawNoise(state, time);
      if (this.isVisible(this.alertCanvas)) this.drawAlert(state, time);
    }
    this.frame += 1;
  }

  drawFrequency(state, time) {
    const { width, height, ctx } = sizeCanvas(this.frequencyCanvas, this.quality);
    ctx.clearRect(0, 0, width, height);
    const middle = height * 0.55;
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'rgba(24,148,187,.6)');
    gradient.addColorStop(.47, 'rgba(79,238,220,.9)');
    gradient.addColorStop(.54, 'rgba(250,207,100,.92)');
    gradient.addColorStop(1, 'rgba(34,128,176,.58)');
    ctx.strokeStyle = gradient;
    ctx.shadowBlur = this.quality === 'HIGH' ? 8 : 2;
    ctx.shadowColor = 'rgba(38,226,255,.35)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    const step = this.quality === 'BATTERY' ? 4 : 2;
    for (let x = 0; x <= width; x += step) {
      const base = Math.sin(x * 0.23 + time * 0.002) * 1.1 + Math.sin(x * 0.041 - time * 0.001) * 1.7;
      let peak = 0;
      for (const signal of state.signals) {
        const sx = logFrequency(signal.frequencyMHz) * width;
        const distance = Math.abs(x - sx);
        peak += Math.exp(-(distance * distance) / 36) * (11 + signal.quality * 0.11);
      }
      const noise = deterministicNoise(x, this.frame, state.seed) * 3.25;
      const y = middle - peak + base + noise;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(67,161,191,.13)';
    for (let i = 0; i < 42; i += 1) {
      const x = (i / 41) * width;
      ctx.beginPath();
      ctx.moveTo(x, middle - (i % 5 === 0 ? 17 : 8));
      ctx.lineTo(x, middle + 17);
      ctx.stroke();
    }
  }

  ensureWaterfallBuffer(width, height) {
    const bufferWidth = Math.max(1, Math.round(width));
    const bufferHeight = Math.max(1, Math.round(height));
    if (this.waterfallBuffer.width !== bufferWidth || this.waterfallBuffer.height !== bufferHeight) {
      this.waterfallBuffer.width = bufferWidth;
      this.waterfallBuffer.height = bufferHeight;
      this.waterfallRow = this.waterfallBuffer.getContext('2d').createImageData(bufferWidth, 1);
    }
  }

  drawWaterfall(state, time) {
    const { width, height, ctx } = sizeCanvas(this.waterfallCanvas, this.quality);
    const topHeight = height * 0.39;
    ctx.fillStyle = 'rgba(1,9,15,.35)';
    ctx.fillRect(0, 0, width, topHeight);
    ctx.strokeStyle = 'rgba(48,220,224,.76)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const lineStep = this.quality === 'BATTERY' ? 4 : 2;
    for (let x = 0; x <= width; x += lineStep) {
      const base = topHeight * .72
        + Math.sin(x * .12 + time * .002) * 4
        + deterministicNoise(x, this.frame, state.seed + 5) * 7.5;
      const centered = Math.exp(-((x - width * .48) ** 2) / 65) * state.telemetry.proximity * 65;
      const y = Math.max(8, base - centered);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const waterfallY = Math.round(topHeight + 2);
    const waterfallHeight = Math.max(1, Math.round(height - waterfallY));
    this.ensureWaterfallBuffer(width, waterfallHeight);
    const bufferContext = this.waterfallBuffer.getContext('2d');
    bufferContext.drawImage(
      this.waterfallBuffer,
      0,
      0,
      this.waterfallBuffer.width,
      this.waterfallBuffer.height - 1,
      0,
      1,
      this.waterfallBuffer.width,
      this.waterfallBuffer.height - 1,
    );
    const row = this.waterfallRow.data;
    for (let x = 0; x < this.waterfallBuffer.width; x += 1) {
      const hotspot = Math.exp(-((x - this.waterfallBuffer.width * .48) ** 2) / 48) * state.telemetry.proximity;
      const noise = (deterministicNoise(x, this.frame, state.seed + 11) + 1) / 2;
      const index = x * 4;
      row[index] = Math.min(255, 4 + hotspot * 245 + noise * 9);
      row[index + 1] = Math.min(255, 44 + hotspot * 200 + noise * 35);
      row[index + 2] = Math.min(255, 90 + hotspot * 70 + noise * 75);
      row[index + 3] = Math.min(255, 70 + hotspot * 185 + noise * 42);
    }
    bufferContext.putImageData(this.waterfallRow, 0, 0);
    ctx.drawImage(this.waterfallBuffer, 0, waterfallY, width, waterfallHeight);
  }

  drawStability(state, time) {
    const { width, height, ctx } = sizeCanvas(this.stabilityCanvas, this.quality);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(32,225,183,.74)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 3) {
      const y = height / 2
        + Math.sin(x * .16 + time * .003) * 4
        + deterministicNoise(x, this.frame, state.seed + 19) * (6 - state.telemetry.stability * .04);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawTarget(state, time) {
    const { width, height, ctx } = sizeCanvas(this.targetCanvas, this.quality);
    ctx.clearRect(0, 0, width, height);
    const cx = width * .5;
    const cy = height * .5;
    ctx.strokeStyle = 'rgba(215,151,54,.25)';
    ctx.lineWidth = .8;
    for (let radius = 24; radius < Math.min(width, height) * .55; radius += 24) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * width, cy + Math.sin(angle) * height);
      ctx.stroke();
    }
    const starCount = this.quality === 'BATTERY' ? 18 : 36;
    for (let index = 0; index < starCount; index += 1) {
      const px = ((Math.sin(index * 18.23) * 43758.5453 % 1 + 1) % 1 * .9 + .05) * width;
      const py = ((Math.sin(index * 7.12) * 43758.5453 % 1 + 1) % 1 * .9 + .05) * height;
      ctx.fillStyle = index % 7 === 0 ? 'rgba(255,181,72,.82)' : 'rgba(136,198,224,.56)';
      ctx.fillRect(px, py, index % 7 === 0 ? 2 : 1, index % 7 === 0 ? 2 : 1);
    }
    const pulse = this.quality === 'REDUCED_MOTION' ? 9 : 9 + Math.sin(time * .004) * 3;
    ctx.shadowColor = 'rgba(255,177,54,.9)';
    ctx.shadowBlur = this.quality === 'HIGH' ? 16 : 3;
    ctx.strokeStyle = 'rgba(255,183,66,.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,216,133,.98)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawNoise(state, time) {
    const { width, height, ctx } = sizeCanvas(this.noiseCanvas, this.quality);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(99,191,235,.62)';
    ctx.lineWidth = .8;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const burst = state.telemetry.interference * Math.sin(x * 1.2 + time * .007) * 5;
      const y = height / 2
        + Math.sin(x * .31 + time * .003) * 3
        + burst
        + deterministicNoise(x, this.frame, state.seed + 23) * (4 + state.telemetry.interference * 7);
      if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawAlert(state, time) {
    const { width, height, ctx } = sizeCanvas(this.alertCanvas, this.quality);
    ctx.clearRect(0, 0, width, height);
    const severity = state.operations?.currentEvent?.severity;
    const color = severity === 'critical' ? '255,65,51' : severity === 'signal' ? '255,190,74' : severity === 'info' ? '75,211,241' : '52,222,189';
    const amplitude = severity === 'critical' ? 8 : severity === 'signal' ? 5.5 : severity === 'info' ? 3.5 : 2.2;
    ctx.strokeStyle = `rgba(${color},.86)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const spike = state.telemetry.interference > .25 && x > width * .48 && x < width * .74
        ? Math.sin(x * 1.6 + time * .012) * amplitude
        : 0;
      const y = height / 2
        + Math.sin(x * .09 + time * .004) * amplitude * .32
        + spike
        + deterministicNoise(x, this.frame, state.seed + 29) * amplitude * .12;
      if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
  }
}
