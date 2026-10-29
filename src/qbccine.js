import * as THREE from 'three';
import { ContestCine } from './contestcine.js';

// The QB Challenge's cinematics (qbchallenge.js), on the 3-point contest's (contestcine.js:
// the same letterbox panel, skipping, and the finish's camera round you and celebration):
//   intro(info, done)   before stage one: the camera flying low down the field from behind you
//                       over the rings to the deep one, then a push in behind you at the spot;
//                       the title, the three stages, the record to beat.
//   outro(info, done)   after the last stage: the final score, each stage's, NEW RECORD! or the
//                       record you were after.

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const _a = new THREE.Vector3();

export class QbcCine extends ContestCine {
  // (the 3-point contest's panel, shared; a tap on it skips this one too)
  panel() {
    const el = this.game.contestCine.panel();
    if (!this.hooked) {
      this.hooked = true;
      el.addEventListener('pointerdown', (e) => {
        if (!this.open || this.t < 0.35) return;
        e.preventDefault();
        this.finish();
      });
    }
    this.el = el;
    return el;
  }

  // info: { spot: [x, z], gy, rings: [[x, z]...], best }
  intro(info, done) {
    this.mode = 'intro';
    this.info = info;
    this.done = done;
    this.t = 0;
    this.T = 5.2;
    this.open = true;
    const el = this.panel();
    const best = info.best > 0 ? `RECORD TO BEAT <b>${info.best}</b>` : 'NO RECORD YET: <b>SET ONE</b>';
    el.innerHTML = `<div class="c3-lb top"></div><div class="c3-lb bot"></div>
      <div class="c3-title"><small>THE</small><b>QB</b><span>CHALLENGE</span></div>
      <div class="c3-rules">3 STAGES · ACCURACY · TIMING · POCKET · 40 SECONDS EACH<br>BULLSEYES DOUBLE · STREAKS MULTIPLY · HIT THE GOLD</div>
      <div class="c3-best">${best}</div>
      <div class="c3-skip">${this.skipText()}</div>`;
    this.show();
    this.camera(0);
  }

  // info: { score, best (before this run), newBest, stages: [[name, score]...], hits, throws }
  outro(info, done) {
    this.mode = 'outro';
    this.info = info;
    this.done = done;
    this.t = 0;
    this.T = 4.6;
    this.open = true;
    const el = this.panel();
    const line = info.newBest ? '<div class="c3-new">NEW RECORD!</div>' : info.best > 0 ? `<div class="c3-best">RECORD <b>${info.best}</b></div>` : '';
    const by = info.stages.map(([n, s]) => `${n} ${s}`).join(' · ');
    el.innerHTML = `<div class="c3-lb top"></div><div class="c3-lb bot"></div>
      <div class="c3-final"><small>FINAL SCORE</small><b>${info.score}</b><span>${by}<br>${info.hits} OF ${info.throws} ON TARGET</span></div>
      ${line}
      <div class="c3-skip">${this.skipText()}</div>`;
    this.happy = info.newBest || info.score >= 60;
    this.show();
    this.camera(0);
  }

  camera(t) {
    if (this.mode !== 'intro') return super.camera(t);
    const game = this.game;
    const cam = game.camera;
    const I = this.info;
    const [sx, sz] = I.spot;
    const gy = I.gy || 0;
    const deep = Math.min(...I.rings.map((r) => r[1])); // (the furthest ring downfield: -z)
    const k = clamp01(t / this.T);
    if (k < 0.72) {
      // (flying down the field from behind you, over the rings)
      const u = ease(k / 0.72);
      const z = sz + 6 + (deep - 6 - (sz + 6)) * u;
      cam.position.set(sx + Math.sin(u * 3) * 3, gy + 6 - 2.6 * Math.sin(u * Math.PI), z);
      _a.set(sx + Math.sin(u * 3 + 0.6) * 2, gy + 1.5, z - 14);
    } else {
      // (cut: pushing in behind you at the spot, looking downfield)
      const u = ease((k - 0.72) / 0.28);
      cam.position.set(sx + 1.2, gy + 2.8 - 0.8 * u, sz + 7 - 3 * u);
      _a.set(sx, gy + 1.6, sz - 20);
    }
    cam.lookAt(_a);
  }
}
