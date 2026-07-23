import { logFrequency } from './signal-engine.js';

function sizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  return { width, height, ctx: canvas.getContext('2d') };
}

export class SpectrumRenderer {
  constructor({ frequencyCanvas, waterfallCanvas, stabilityCanvas, targetCanvas, noiseCanvas, alertCanvas }) {
    this.frequencyCanvas = frequencyCanvas;
    this.waterfallCanvas = waterfallCanvas;
    this.stabilityCanvas = stabilityCanvas;
    this.targetCanvas = targetCanvas;
    this.noiseCanvas = noiseCanvas;
    this.alertCanvas = alertCanvas;
    this.history = [];
    this.frame = 0;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
  }

  resize() {
    [this.frequencyCanvas, this.waterfallCanvas, this.stabilityCanvas, this.targetCanvas, this.noiseCanvas, this.alertCanvas]
      .forEach((canvas) => canvas && sizeCanvas(canvas));
  }

  draw(state, time) {
    this.drawFrequency(state, time);
    this.drawWaterfall(state, time);
    this.drawStability(state, time);
    this.drawTarget(state, time);
    this.drawNoise(state, time);
    this.drawAlert(time);
    this.frame += 1;
  }

  drawFrequency(state, time) {
    const { width, height, ctx } = sizeCanvas(this.frequencyCanvas);
    ctx.clearRect(0, 0, width, height);
    const middle = height * 0.55;
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'rgba(24,148,187,.6)');
    gradient.addColorStop(.47, 'rgba(79,238,220,.9)');
    gradient.addColorStop(.54, 'rgba(250,207,100,.92)');
    gradient.addColorStop(1, 'rgba(34,128,176,.58)');
    ctx.strokeStyle = gradient;
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(38,226,255,.35)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const base = Math.sin(x * 0.23 + time * 0.002) * 1.1 + Math.sin(x * 0.041 - time * 0.001) * 1.7;
      let peak = 0;
      for (const signal of state.signals) {
        const sx = logFrequency(signal.frequencyMHz) * width;
        const d = Math.abs(x - sx);
        peak += Math.exp(-(d * d) / 36) * (11 + signal.quality * 0.11);
      }
      const noise = (Math.random() - .5) * 6.5;
      const y = middle - peak + base + noise;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(67,161,191,.13)';
    for (let i = 0; i < 42; i += 1) {
      const x = (i / 41) * width;
      ctx.beginPath(); ctx.moveTo(x, middle - (i % 5 === 0 ? 17 : 8)); ctx.lineTo(x, middle + 17); ctx.stroke();
    }
  }

  drawWaterfall(state, time) {
    const { width, height, ctx } = sizeCanvas(this.waterfallCanvas);
    const topHeight = height * .39;
    ctx.fillStyle = 'rgba(1,9,15,.2)';
    ctx.fillRect(0, 0, width, topHeight);
    ctx.strokeStyle = 'rgba(48,220,224,.76)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const base = topHeight * .72 + Math.sin(x * .12 + time * .002) * 4 + (Math.random() - .5) * 15;
      const centered = Math.exp(-((x - width * .48) ** 2) / 65) * state.telemetry.proximity * 65;
      const y = Math.max(8, base - centered);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const waterfallY = topHeight + 2;
    const waterfallHeight = height - waterfallY;
    const image = ctx.getImageData(0, waterfallY, width, Math.max(1, waterfallHeight - 1));
    ctx.putImageData(image, 0, waterfallY + 1);
    const row = ctx.createImageData(width, 1);
    for (let x = 0; x < width; x += 1) {
      const hotspot = Math.exp(-((x - width * .48) ** 2) / 48) * state.telemetry.proximity;
      const noise = Math.random();
      const index = x * 4;
      row.data[index] = Math.min(255, 4 + hotspot * 245 + noise * 9);
      row.data[index + 1] = Math.min(255, 44 + hotspot * 200 + noise * 35);
      row.data[index + 2] = Math.min(255, 90 + hotspot * 70 + noise * 75);
      row.data[index + 3] = Math.min(255, 70 + hotspot * 185 + noise * 42);
    }
    ctx.putImageData(row, 0, waterfallY);
  }

  drawStability(state, time) {
    const { width, height, ctx } = sizeCanvas(this.stabilityCanvas);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(32,225,183,.74)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 3) {
      const y = height / 2 + Math.sin(x * .16 + time * .003) * 4 + (Math.random() - .5) * (12 - state.telemetry.stability * .08);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawTarget(state, time) {
    const { width, height, ctx } = sizeCanvas(this.targetCanvas);
    ctx.clearRect(0, 0, width, height);
    const cx = width * .5, cy = height * .5;
    ctx.strokeStyle = 'rgba(215,151,54,.25)';
    ctx.lineWidth = .8;
    for (let r = 24; r < Math.min(width, height) * .55; r += 24) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * width, cy + Math.sin(a) * height); ctx.stroke();
    }
    for (let i = 0; i < 36; i += 1) {
      const seed = Math.sin(i * 18.23) * 43758.5453;
      const px = ((seed - Math.floor(seed)) * .9 + .05) * width;
      const py = ((Math.sin(i * 7.12) * 43758.5453 % 1 + 1) % 1 * .9 + .05) * height;
      ctx.fillStyle = i % 7 === 0 ? 'rgba(255,181,72,.82)' : 'rgba(136,198,224,.56)';
      ctx.fillRect(px, py, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
    }
    const pulse = 9 + Math.sin(time * .004) * 3;
    ctx.shadowColor = 'rgba(255,177,54,.9)'; ctx.shadowBlur = 16;
    ctx.strokeStyle = 'rgba(255,183,66,.95)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,216,133,.98)'; ctx.beginPath(); ctx.arc(cx, cy, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawNoise(state, time) {
    const { width, height, ctx } = sizeCanvas(this.noiseCanvas);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(99,191,235,.62)'; ctx.lineWidth = .8; ctx.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const y = height / 2 + Math.sin(x * .31 + time * .003) * 3 + (Math.random() - .5) * 12;
      if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawAlert(time) {
    const { width, height, ctx } = sizeCanvas(this.alertCanvas);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,65,51,.8)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const spike = x > width * .58 && x < width * .7 ? Math.sin(x * 1.6) * 5 : 0;
      const y = height / 2 + Math.sin(x * .09 + time * .004) * 2 + spike;
      if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
