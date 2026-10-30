import * as THREE from 'three';
import { QbcCine } from './qbccine.js';
import { griddyPose, upsetPose } from './footballpose.js';
import { restPose } from './character.js';

// The drive's intro (gridiron.js / drivereads.js), on the QB Challenge's and the 3-point
// contest's (the same letterboxed panel, any tap / ✕ / Space skips it): everyone's already
// lined up, the camera starts deep behind the defense, sweeps in low over the backs to the line
// looking at your side, then cuts in behind you as you look downfield. The title, who you're
// playing, where you start, what's on it and the play that's been called for you.

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const _a = new THREE.Vector3();

export class DriveCine extends QbcCine {
  // info: { spot: [x, z], los, cx, squad, from, bet, play }
  intro(info, done) {
    this.mode = 'intro';
    this.info = info;
    this.done = done;
    this.t = 0;
    this.T = 5.0;
    this.open = true;
    const el = this.panel();
    const stake = info.bet ? `<b>$${info.bet}</b> SAYS YOU SCORE` : 'JUST FOR FUN';
    el.innerHTML = `<div class="c3-lb top"></div><div class="c3-lb bot"></div>
      <div class="c3-title"><small>THE</small><b>DRIVE</b><span>VS ${esc(info.squad.toUpperCase())}'S SQUAD</span></div>
      <div class="c3-rules">${esc(info.from)} · FOUR DOWNS TO MAKE 10 · EVERY THROW SCORED<br>FIND THE OPEN MAN EARLY · HIT THE GREEN · TAP IT PERFECT · SCORE FAST</div>
      <div class="c3-best">${info.best > 0 ? `RECORD TO BEAT <b>${info.best}</b>` : 'NO RECORD YET'} · ${stake} · PLAY CALL <b>${esc(info.play.toUpperCase())}</b></div>
      <div class="c3-skip">${this.skipText()}</div>`;
    this.show();
    this.camera(0);
  }

  // info: { score, best (before this one), newBest, how ('td' / 'pick' / 'downs'), plays, bonus,
  // passes, caught, bestThrow }: the drive's final score, the camera round you (celebrating a
  // touchdown or a record, hands on your head otherwise).
  outro(info, done) {
    this.mode = 'outro';
    this.info = info;
    this.done = done;
    this.t = 0;
    this.T = 4.6;
    this.open = true;
    const el = this.panel();
    const how = info.how === 'td' ? `TOUCHDOWN IN ${info.plays} PLAY${info.plays === 1 ? '' : 'S'}${info.bonus ? ` · +${info.bonus} QUICK DRIVE` : ''}` : info.how === 'pick' ? 'INTERCEPTED' : 'TURNOVER ON DOWNS';
    const line = info.newBest ? '<div class="c3-new">NEW RECORD!</div>' : info.best > 0 ? `<div class="c3-best">RECORD <b>${info.best}</b></div>` : '';
    el.innerHTML = `<div class="c3-lb top"></div><div class="c3-lb bot"></div>
      <div class="c3-final"><small>DRIVE SCORE</small><b>${info.score}</b><span>${how}<br>${info.caught} OF ${info.passes} CAUGHT · BEST THROW ${info.bestThrow}</span></div>
      ${line}
      <div class="c3-skip">${this.skipText()}</div>`;
    this.happy = info.how === 'td' || info.newBest;
    this.clearAng = null;
    this.show();
    this.camera(0);
  }

  // (the 3-point contest's celebration is posed in the frame the game waits; here the game runs
  // on under it, so you're posed after it's moved you: afterUpdate)
  pose() {}

