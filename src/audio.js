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

  burst(vol, filterType, freq, decay, thump, muffle = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || vol < 0.02) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq * muffle;
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

  shot(kind, vol = 1, muffle = 1) {
    if (kind === 'smg') this.burst(0.5 * vol, 'lowpass', 3200, 0.11, 140, muffle);
    else if (kind === 'rifle') this.burst(0.65 * vol, 'lowpass', 2600, 0.16, 120, muffle);
    else if (kind === 'shotgun') this.burst(0.95 * vol, 'lowpass', 1400, 0.42, 80, muffle);
    else this.burst(0.7 * vol, 'lowpass', 2200, 0.24, 110, muffle);
  }

  // Someone else's gunshot, d meters away: full and sharp up close, fading and muffled
  // with distance, and silent past about 160 m.
  shotAt(kind, d) {
    const HEAR = 160;
    if (d > HEAR) return;
    const k = 1 - d / HEAR;
    this.shot(kind, 0.85 * Math.pow(k, 1.6), Math.max(0.22, 1 - d / 190));
  }

  explosionAt(d) {
    const HEAR = 280;
    if (d > HEAR) return;
    this.explosion(Math.pow(1 - d / HEAR, 1.4));
  }

  // Picking up cash: a quick bright double blip.
  cash() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    for (const [f, dt] of [[1320, 0], [1760, 0.07]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.12, t + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.09);
      o.connect(g).connect(this.master);
      o.start(t + dt);
      o.stop(t + dt + 0.1);
    }
  }

  empty() {
    this.burst(0.15, 'highpass', 3000, 0.03, 0);
  }

  explosion(vol = 1) {
    this.burst(1.0 * vol, 'lowpass', 700, 1.3, 70);
  }
}
