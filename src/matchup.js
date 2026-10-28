import * as THREE from 'three';
import { crouchPose } from './character.js';

// The matchup: a short cinematic before a one-on-one. The two of you square up at the top of
// the key, the camera swings slowly round you low to the ground, and the card comes in: YOU vs
// him with your overalls, what it's to and what's on it, and a line from him. It waits for
// nobody (about 4 s), and any tap, ✕ / Space / Enter / Esc skips it. The game's paused under it.

const T = 4.4; // (seconds)
const TALK = [
  'Hope your jumper better than your talking.',
  'You sure you want this smoke?',
  'I been waiting on somebody to bring they money.',
  'Check ball. Don\'t cry when it\'s over.',
  'This my court. You just visiting.',
  'Run it. Winner keep the bread.',
  'Don\'t foul me when I go by you.',
  'Bet. I need that money anyway.',
];
const ease = (k) => k * k * (3 - 2 * k);
const _look = new THREE.Vector3();

export class Matchup {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.el = null;
  }

  // info: { you: { ovr, sub }, opp: { name, ovr, sub }, line, at: [x, z] (the middle),
  //         dir: [x, z] (unit, you → him) }; done: called when it's over (played or skipped).
  play(info, done) {
    const game = this.game;
    this.info = info;
    this.done = done;
    this.t = 0;
    this.open = true;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'matchup';
      this.el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.finish();
      });
      document.body.appendChild(this.el);
    }
    const skip = game.input.touchMode ? 'TAP TO SKIP' : game.input.mode === 'pad' ? '✕ TO SKIP' : 'SPACE TO SKIP';
    const bar = (o) => Math.max(8, Math.min(100, ((o - 50) / 49) * 100));
    this.el.innerHTML = `<div class="mu-lb top"></div><div class="mu-lb bot"></div>
      <div class="mu-head"><b>1V1</b><span>MATCHUP</span></div>
      <div class="mu-top"><div class="mu-card">
        <div class="mu-side you"><div class="mu-n">YOU</div><div class="mu-o">${info.you.ovr} <small>OVR</small></div><div class="mu-bar"><i style="width:${bar(info.you.ovr)}%"></i></div><div class="mu-sub">${esc(info.you.sub)}</div></div>
        <div class="mu-vs">VS</div>
        <div class="mu-side opp"><div class="mu-n">${esc(info.opp.name.toUpperCase())}</div><div class="mu-o">${info.opp.ovr} <small>OVR</small></div><div class="mu-bar"><i style="width:${bar(info.opp.ovr)}%"></i></div><div class="mu-sub">${esc(info.opp.sub)}</div></div>
      </div>
      <div class="mu-line">${esc(info.line)}</div></div>
      <div class="mu-talk">“${esc(TALK[Math.floor(Math.random() * TALK.length)])}”</div>
      <div class="mu-skip">${skip}</div>`;
    this.el.classList.remove('hidden', 'out');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    document.body.classList.add('cine');
    this.stance();
    this.camera(0);
  }

  // Squared up, a little low, hands loose: both of you.
  stance() {
    const game = this.game;
    for (const c of [game.player.char, game.sport?.opp?.char]) {
      if (!c) continue;
      const u = c.group.userData;
      u.muY ??= c.group.position.y;
      const drop = crouchPose(c, 0.32);
      c.armL.rotation.x = c.armR.rotation.x = -0.45;
      c.armL.rotation.z = 0.2;
      c.armR.rotation.z = -0.2;
      c.elbowL.rotation.x = c.elbowR.rotation.x = -0.7;
      c.group.position.y = u.muY + drop;
    }
  }

  // Low, a slow swing round the two of you from the side, easing in closer.
  camera(t) {
    const game = this.game;
    const I = this.info;
    const [mx, mz] = I.at;
    const [ux, uz] = I.dir;
    const nx = -uz;
    const nz = ux;
    const k = ease(Math.min(1, t / T));
    const ang = -0.55 + 0.75 * k; // (from a little behind you round past side-on)
    const r = 5.0 - 0.9 * k;
    const ox = (nx * Math.cos(ang) - ux * Math.sin(ang)) * r;
    const oz = (nz * Math.cos(ang) - uz * Math.sin(ang)) * r;
    const cam = game.camera;
    // (aimed above their heads, so the two of them stand in the lower half of the frame, under
    // the card)
    cam.position.set(mx + ox, 1.3 + 0.2 * (1 - k), mz + oz);
    _look.set(mx, 2.3, mz);
    cam.lookAt(_look);
  }

  update(dt, a) {
    if (!this.open) return;
    this.t += Math.min(dt, 0.1);
    this.camera(this.t);
    if (this.t > 0.35 && (a.menuOk || a.dealYes || a.menuBack || a.pause || a.bShoot)) return this.finish();
    if (this.t >= T) this.finish();
  }

  finish() {
    if (!this.open) return;
    this.open = false;
    const game = this.game;
    for (const c of [game.player.char, game.sport?.opp?.char]) if (c) c.group.userData.muY = null;
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
