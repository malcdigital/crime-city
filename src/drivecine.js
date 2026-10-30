import * as THREE from 'three';
import { QbcCine } from './qbccine.js';

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
    this.show();
    this.camera(0);
  }

  camera(t) {
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
