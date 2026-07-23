export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseGain = null;
    this.tone = null;
    this.toneGain = null;
    this.enabled = true;
    this.started = false;
  }

  async start() {
    if (this.started || !this.enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(ctx.destination);

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < output.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      output[i] = white * 0.32 + last * 0.68;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1850;
    noiseFilter.Q.value = 0.6;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.17;
    noise.connect(noiseFilter).connect(this.noiseGain).connect(this.master);
    noise.start();

    this.tone = ctx.createOscillator();
    this.tone.type = 'sine';
    this.tone.frequency.value = 392;
    this.toneGain = ctx.createGain();
    this.toneGain.gain.value = 0;
    this.tone.connect(this.toneGain).connect(this.master);
    this.tone.start();
    this.started = true;
  }

  update({ proximity, frequencyMHz }) {
    if (!this.context || !this.started) return;
    const safeProximity = Number.isFinite(proximity) ? Math.max(0, Math.min(1, proximity)) : 0;
    const safeFrequency = Number.isFinite(frequencyMHz) && frequencyMHz > 0 ? frequencyMHz : 1_000;
    const now = Number.isFinite(this.context.currentTime) ? this.context.currentTime : 0;
    const noiseLevel = Math.max(0.035, 0.19 - safeProximity * 0.13);
    const carrierFrequency = 180 + ((Math.log10(safeFrequency) % 1 + 1) % 1) * 620;
    const carrierLevel = safeProximity > 0.42 ? (safeProximity - 0.42) * 0.11 : 0;
    this.noiseGain.gain.setTargetAtTime(noiseLevel, now, 0.08);
    this.tone.frequency.setTargetAtTime(carrierFrequency, now, 0.08);
    this.toneGain.gain.setTargetAtTime(carrierLevel, now, 0.07);
  }

  pulse(type = 'lock') {
    if (!this.context || !this.started) return;
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type === 'decode' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(type === 'decode' ? 760 : 520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(type === 'decode' ? 1040 : 690, ctx.currentTime + 0.24);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.34);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.master && this.context) this.master.gain.setTargetAtTime(enabled ? 0.18 : 0, this.context.currentTime, 0.05);
  }
}
