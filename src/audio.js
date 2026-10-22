// Simple synthesized sound effects (no audio files needed).
export class Sfx {
  constructor() {
    this.ctx = null;
    this.noise = null;
    this.master = null;
  }

  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 1.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  burst(vol, filterType, freq, decay, thump) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || vol < 0.02) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + decay + 0.05);
    if (thump) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.frequency.setValueAtTime(thump, t);
      o.frequency.exponentialRampToValueAtTime(30, t + decay * 0.8);
      og.gain.setValueAtTime(vol * 0.9, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(og).connect(this.master);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  shot(kind, vol = 1) {
    if (kind === 'smg') this.burst(0.5 * vol, 'lowpass', 3200, 0.11, 140);
    else this.burst(0.7 * vol, 'lowpass', 2200, 0.24, 110);
  }

  empty() {
    this.burst(0.15, 'highpass', 3000, 0.03, 0);
  }

  explosion(vol = 1) {
    this.burst(1.0 * vol, 'lowpass', 700, 1.3, 70);
  }
}
