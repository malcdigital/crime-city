import { dist } from './geom.js';

// The sounds that run all the time, worked out from what's happening each frame (audio.js Sfx
// has the one-shots, and the context and master volume this goes through). All synthesized.
//   your engine    pitched by revs (speed through the gears, each type its own voice: a truck
//                  low, the Azure high and wide), louder and brighter on the gas; a rumble at idle
//   tires          a screech in a slide, a burnout, or braking hard at speed; road and wind
//                  noise growing with speed
//   other cars     the two nearest moving ones: a hum that swells as they pass
//   sirens         the two nearest police cars with theirs on: a wail (a yelp when they're
//                  right on you), fading and dulling with distance; the helicopter's rotor
//   the city       a low bed of far traffic by day (quieter at night, and indoors), a horn or
//                  a dog now and then, crickets after dark
//   you            footsteps by the ground you cover; car doors near you; crashes near you
//   your phone and the law: a text, the news, a wanted star, busted, wasted
// Faded out whenever the game isn't running (paused, the map, a menu), and the context is
// suspended while the page is hidden.
const TYPES = {
  // base (idle pitch, Hz), span (added at the red line), gears (top of each, as a share of top speed), body (filter), growl (the second voice's level)
  sedan: { base: 46, span: 105, gears: [0.2, 0.38, 0.58, 0.8, 1.05], body: 520, growl: 0.5 },
  taxi: { base: 46, span: 100, gears: [0.2, 0.38, 0.58, 0.8, 1.05], body: 500, growl: 0.5 },
  police: { base: 50, span: 125, gears: [0.2, 0.37, 0.56, 0.78, 1.05], body: 620, growl: 0.65 },
  sports: { base: 58, span: 170, gears: [0.17, 0.31, 0.47, 0.64, 0.82, 1.05], body: 800, growl: 0.8 },
  azure: { base: 66, span: 230, gears: [0.14, 0.26, 0.4, 0.55, 0.71, 0.88, 1.05], body: 1100, growl: 1 },
  van: { base: 40, span: 80, gears: [0.22, 0.42, 0.66, 1.05], body: 420, growl: 0.45 },
  swat: { base: 36, span: 78, gears: [0.22, 0.42, 0.66, 1.05], body: 400, growl: 0.6 },
  delivery: { base: 32, span: 66, gears: [0.2, 0.36, 0.55, 0.78, 1.05], body: 360, growl: 0.6 },
  bus: { base: 30, span: 56, gears: [0.24, 0.46, 0.72, 1.05], body: 330, growl: 0.65 },
};
const clamp01 = (k) => Math.max(0, Math.min(1, k));

export class Soundscape {
  constructor(game) {
    this.game = game;
    this.sfx = game.sfx;
    this.v = null; // (the voices, built once the audio's unlocked)
    this.rev = 0;
    this.gear = 0;
    this.stepD = 0;
    this.foot = 0;
    this.last = null;
    this.amb = 8 + Math.random() * 10;
    this.was = { stars: 0, texts: 0, news: 0, busted: false, wasted: false, reload: 0 };
    this.sirenPh = [0, 0.37];
    document.addEventListener('visibilitychange', () => {
      const ctx = this.sfx.ctx;
      if (!ctx) return;
      if (document.hidden) ctx.suspend?.();
      else ctx.resume?.();
    });
  }

  // A one-shot from somewhere in the world: quieter with distance, silent past `hear` meters.
  near(name, x, z, hear = 60, vol = 1) {
    if (!this.sfx.on) return;
    const [px, pz] = this.game.player.pos();
    const d = dist(px, pz, x, z);
    if (d > hear) return;
    this.sfx[name]?.(vol * Math.pow(1 - d / hear, 1.5));
  }

