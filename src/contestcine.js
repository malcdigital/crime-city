import * as THREE from 'three';
import { bendSpine, restPose } from './character.js';

// The 3-point contest's cinematics (the game waits under them, like the matchup):
//   intro(info, done)   before the countdown: letterboxed, the camera sweeping low along the
//                       racks and round the arc, ending behind you at the first one; the title,
//                       the rules, the money rack and the record to beat. Any tap, ✕, Space,
//                       Enter or Esc skips it.
//   outro(info, done)   after the horn, before the results card: the camera circling you low,
//                       you celebrating (or hands on your head after a rough one), the final
//                       score, then NEW RECORD! or the record you were after.
//   record(score)       the moment you pass the record mid-run: a gold banner bursts in and the
//                       crowd goes up (this one doesn't stop the game: main.js slows it a beat).

const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class ContestCine {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.el = null;
  }

  panel() {
    if (this.el) return this.el;
    const el = (this.el = document.createElement('div'));
    el.id = 'cine3';
    el.className = 'hidden';
    el.addEventListener('pointerdown', (e) => {
      if (!this.open || this.t < 0.35) return;
      e.preventDefault();
      this.finish();
    });
    document.body.appendChild(el);
    return el;
  }

  skipText() {
    const g = this.game;
    return g.input.touchMode ? 'TAP TO SKIP' : g.input.mode === 'pad' ? '✕ TO SKIP' : 'SPACE TO SKIP';
  }

  // info: { stations: [[x, z] rack spots], rim, money, best }
  intro(info, done) {
    this.mode = 'intro';
    this.info = info;
    this.done = done;
    this.t = 0;
    this.T = 4.6;
    this.open = true;
    const el = this.panel();
    const best = info.best > 0 ? `RECORD TO BEAT <b>${info.best}</b>` : 'NO RECORD YET: <b>SET ONE</b>';
    el.innerHTML = `<div class="c3-lb top"></div><div class="c3-lb bot"></div>
      <div class="c3-title"><small>THE</small><b>3-POINT</b><span>CONTEST</span></div>
      <div class="c3-rules">60 SECONDS · 5 RACKS + 2 DEEP BALLS · MONEY RACK: ${esc(info.money)}</div>
      <div class="c3-best">${best}</div>
      <div class="c3-skip">${this.skipText()}</div>`;
    this.show();
    this.camera(0);
  }

  // info: { score, best (before this run), newBest, made, player }
  outro(info, done) {
    this.mode = 'outro';
    this.info = info;
    this.done = done;
    this.t = 0;
    this.T = 4.2;
    this.open = true;
    const el = this.panel();
    const line = info.newBest ? '<div class="c3-new">NEW RECORD!</div>' : info.best > 0 ? `<div class="c3-best">RECORD <b>${info.best}</b></div>` : '';
    el.innerHTML = `<div class="c3-lb top"></div><div class="c3-lb bot"></div>
      <div class="c3-final"><small>FINAL SCORE</small><b>${info.score}</b><span>${info.made} OF 27 MADE</span></div>
      ${line}
      <div class="c3-skip">${this.skipText()}</div>`;
    this.happy = info.newBest || info.score >= 16;
    // (the crowd: up for a good one)
    if (this.happy) for (const q of this.game.sport?.g?.players || []) q.hp && (q.hp.cheerT = 3);
    this.show();
    this.camera(0);
  }

  // Passed the record mid-run: the banner (the game keeps going).
  record(score) {
    const el = this.panel();
    const b = document.createElement('div');
    b.className = 'c3-burst';
    b.innerHTML = `<b>NEW RECORD</b><span>${score}</span>`;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 2200);
    void el;
    for (const q of this.game.sport?.g?.players || []) q.hp && (q.hp.cheerT = 2);
  }

  show() {
    const el = this.el;
    el.classList.remove('hidden', 'out', 'on');
    void el.offsetWidth;
    el.classList.add('on', this.mode);
    document.body.classList.add('cine');
  }

  update(dt, a) {
    if (!this.open) return;
    this.t += Math.min(dt, 0.1);
    this.camera(this.t);
    if (this.mode === 'outro') this.pose(this.t);
    if (this.t > 0.35 && (a.menuOk || a.dealYes || a.menuBack || a.pause || a.bShoot)) return this.finish();
    if (this.t >= this.T) this.finish();
  }

  // You after the horn: arms up and a little bounce, or hands on your head.
  pose(t) {
    const c = this.game.player.char;
    restPose(c);
    if (this.happy) {
      const bob = Math.abs(Math.sin(t * 7)) * 0.08;
      c.armL.rotation.set(-2.9 + Math.sin(t * 7) * 0.15, 0, -0.25);
      c.armR.rotation.set(-2.9 - Math.sin(t * 7) * 0.15, 0, 0.25);
      c.elbowL.rotation.set(-0.3, 0, 0);
      c.elbowR.rotation.set(-0.3, 0, 0);
      bendSpine(c, -0.15, 0, 0);
      c.neck.rotation.set(-0.35, 0, 0);
      const u = c.group.userData;
      u.c3y ??= c.group.position.y;
      c.group.position.y = u.c3y + bob;
    } else {
      // (hands on the head, looking at the rim)
      c.armL.rotation.set(-2.4, 0, -0.65);
      c.armR.rotation.set(-2.4, 0, 0.65);
      c.elbowL.rotation.set(-2.2, 0, 0);
      c.elbowR.rotation.set(-2.2, 0, 0);
      bendSpine(c, -0.05, 0, 0);
      c.neck.rotation.set(-0.25, Math.sin(t * 1.5) * 0.25, 0);
    }
  }

  camera(t) {
    const game = this.game;
    const cam = game.camera;
    const k = ease(clamp01(t / this.T));
    if (this.mode === 'intro') {
      // (from out past the far corner, low, sweeping round the arc to behind you at rack one)
      const I = this.info;
      const rim = I.rim;
      const st = I.stations;
      const n = st.length - 1;
      const f = (1 - k) * n; // (the rack the camera's passing: the far corner down to the first)
      const i0 = Math.floor(f);
      const i1 = Math.min(n, i0 + 1);
      const u = f - i0;
      const sx = st[i0][0] + (st[i1][0] - st[i0][0]) * u;
      const sz = st[i0][1] + (st[i1][1] - st[i0][1]) * u;
      // (out beyond the arc, looking in at the racks and the rim)
      const ox = sx - rim.x;
      const oz = sz - rim.z;
      const ol = Math.hypot(ox, oz) || 1;
      const gy = game.city.groundY?.(sx, sz) || 0;
      const out = 3.2 - 1.6 * k;
      cam.position.set(sx + (ox / ol) * out, gy + 1.0 + 0.9 * k, sz + (oz / ol) * out);
      _a.set(rim.x + (sx - rim.x) * 0.35, gy + 1.6 + 0.6 * k, rim.z + (sz - rim.z) * 0.35);
      cam.lookAt(_a);
    } else {
      // (circling you, low, slowly; you in the lower middle, the score above)
      const p = game.player;
      const [px, pz] = p.pos();
      const gy = game.city.groundY?.(px, pz) || 0;
      const ang = p.heading + Math.PI * (0.75 - 0.5 * k);
      const r = 3.6 - 0.6 * k;
      cam.position.set(px + Math.sin(ang) * r, gy + 1.0 + 0.3 * k, pz + Math.cos(ang) * r);
      _b.set(px, gy + 1.75, pz);
      cam.lookAt(_b);
    }
  }

  finish() {
    if (!this.open) return;
    this.open = false;
    const c = this.game.player.char;
    if (c.group.userData.c3y != null) {
      c.group.position.y = c.group.userData.c3y;
      c.group.userData.c3y = null;
    }
    this.el.classList.add('out');
    setTimeout(() => {
      if (!this.open) this.el.classList.add('hidden');
    }, 380);
    document.body.classList.remove('cine');
    const d = this.done;
    this.done = null;
    d?.();
  }
}
