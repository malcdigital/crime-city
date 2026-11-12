// Synthesized sound (no audio files): the one-shot effects here, the sounds that run all the
// time (your engine, tires, sirens, the city) in soundscape.js. Everything goes through one
// master gain: setVolume() (the pause menu's Sound button; kept in the browser).
const VOL_KEY = 'crimecity.volume';
export class Sfx {
  constructor() {
    this.ctx = null;
    this.noise = null;
    this.master = null;
    let v = 1;
    try {
      const s = localStorage.getItem(VOL_KEY);
      if (s !== null && isFinite(+s)) v = Math.max(0, Math.min(1, +s));
    } catch {
      // (no storage: full volume)
    }
    this.volume = v;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = 0.75 * this.volume;
    try {
      localStorage.setItem(VOL_KEY, String(this.volume));
    } catch {
      // (not kept)
    }
  }

  get on() {
    return !!this.ctx && this.ctx.state === 'running' && this.volume > 0;
  }

  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.75 * this.volume;
        // (a limiter on the way out: a crash on top of a siren and the engine doesn't distort)
        const lim = this.ctx.createDynamicsCompressor();
        lim.threshold.value = -9;
        lim.knee.value = 6;
        lim.ratio.value = 12;
        lim.attack.value = 0.003;
        lim.release.value = 0.2;
        this.master.connect(lim).connect(this.ctx.destination);
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

  burst(vol, filterType, freq, decay, thump, muffle = 1, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || vol < 0.02) return;
    const t = ctx.currentTime + delay;
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
    else if (kind === 'revolver') this.burst(0.9 * vol, 'lowpass', 1800, 0.34, 90, muffle); // (a big boom)
    else if (kind === 'mpistol') this.burst(0.45 * vol, 'lowpass', 3600, 0.08, 160, muffle); // (a quick crack)
    else if (kind === 'ak') this.burst(0.75 * vol, 'lowpass', 2200, 0.2, 100, muffle);
    else if (kind === 'hunting') this.burst(1.0 * vol, 'lowpass', 1600, 0.5, 75, muffle); // (rolls on)
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