  build() {
    const ctx = this.sfx.ctx;
    const out = this.sfx.master;
    const gain = (to = out, v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(to);
      return g;
    };
    const osc = (type, to, f = 100) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(to);
      o.start();
      return o;
    };
    const filt = (type, f, q, to) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      if (q) b.Q.value = q;
      b.connect(to);
      return b;
    };
    const noise = (to, rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = this.sfx.noise;
      s.loop = true;
      s.playbackRate.value = rate;
      s.connect(to);
      s.start();
      return s;
    };
    const V = {};
    // The engine: two saws an octave apart and a square under them, through a low-pass (the
    // body), its level wobbled a little at firing speed (the rumble).
    V.engG = gain();
    V.engF = filt('lowpass', 500, 1.2, V.engG);
    V.engA = osc('sawtooth', V.engF);
    V.engBg = gain(V.engF, 0.5);
    V.engB = osc('sawtooth', V.engBg);
    V.engCg = gain(V.engF, 0.5);
    V.engC = osc('square', V.engCg);
    V.engLfoG = gain(V.engG.gain, 0); // (onto the level)
    V.engLfo = osc('sine', V.engLfoG, 12);
    // Tires: band-passed noise (the screech), and low noise (the road and the wind).
    V.skidG = gain();
    V.skidF = filt('bandpass', 1700, 5, V.skidG);
    noise(V.skidF, 1.1);
    V.windG = gain();
    V.windF = filt('lowpass', 500, 0, V.windG);
    noise(V.windF, 0.6);
    // Other cars: a hum each for the two nearest.
    V.cars = [0, 1].map(() => {
      const g = gain();
      const f = filt('lowpass', 260, 0, g);
      return { g, f, o: osc('sawtooth', f, 60) };
    });
    // Sirens: a triangle swept up and down, dulled with distance.
    V.sirens = [0, 1].map(() => {
      const g = gain();
      const f = filt('lowpass', 3000, 0, g);
      return { g, f, o: osc('triangle', f, 700) };
    });
    // The helicopter: low noise chopped at the blades' beat.
    V.heliG = gain();
    V.heliChop = gain(V.heliG, 0.5);
    V.heliLfoG = gain(V.heliChop.gain, 0.5);
    osc('sine', V.heliLfoG, 13);
    V.heliF = filt('lowpass', 240, 0, V.heliChop);
    noise(V.heliF, 0.5);
    // The city: a low bed.
    V.cityG = gain();
    V.cityF = filt('lowpass', 210, 0, V.cityG);
    noise(V.cityF, 0.35);
    this.v = V;
  }

  // Every frame. running: the game itself updated this frame (not paused, no menu over it).
  update(dt, a, running) {
    const sfx = this.sfx;
    const ctx = sfx.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.v) this.build();
    const V = this.v;
    const t = ctx.currentTime;
    // (a value that isn't a number is dropped, never thrown: sound mustn't stop the game)
    const set = (param, v, tc = 0.06) => {
      if (Number.isFinite(v)) param.setTargetAtTime(v, t, tc);
      else if (!this.warned) {
        this.warned = true;
        console.warn('soundscape: not a number', new Error().stack.split('\n')[2]);
      }
    };
    const game = this.game;
    if (!running || sfx.volume <= 0) {
      for (const g of [V.engG, V.skidG, V.windG, V.heliG, V.cityG, ...V.cars.map((c) => c.g), ...V.sirens.map((s) => s.g)]) set(g.gain, 0, 0.08);
      set(V.engLfoG.gain, 0, 0.08);
      this.last = null;
      return;
    }
    const p = game.player;
    const [px, pz] = p.pos();
    const car = p.vehicle;
    const inside = !!(game.interiors?.inside || game.storeRooms?.inside);
    const night = Math.max(0, game.dayNight?.night ?? 0);

    // ---- Your engine ----
    if (car && !car.exploded) {
      const T = TYPES[car.typeName] || TYPES.sedan;
      const sp = Math.abs(car.speed);
      const top = Math.max(8, car.type.max * 0.86); // (about what it really reaches)
      const k = sp / top;
      // (the gear for this speed, with a little slack before it changes down)
      let gi = Math.min(this.gear, T.gears.length - 1); // (a different car: fewer gears, maybe)
      if (!Number.isFinite(this.rev)) this.rev = 0;
      while (gi < T.gears.length - 1 && k > T.gears[gi] * 0.97) gi++;
      while (gi > 0 && k < T.gears[gi - 1] * 0.8) gi--;
      const shifted = gi !== this.gear;
      this.gear = gi;
      const lo = gi ? T.gears[gi - 1] * 0.62 : 0;
      const thr = car.burnout ? 1 : Math.abs(a?.throttle || 0);
      // (revs: through the gear's range; a burnout or the wheels spinning up pins them)
      let want = car.burnout ? 0.92 : clamp01((k - lo) / (T.gears[gi] - lo));
      if (car.wrecked) want = 0;
      want = Math.max(want, 0.06 + 0.1 * thr);
      this.rev += (want - this.rev) * Math.min(1, dt * (shifted ? 14 : want > this.rev ? 5 : 3.2));
      const f = T.base + T.span * this.rev;
      set(V.engA.frequency, f, 0.03);
      set(V.engB.frequency, f * 0.5, 0.03);
      set(V.engC.frequency, f * 1.5, 0.03);
      set(V.engBg.gain, 0.55, 0.1);
      set(V.engCg.gain, 0.18 * T.growl * (0.4 + 0.6 * thr), 0.08);
      set(V.engF.frequency, T.body * (0.55 + 0.9 * this.rev + 0.9 * thr), 0.07);
      const level = car.wrecked ? 0 : 0.06 + 0.065 * this.rev + 0.1 * thr;
      set(V.engG.gain, level, 0.07);
      set(V.engLfo.frequency, 7 + f * 0.25, 0.05);
      set(V.engLfoG.gain, level * 0.28 * (1 - 0.6 * this.rev), 0.08);
      // (tires and the road)
      const slide = clamp01(Math.max((car.drift || 0) / 9, car.burnout ? 0.8 : 0, car.braking && sp > 14 && Math.abs(a?.throttle || 0) > 0.5 ? (sp - 14) / 40 : 0, (car.grip ?? 1) < 0.6 && sp > 8 ? 0.5 : 0));
      set(V.skidG.gain, 0.16 * slide, 0.05);
      set(V.skidF.frequency, 1300 + 900 * clamp01(sp / 40) + (car.burnout ? 300 : 0), 0.1);
      set(V.windG.gain, 0.11 * clamp01(k) * clamp01(k), 0.2);
      set(V.windF.frequency, 300 + 900 * clamp01(k), 0.2);
      // (a hit: metal, by how hard)
      const c = car.crash || 0;
      if (c > 2.5 && c > (this.wasCrash || 0) + 1.5) sfx.crash(clamp01(c / 16));
      this.wasCrash = c;
    } else {
      set(V.engG.gain, 0, 0.12);
      set(V.engLfoG.gain, 0, 0.1);
      set(V.skidG.gain, 0, 0.08);
      set(V.windG.gain, 0, 0.2);
      this.rev = 0;
      this.gear = 0;
      this.wasCrash = 0;
    }

    // ---- Other cars, sirens, doors, crashes: one pass over the vehicles near you ----
    const nearest = [];
    const sirens = [];
    for (const v of game.vehicles) {
      if (v === car || v.removed) continue;
      const d = dist(px, pz, v.x, v.z);
      if (d > 240) continue;
      if (v.siren && !v.exploded) sirens.push([d, v]);
      if (d > 70) continue;
      const sp = Math.abs(v.speed);
      if (sp > 2 && d < 38 && v.driver) nearest.push([d, v, sp]);
      // (someone else's crash)
      const c = v.crash || 0;
      if (c > 3 && c > (v._sndCrash || 0) + 1.5) sfx.crash(clamp01(c / 16) * Math.pow(1 - d / 70, 1.5));
      v._sndCrash = c;
    }
    // (doors: yours and the cars right by you)
    for (const v of game.vehicles) {
      if (v.removed || !v.doors) continue;
      const d = v === car ? 0 : dist(px, pz, v.x, v.z);
      if (d > 25) continue;
      for (const dr of Object.values(v.doors)) {
        const open = Math.abs(dr.angle) > 0.12;
        if (dr._snd === undefined) dr._snd = open;
        if (open !== dr._snd) {
          dr._snd = open;
          const vol = Math.pow(1 - d / 25, 1.5);
          if (open) sfx.doorOpen(vol);
          else sfx.doorShut(vol);
        }
      }
    }
    nearest.sort((x, y) => x[0] - y[0]);
    for (let i = 0; i < V.cars.length; i++) {
      const c = V.cars[i];
      const n = nearest[i];
      if (!n) {
        set(c.g.gain, 0, 0.15);
        continue;
      }
      const [d, v, sp] = n;
      const T = TYPES[v.typeName] || TYPES.sedan;
      set(c.o.frequency, T.base * 0.9 + sp * 2.2, 0.1);
      set(c.f.frequency, T.body * 0.45 + sp * 9, 0.1);
      set(c.g.gain, (inside ? 0.3 : 1) * 0.05 * Math.pow(1 - d / 38, 2) * (0.5 + clamp01(sp / 20)), 0.1);
    }
    sirens.sort((x, y) => x[0] - y[0]);
    for (let i = 0; i < V.sirens.length; i++) {
      const s = V.sirens[i];
      const n = sirens[i];
      if (!n) {
        set(s.g.gain, 0, 0.2);
        continue;
      }
      const d = n[0];
      const k = 1 - d / 240;
      // (a slow wail far off, a yelp when they're right behind you)
      const rate = d < 45 ? 3.1 : 0.42;
      this.sirenPh[i] = (this.sirenPh[i] + dt * rate) % 1;
      const ph = this.sirenPh[i];
      const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      set(s.o.frequency, 640 + 620 * tri * (i ? 0.94 : 1), 0.02);
      set(s.f.frequency, 700 + 3600 * k * k, 0.2);
      set(s.g.gain, (inside ? 0.35 : 1) * 0.1 * Math.pow(k, 1.7), 0.15);
    }

    // ---- The helicopter ----
    const heli = game.police?.heli;
    if (heli && heli.state !== 'down' && !heli.removed) {
      const d = Math.hypot(heli.x - px, heli.z - pz, (heli.y || 40) * 0.6);
      set(V.heliG.gain, (inside ? 0.4 : 1) * 0.2 * Math.pow(clamp01(1 - d / 260), 1.6), 0.2);
    } else set(V.heliG.gain, 0, 0.3);

    // ---- The city ----
    const busy = game.rhythm ? game.rhythm.weight(px, pz, 't') : 1 - 0.6 * night; // (how much traffic's about here, at this hour)
    set(V.cityG.gain, (inside ? 0.25 : 1) * (0.1 + 0.14 * clamp01(busy)) * (car ? 0.55 : 1), 0.8);
    this.amb -= dt;
    if (this.amb <= 0 && !inside) {
      this.amb = 9 + Math.random() * 22;
      const r = Math.random();
      if (night > 0.6 && r < 0.6) {
        // (crickets)
        for (let i = 0; i < 6; i++) sfx.tone(4300 + Math.random() * 300, { dur: 0.04, vol: 0.018, delay: i * 0.075 });
      } else if (r < 0.55) sfx.horn(0.12 + Math.random() * 0.2, 0.2 + Math.random() * 0.4); // (a horn, blocks away)
      else if (r < 0.8) {
        // (a dog)
        for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) sfx.tone(420, { to: 250, dur: 0.11, vol: 0.035, type: 'sawtooth', delay: i * 0.26 });
      }
    }

    // ---- You, on foot ----
    if (!car && this.last && p.char.group.visible && p.char.group.rotation.x === 0) {
      const moved = dist(px, pz, this.last[0], this.last[1]);
      const sp = moved / Math.max(dt, 1e-3);
      if (sp > 0.8 && sp < 14 && !p.busy) {
        this.stepD += moved;
        const stride = 0.85 + 0.1 * sp;
        if (this.stepD > stride) {
          this.stepD = 0;
          this.foot ^= 1;
          sfx.step((p.crouched ? 0.45 : 0.8 + 0.05 * sp) * (inside ? 1.15 : 1), this.foot ? 1 : 0.86);
        }
      } else this.stepD = 0;
    }
    this.last = [px, pz];

    // ---- Your phone and the law ----
    const W = this.was;
    const hud = game.hud;
    const texts = hud.unreadTexts || 0;
    const news = (hud.unreadNews || 0) + (hud.unreadCrime || 0);
    if (texts > W.texts) sfx.notify(true);
    else if (news > W.news) sfx.notify(false);
    W.texts = texts;
    W.news = news;
    if (game.stars > W.stars) sfx.star();
    W.stars = game.stars;
    const busted = game.bustedT > 0;
    const wasted = game.wastedT > 0;
    if (busted && !W.busted) sfx.busted();
    if (wasted && !W.wasted) sfx.wasted();
    W.busted = busted;
    W.wasted = wasted;
    const rl = game.arsenal?.reloadT || 0;
    if (rl > 0 && W.reload <= 0) sfx.reload();
    W.reload = rl;
  }
}