  // You, after the game's frame: the Griddy if you ran it in, or a turnover's emote.
  afterUpdate() {
    if (!this.open || this.mode !== 'outro' || !this.info?.emote) return;
    // (everyone else gives him room: eased out to 3 m round him)
    const game = this.game;
    const who = this.info.dancer === 'you' ? game.player : this.info.dancer;
    const [wx, wz] = who === game.player ? game.player.pos() : [who.x, who.z];
    for (const q of game.football?.players || []) {
      if (q === who || q.fb?.role === 'fan') continue;
      const d = Math.hypot(q.x - wx, q.z - wz);
      if (d < 3 && d > 0.01) {
        const k = Math.min(1, 0.06 * (3 - d));
        q.x += ((q.x - wx) / d) * k;
        q.z += ((q.z - wz) / d) * k;
      }
    }
    if (this.info.dancer !== 'you') return;
    const p = this.game.player;
    const c = p.char;
    restPose(c);
    c.group.rotation.x = 0;
    const y = this.info.emote === 'griddy' ? griddyPose(c, this.t) : upsetPose(c, this.t);
    c.group.position.y = (p.gy?.() || 0) + y;
  }

  camera(t) {
    if (this.mode === 'outro' && this.info?.emote) {
      // (round whoever it's on, low, slowly; him in the lower middle, the score above)
      const game = this.game;
      const cam = game.camera;
      const who = this.info.dancer === 'you' ? game.player : this.info.dancer;
      const [px, pz] = who === game.player ? game.player.pos() : [who.x, who.z];
      const k = ease(clamp01(t / this.T));
      // (the start of the swing round him picked once, where nobody stands between)
      if (this.clearAng == null) {
        let best = -1;
        for (let i = 0; i < 16; i++) {
          const a0 = (i / 16) * Math.PI * 2;
          let worst = 9;
          for (const q of game.football?.players || []) {
            if (q === who || q.fb?.role === 'fan') continue;
            for (const u of [0, 0.5, 1]) {
              const a = a0 + Math.PI * 0.6 * u;
              const cx = px + Math.sin(a) * 3.6;
              const cz = pz + Math.cos(a) * 3.6;
              // (how far he is from the line from the camera to the dancer)
              const lx = px - cx;
              const lz = pz - cz;
              const L2 = lx * lx + lz * lz;
              const s = Math.max(0, Math.min(1, ((q.x - cx) * lx + (q.z - cz) * lz) / L2));
              worst = Math.min(worst, Math.hypot(q.x - (cx + lx * s), q.z - (cz + lz * s)) + (s > 0.95 ? 1 : 0));
            }
          }
          const facing = Math.cos(a0 + Math.PI * 0.3 - (who.heading || 0)); // (a little credit for seeing his front)
          const score = Math.min(worst, 2.5) + facing * 0.3;
          if (score > best) {
            best = score;
            this.clearAng = a0;
          }
        }
      }
      const ang = this.clearAng + Math.PI * 0.6 * k; // (round him, from where it's clear)
      const r = 3.8 - 0.5 * k;
      cam.position.set(px + Math.sin(ang) * r, 1.15 + 0.3 * k, pz + Math.cos(ang) * r);
      _a.set(px, 1.35, pz);
      cam.lookAt(_a);
      return;
    }
    if (this.mode !== 'intro' || !this.info?.los) return super.camera(t);
    const cam = this.game.camera;
    const I = this.info;
    const [sx, sz] = I.spot;
    const k = clamp01(t / this.T);
    if (k < 0.6) {
      // (deep behind the defense, high, sweeping in low over the backs to the line, looking at
      // your side lined up)
      const u = ease(k / 0.6);
      const z = I.los - 26 + 22 * u;
      cam.position.set(I.cx + Math.sin(u * 2.4) * 6, 8 - 5.6 * u, z);
      _a.set(I.cx, 1.1, I.los + 3);
    } else {
      // (cut: in behind you, pushing up to your shoulder, looking downfield)
      const u = ease((k - 0.6) / 0.4);
      cam.position.set(sx + 1.4 - 0.55 * u, 2.9 - 1.0 * u, sz + 7 - 3.2 * u);
      _a.set(sx, 1.4, sz - 22);
    }
    cam.lookAt(_a);
  }
}