  // A lookout's two-note whistle: up, then down (the cops are coming).
  whistle(vol = 0.3) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || vol < 0.02) return;
    const t = ctx.currentTime;
    for (const [f0, f1, dt, len] of [[1500, 2600, 0, 0.22], [2600, 1400, 0.3, 0.4]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t + dt);
      o.frequency.exponentialRampToValueAtTime(f1, t + dt + len);
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(vol, t + dt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + len);
      o.connect(g).connect(this.master);
      o.start(t + dt);
      o.stop(t + dt + len + 0.05);
    }
  }

  empty() {
    this.burst(0.15, 'highpass', 3000, 0.03, 0);
  }

  // A note: freq sliding to `to` over dur seconds, a quick attack and a fade.
  tone(freq, { to = freq, dur = 0.15, vol = 0.15, type = 'sine', delay = 0, attack = 0.008 } = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || vol < 0.01) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // A fist landing: a dull thump with a smack on top.
  punch(vol = 1) {
    this.burst(0.5 * vol, 'lowpass', 900, 0.1, 150);
    this.burst(0.22 * vol, 'bandpass', 2400, 0.04, 0);
  }

  // Something heavy hitting something (a body on a hood, a sign going over, a hydrant).
  thud(vol = 1) {
    this.burst(0.6 * vol, 'lowpass', 420, 0.2, 90);
  }

  // Metal on metal: the boom of the hit, the crunch of the panel, glass if it's a big one.
  crash(vol = 1) {
    vol = Math.min(1, vol);
    this.burst(0.9 * vol, 'lowpass', 1100, 0.34 + 0.25 * vol, 70);
    this.burst(0.5 * vol, 'bandpass', 2800, 0.12, 0);
    if (vol > 0.55) for (let i = 0; i < 5; i++) this.tone(2600 + Math.random() * 2600, { dur: 0.05 + Math.random() * 0.08, vol: 0.05 * vol, delay: 0.05 + Math.random() * 0.3 });
  }

  // Dice shaken and thrown: a rattle of clicks.
  dice() {
    for (let i = 0; i < 7; i++) this.burst(0.12 + Math.random() * 0.1, 'highpass', 2200 + Math.random() * 1500, 0.025, 0, 1, i * 0.05 + Math.random() * 0.03);
  }

  // The ball through the net.
  swish() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.35);
  }

  // A basketball on the court (vol by how hard), and off the rim.
  bounce(vol = 1) {
    this.tone(190, { to: 85, dur: 0.1, vol: 0.32 * vol });
    this.burst(0.1 * vol, 'lowpass', 1400, 0.03, 0);
  }

  rim(vol = 1) {
    this.tone(540, { dur: 0.3, vol: 0.14 * vol, type: 'triangle' });
    this.tone(812, { dur: 0.22, vol: 0.09 * vol, type: 'triangle' });
    this.burst(0.2 * vol, 'bandpass', 1800, 0.05, 0);
  }

  click() {
    this.burst(0.14, 'highpass', 4000, 0.02, 0);
  }

  // A footstep (pitch: the two feet a little apart; soft crouched).
  step(vol = 1, pitch = 1) {
    this.burst(0.2 * vol, 'lowpass', 520 * pitch, 0.06, 95 * pitch);
  }

  // A car door: the latch, then (shut) the thunk.
  doorOpen(vol = 1) {
    this.burst(0.16 * vol, 'highpass', 2200, 0.03, 0);
    this.burst(0.18 * vol, 'lowpass', 500, 0.08, 0, 1, 0.03);
  }

  doorShut(vol = 1) {
    this.burst(0.5 * vol, 'lowpass', 380, 0.13, 85);
    this.burst(0.1 * vol, 'highpass', 2500, 0.02, 0);
  }

  // A magazine out and in.
  reload() {
    this.burst(0.16, 'highpass', 2600, 0.03, 0);
    this.burst(0.2, 'bandpass', 1500, 0.04, 0, 1, 0.28);
    this.burst(0.14, 'highpass', 3200, 0.025, 0, 1, 0.42);
  }

  // A car horn, d meters off.
  horn(vol = 1, dur = 0.35) {
    this.tone(415, { dur, vol: 0.1 * vol, type: 'sawtooth', attack: 0.02 });
    this.tone(523, { dur, vol: 0.08 * vol, type: 'sawtooth', attack: 0.02 });
  }

  // Your phone: a text (two notes), the news (one soft one).
  notify(text = true) {
    if (text) {
      this.tone(880, { dur: 0.09, vol: 0.1 });
      this.tone(1175, { dur: 0.14, vol: 0.1, delay: 0.1 });
    } else this.tone(660, { dur: 0.1, vol: 0.06 });
  }

  // A wanted star: the police are on you.
  star() {
    this.tone(520, { dur: 0.12, vol: 0.12, type: 'square' });
    this.tone(780, { dur: 0.2, vol: 0.12, type: 'square', delay: 0.13 });
  }

  // Busted (the cuffs: two ratchets and a low note); wasted (a long fall).
  busted() {
    this.burst(0.25, 'highpass', 2800, 0.04, 0);
    this.burst(0.25, 'highpass', 2800, 0.04, 0, 1, 0.12);
    this.tone(220, { to: 110, dur: 0.9, vol: 0.16, type: 'triangle', delay: 0.2 });
  }

  wasted() {
    this.tone(330, { to: 55, dur: 1.6, vol: 0.2, type: 'sawtooth', attack: 0.05 });
    this.burst(0.3, 'lowpass', 300, 1.2, 60);
  }

  explosion(vol = 1) {
    this.burst(1.0 * vol, 'lowpass', 700, 1.3, 70);
  }
}
