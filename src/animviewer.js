import * as THREE from 'three';
import { makeCharacter, animateWalk, crouchPose, crouchWalk, lam } from './character.js';
import { aimPose, lowReady, fightStance, markPunch, punchPose, markFlinch, flinchPose, markRecoil, reloadPose, kneelPose } from './combatpose.js';
import { shotForm, dribbleArm } from './streetball.js';
import { dunkPose, dunkPhase } from './dunkpose.js';
import { markJump, jumpPose } from './blockpose.js';
import { readyPose, boxOutPose, markGrab, grabPose } from './reboundpose.js';
import { markReach, reachPose } from './reachpose.js';
import { markPass, markCatch, passPose, handsAt, holdPose } from './passpose.js';
import { ballMesh } from './court.js';

// The animation viewer: every pose and move in the game, one at a time, on a character in an
// empty little set (the game's paused under it). Open it from the pause menu (or V / □ while
// paused). ◀ ▶ (arrows, D-pad, or a swipe) step through; pause and slow-mo to look closely;
// drag to turn the camera round; ✕ / Esc / ○ to close.

const _v = new THREE.Vector3();
const ease = (k) => k * k * (3 - 2 * k);
const clamp01 = (k) => Math.max(0, Math.min(1, k));

// Each: [group, name, loop length (s), run(c, t, S) → { y, gun, ball: [x,y,z] | 'hands' | null, turn }]
// t: seconds into this loop; S: the viewer (S.mark(t, fn): once a loop, at t).
function list(game) {
  const sb = game.sport;
  const sweep = (t, T) => Math.sin((t / T) * Math.PI * 2);
  const once = (S, at, fn) => S.once(at, fn);
  const jumpY = (t, t0, T, h) => (t > t0 && t < t0 + T ? h * Math.sin(((t - t0) / T) * Math.PI) : 0);
  return [
    // ---- Moving ----
    ['Moving', 'Idle', 2, (c, t) => ({ y: 0.012 * Math.sin(t * 3) })],
    ['Moving', 'Walk', 1.2, (c, t) => { animateWalk(c, t * 5.2, 0.6); return { y: 0 }; }],
    ['Moving', 'Run', 0.8, (c, t) => { animateWalk(c, t * 7.85, 1); return { y: Math.abs(Math.sin(t * 7.85)) * 0.05 }; }],
    ['Moving', 'Crouch walk (sneaking)', 1.4, (c, t) => ({ y: crouchWalk(c, (t / 1.4) * Math.PI * 2, 1) })],
    ['Moving', 'Crouched, still', 2, (c) => ({ y: crouchWalk(c, 0, 0) })],
    // ---- Guns ----
    ['Guns', 'Pistol: aim (looking up and down)', 4, (c, t) => { return { gun: 'pistol', turn: aimPose(c, 'pistol', 0.45 * sweep(t, 4), 99) }; }],
    ['Guns', 'Pistol: firing', 1.4, (c, t, S) => { [0.2, 0.6, 1.0].forEach((a) => once(S, a, () => markRecoil(c, S.now))); return { turn: aimPose(c, 'pistol', 0, S.now), gun: 'pistol', flash: S.since(0.2, 0.6, 1.0) }; }],
    ['Guns', 'Pistol: reload', 1.6, (c, t) => { return { gun: 'pistol', turn: reloadPose(c, 'pistol', clamp01(t / 1.2)) }; }],
    ['Guns', 'Rifle: aim', 4, (c, t) => { return { gun: 'rifle', turn: aimPose(c, 'rifle', 0.35 * sweep(t, 4), 99) }; }],
    ['Guns', 'Rifle: full auto', 1.2, (c, t, S) => { for (let k = 0; k < 8; k++) once(S, 0.1 + k * 0.11, () => markRecoil(c, S.now)); return { turn: aimPose(c, 'rifle', 0, S.now), gun: 'rifle', flash: t > 0.1 && t < 1.0 && (t * 9) % 1 < 0.35 }; }],
    ['Guns', 'Rifle: reload', 2.4, (c, t) => { return { gun: 'rifle', turn: reloadPose(c, 'rifle', clamp01(t / 2.0)) }; }],
    ['Guns', 'Shotgun: firing', 1.6, (c, t, S) => { once(S, 0.3, () => markRecoil(c, S.now)); once(S, 1.1, () => markRecoil(c, S.now)); return { turn: aimPose(c, 'shotgun', 0, S.now), gun: 'shotgun', flash: S.since(0.3, 1.1) }; }],
    ['Guns', 'SMG: aim', 3, (c, t) => { return { gun: 'smg', turn: aimPose(c, 'smg', 0.25 * sweep(t, 3), 99) }; }],
    ['Guns', 'Rifle: carried (walking)', 1.2, (c, t) => { animateWalk(c, t * 5.2, 0.6); lowReady(c, 'rifle'); return { gun: 'rifle' }; }],
    ['Guns', 'Kneeling aim', 3, (c, t) => { const y = kneelPose(c); return { y, gun: 'rifle', turn: aimPose(c, 'rifle', 0.2 * sweep(t, 3), 99) }; }],
    // ---- Fighting ----
    ['Fighting', 'Fighting stance', 2, (c, t, S) => ({ y: fightStance(c, S.now), turn: punchPose(c, S.now) })],
    ['Fighting', 'Jab', 1, (c, t, S) => { const y = fightStance(c, S.now); once(S, 0.2, () => markPunch(c, S.now, 'jab', 0.3)); return { y, turn: punchPose(c, S.now) }; }],
    ['Fighting', 'Cross', 1, (c, t, S) => { const y = fightStance(c, S.now); once(S, 0.2, () => markPunch(c, S.now, 'cross', 0.3)); return { y, turn: punchPose(c, S.now) }; }],
    ['Fighting', 'Hook', 1.1, (c, t, S) => { const y = fightStance(c, S.now); once(S, 0.2, () => markPunch(c, S.now, 'hook', 0.4)); return { y, turn: punchPose(c, S.now) }; }],
    ['Fighting', 'Combo: jab, cross, jab, hook', 2.2, (c, t, S) => { const y = fightStance(c, S.now); [['jab', 0.15], ['cross', 0.5], ['jab', 0.9], ['hook', 1.25]].forEach(([k, a]) => once(S, a, () => markPunch(c, S.now, k, k === 'hook' ? 0.4 : 0.3))); return { y, turn: punchPose(c, S.now) }; }],
    ['Fighting', 'Punched (flinch)', 1.1, (c, t, S) => { once(S, 0.3, () => markFlinch(c, S.now, 'hit')); flinchPose(c, S.now); return {}; }],
    ['Fighting', 'Shot (hit, still up)', 1.1, (c, t, S) => { once(S, 0.3, () => markFlinch(c, S.now, 'shot')); flinchPose(c, S.now); return {}; }],
    ['Fighting', 'Shot down: falls back', 2, (c, t) => S_fall(c, t, -1)],
    ['Fighting', 'Shot from behind: falls forward', 2, (c, t) => S_fall(c, t, 1)],
    // ---- Basketball ----
    ['Basketball', 'Dribble (stance)', 1.2, (c, t) => { const ph = t * 9; dribbleArm(c, 1, ph, 0); const y = sb ? sb.dribblePose(c, 0, null, 0, 1, false) : crouchPose(c, 0.28); return { y, ball: [-0.32, 0.2 + Math.abs(Math.sin(ph)) * 0.75, 0.35] }; }],
    ['Basketball', 'Crossover', 1, (c, t) => { const T = 0.45; const k = Math.min(1, t / T); const side = Math.floor(t / 1) % 2 ? -1 : 1; dribbleArm(c, k < 0.5 ? side : -side, t * 9, 0); const y = sb ? sb.dribblePose(c, 0, t < T ? { kind: 'cross', t, T, to: -side, from: side } : null, 0, -side, false) : 0; return { y, ball: [(k < 0.5 ? -0.32 : 0.32) * side, 0.2 + Math.abs(Math.sin(t * 9)) * 0.7, 0.35] }; }],
    ['Basketball', 'Hesitation', 1.1, (c, t) => { const T = 0.48; const y = sb ? sb.dribblePose(c, 0, t < T ? { kind: 'hesi', t, T, from: 1 } : null, 0, 1, false) : 0; dribbleArm(c, 1, t * 7, 0); return { y, ball: [-0.34, 0.2 + Math.abs(Math.sin(t * 7)) * 0.7, 0.4] }; }],
    ['Basketball', 'Spin move', 1.1, (c, t) => { const T = 0.48; const y = sb ? sb.dribblePose(c, 0, t < T ? { kind: 'spin', t, T, from: 1, to: -1 } : null, 0, -1, false) : 0; return { y, turn: t < T ? -Math.PI * 2 * ease(t / T) : 0, ball: 'hands' }; }],
    ['Basketball', 'Jump shot', 1.8, (c, t) => {
      const rel = 0.55;
      const g0 = rel - 0.25;
      const f = t >= rel ? t - rel : -1;
      const jump = jumpY(t, g0, 0.55, 0.45);
      const r = shotForm(c, { kind: 'jumper', hand: 1, g: (t - 0.1) / 0.14, u: t <= g0 ? 0 : Math.min(1, (t - g0) / 0.25), f, air: jump > 0.02, land: f > 0.3 && jump <= 0.02 ? f - 0.3 : -1 });
      return { y: jump + r.y, ball: t < rel ? 'shoot' : [0, 2.4 + (t - rel) * 2.2 - (t - rel) * (t - rel) * 4, 0.6 + (t - rel) * 5] };
    }],
    ['Basketball', 'Layup', 1.6, (c, t) => {
      const g0 = 0.35;
      const jump = jumpY(t, g0, 0.7, 0.6);
      const r = shotForm(c, { kind: 'layup', hand: 1, g: t / 0.15, u: t <= g0 ? 0 : Math.min(1, (t - g0) / 0.35), f: t > 0.75 ? t - 0.75 : -1, air: jump > 0.02 });
      return { y: jump + r.y, ball: t < 0.75 ? 'shoot' : null };
    }],
    ...['two', 'one', 'windmill', 'tomahawk'].map((style) => ['Basketball', `Dunk: ${style === 'two' ? 'two hands' : style === 'one' ? 'one hand' : style}`, 2.2, (c, t) => {
      const P = dunkPhase(Math.max(0, t - 0.2), 0.45, 0.4, 0.32);
      const r = dunkPose(c, style, P.ph, P.k, 1);
      const h = P.ph === 'rise' ? 0.95 * Math.sin((P.k * Math.PI) / 2) : P.ph === 'hang' ? 0.95 : 0.95 * (1 - P.k * P.k);
      return { y: (t < 0.2 ? 0 : h) + r.y, ball: P.ph === 'rise' ? 'hands' : null };
    }]),
    ['Basketball', 'Pass', 1.2, (c, t, S) => { once(S, 0.25, () => markPass(c, S.now)); holdPose(c); passPose(c, S.now); return { ball: t < 0.4 ? 'hands' : [0, 1.2, 0.5 + (t - 0.4) * 9] }; }],
    ['Basketball', 'Catch', 1.2, (c, t, S) => { once(S, 0, () => markCatch(c, S.now + 0.5)); passPose(c, S.now); return { ball: t < 0.5 ? [0, 1.2, 4.5 - t * 8] : 'hands' }; }],
    ['Basketball', 'Rebound: hands up, ready', 1.5, (c) => { readyPose(c); return { y: crouchPose(c, 0.2) }; }],
    ['Basketball', 'Rebound: going up for it', 1.6, (c, t, S) => { once(S, 0.2, () => markJump(c, S.now, 0.75, 'rebound', 1)); const y = jumpPose(c, S.now) || 0; return { y: y + jumpY(t, 0.3, 0.6, 0.55) }; }],
    ['Basketball', 'Rebound: snatching it', 1.2, (c, t, S) => { once(S, 0.2, () => markGrab(c, S.now, true)); const y = grabPose(c, S.now) || 0; return { y, ball: t > 0.2 ? 'hands' : [0, 2.4, 0.4] }; }],
    ['Basketball', 'Box out', 1.4, (c, t) => ({ y: boxOutPose(c, t * 6, true) })],
    ['Basketball', 'Block', 1.5, (c, t, S) => { once(S, 0.2, () => markJump(c, S.now, 0.8, 'block', 1)); const y = jumpPose(c, S.now) || 0; return { y: y + jumpY(t, 0.3, 0.65, 0.7) }; }],
    ['Basketball', 'Reach-in (steal)', 1.2, (c, t, S) => { once(S, 0.2, () => markReach(c, S.now, 1, false, true)); const d = sb ? sb.defensePose(c, 0, 0, 0, 0, 0) : crouchPose(c, 0.5); const r = reachPose(c, S.now, 0); return { y: (d || 0) + (r || 0) }; }],
    ['Basketball', 'Defense: sliding', 1.2, (c, t) => ({ y: sb ? sb.defensePose(c, 0, Math.sin(t * 5.2) * 2.2, 0, t * 9, 0) : 0, slide: Math.sin(t * 5.2) * 0.5 })],
    ['Basketball', 'Defense: hands up (contest)', 1.5, (c) => ({ y: sb ? sb.defensePose(c, 0, 0, 0, 0, 0, true) : 0 })],
    // ---- Around town ----
    ['Around town', 'On the phone', 2, (c) => { c.armR.rotation.x = -2.5; c.elbowR.rotation.x = -2.2; return {}; }],
    ['Around town', 'Waving you down', 1, (c, t) => { c.armR.rotation.x = -2.6 + Math.sin(t * 9) * 0.45; return {}; }],
    ['Around town', 'Hands up (cowering)', 2, (c) => { c.armL.rotation.x = c.armR.rotation.x = -2.7; return { y: crouchPose(c, 1) }; }],
    ['Around town', 'Cheering', 1, (c, t) => { c.armL.rotation.x = c.armR.rotation.x = -2.9; c.elbowL.rotation.x = c.elbowR.rotation.x = -0.3 * Math.abs(Math.sin(t * 6)); return { y: Math.abs(Math.sin(t * 6)) * 0.12 }; }],
  ];
}

// Shot down: tipping over backward (dir -1) or forward (1), arms coming up, lying there.
function S_fall(c, t, dir) {
  const k = clamp01((t - 0.3) / 0.45);
  c.group.rotation.x = dir * (Math.PI / 2) * k * k;
  const a = Math.sin(k * Math.PI) * 0.9;
  c.armL.rotation.x = c.armR.rotation.x = -a;
  if (t < 0.3) {
    c.armR.rotation.x = -0.7;
    c.elbowR.rotation.x = -1.9;
  }
  return { y: 0.2 * k };
}

const JOINTS = ['armL', 'armR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'legL', 'legR', 'kneeL', 'kneeR'];

export class AnimViewer {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.i = 0;
  }

  build() {
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x1a2130);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2a33, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), lam(0x3c5a7a));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.66, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    scene.add(ring);
    const c = (this.c = makeCharacter({ shirt: 0x1e7d32, pants: 0x1b1b1b, skin: 0x8d5524, bandana: 0x1e7d32 }));
    scene.add(c.group);
    this.guns = {};
    for (const [id, [w, h, l, col]] of Object.entries({ pistol: [0.08, 0.14, 0.32, 0x1a1a1a], smg: [0.1, 0.18, 0.6, 0x2a2a2a], rifle: [0.1, 0.2, 0.95, 0x2b2f26], shotgun: [0.11, 0.15, 0.9, 0x4a3420] })) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), lam(col));
      g.position.set(0, -0.04, 0);
      g.rotation.x = Math.PI / 2;
      g.visible = false;
      c.wristR.add(g);
      this.guns[id] = g;
    }
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    scene.add(this.flash);
    this.ball = ballMesh();
    scene.add(this.ball);
    this.cam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 50);
    this.list = list(this.game);
    // The panel.
    const el = (this.el = document.createElement('div'));
    el.id = 'animview';
    el.innerHTML = `<div class="av-top"><b>ANIMATIONS</b><span class="av-n"></span><button class="av-x" aria-label="close">✕</button></div>
      <div class="av-bar"><button class="av-prev" aria-label="previous">◀</button><div class="av-name"><small></small><span></span></div><button class="av-next" aria-label="next">▶</button></div>
      <div class="av-tools"><button class="av-play">❚❚ PAUSE</button><button class="av-slow">½ SLOW</button></div>
      <div class="av-hint"></div>`;
    document.body.appendChild(el);
    const btn = (q, f) => el.querySelector(q).addEventListener('click', (e) => {
      e.stopPropagation();
      f();
    });
    btn('.av-x', () => this.hide());
    btn('.av-prev', () => this.go(-1));
    btn('.av-next', () => this.go(1));
    btn('.av-play', () => this.togglePlay());
    btn('.av-slow', () => this.toggleSlow());
    // Drag to turn round it; a quick swipe sideways steps through.
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      drag = { x: e.clientX, y: e.clientY, t: e.timeStamp, yaw: this.yaw, moved: 0 };
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      this.yaw = drag.yaw - dx * 0.01;
      this.userYawT = 3;
    });
    const up = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (e.timeStamp - drag.t < 300 && Math.abs(dx) > 50) {
        this.yaw = drag.yaw;
        this.go(dx < 0 ? 1 : -1);
      }
      drag = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  show() {
    if (!this.scene) this.build();
    this.open = true;
    this.yaw = 0.6;
    this.userYawT = 0;
    this.playing = true;
    this.speed = 1;
    this.el.classList.remove('hidden');
    document.body.classList.add('animview-on');
    this.select(this.i);
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('animview-on');
  }

  go(d) {
    this.select((this.i + d + this.list.length) % this.list.length);
  }

  select(i) {
    this.i = i;
    this.t = 0;
    this.now = 100;
    this.fired = new Set();
    this.loopN = 0;
    const [group, name] = this.list[i];
    this.el.querySelector('.av-name small').textContent = group.toUpperCase();
    this.el.querySelector('.av-name span').textContent = name;
    this.el.querySelector('.av-n').textContent = `${i + 1} / ${this.list.length}`;
    const g = this.game;
    const how = g.input.touchMode ? 'swipe or ◀ ▶ · drag to turn it round' : g.input.mode === 'pad' ? 'D-pad ◀ ▶ · ✕ pause · □ slow · right stick turns it · ○ close' : '← → · Space pause · S slow · drag to turn it round · Esc close';
    this.el.querySelector('.av-hint').textContent = how;
    const u = this.c.group.userData;
    for (const k of Object.keys(u)) delete u[k];
  }

  togglePlay() {
    this.playing = !this.playing;
    this.el.querySelector('.av-play').textContent = this.playing ? '❚❚ PAUSE' : '▶ PLAY';
  }

  toggleSlow() {
    this.speed = this.speed === 1 ? 0.25 : 1;
    this.el.querySelector('.av-slow').classList.toggle('on', this.speed < 1);
  }

  // Once a loop, when the loop's clock passes `at`.
  once(at, fn) {
    const key = `${this.loopN}:${at}`;
    if (this.t >= at && !this.fired.has(key)) {
      this.fired.add(key);
      fn();
    }
  }

  // A muzzle flash for a frame or two after any of these times in the loop.
  since(...at) {
    return at.some((a) => this.t >= a && this.t < a + 0.05);
  }

  update(dt, a) {
    if (!this.open) return;
    if (a.menuBack || a.pause) return this.hide();
    if (a.menuLeft || a.phoneLeft) this.go(-1);
    if (a.menuRight || a.phoneRight) this.go(1);
    if (a.menuOk || a.dealYes) this.togglePlay();
    if (a.reload || this.game.input.hit?.('KeyS')) this.toggleSlow();
    if (Math.abs(a.lookX) > 0.0001) {
      this.yaw -= a.lookX;
      this.userYawT = 3;
    }
    const step = this.playing ? Math.min(dt, 0.05) * this.speed : 0;
    const [, , T, run] = this.list[this.i];
    this.t += step;
    this.now += step;
    if (this.t >= T) {
      this.t -= T;
      this.loopN += 1;
      this.fired = new Set();
    }
    this.userYawT = Math.max(0, this.userYawT - dt);
    if (this.userYawT <= 0) this.yaw += dt * 0.25; // (turning slowly on its own)
    // Pose it from scratch.
    const c = this.c;
    for (const j of JOINTS) c[j].rotation.set(0, 0, 0);
    c.group.rotation.set(0, 0, 0);
    c.spine.rotation.set(0, 0, 0);
    c.group.rotation.order = 'YXZ';
    c.group.position.set(0, 0, 0);
    for (const g of Object.values(this.guns)) g.visible = false;
    const r = run(c, this.t, this) || {};
    c.group.position.y += r.y || 0;
    c.group.position.x += r.slide || 0;
    c.group.rotation.y = r.turn || 0;
    if (r.gun) this.guns[r.gun].visible = true;
    // The muzzle flash at the end of the barrel.
    this.flash.visible = !!(r.gun && r.flash);
    if (this.flash.visible) {
      const g = this.guns[r.gun];
      c.group.updateMatrixWorld(true);
      g.localToWorld(_v.set(0, 0, g.geometry.parameters.depth / 2 + 0.06));
      this.flash.position.copy(_v);
    }
    // The ball: in the hands, set to shoot, at a spot (character space), or put away.
    this.ball.visible = !!r.ball;
    if (r.ball === 'hands' || r.ball === 'shoot') {
      handsAt(c, _v);
      this.ball.position.set(_v.x, _v.y + (r.ball === 'shoot' ? 0.1 : 0), _v.z + 0.08);
    } else if (r.ball) this.ball.position.set(r.ball[0], r.ball[1], r.ball[2]);
    // The camera round it.
    const cam = this.cam;
    // (following him up on a jump or a dunk, eased so it doesn't jerk)
    const lift = Math.max(0, c.group.position.y);
    this.camY = (this.camY ?? 0) + (lift * 0.85 - (this.camY ?? 0)) * Math.min(1, dt * 7);
    const dist = (4.6 + this.camY * 0.6) * (this.zoom || 1); // (zoom: a closer look, for tests)
    cam.aspect = innerWidth / innerHeight;
    cam.fov = innerWidth / innerHeight < 1.2 ? 60 : 42;
    cam.updateProjectionMatrix();
    cam.position.set(Math.sin(this.yaw) * dist, 1.6 + this.camY, Math.cos(this.yaw) * dist);
    cam.lookAt(0, 1.05 + this.camY + (1 - (this.zoom || 1)) * 0.6, 0);
  }

  render(renderer) {
    renderer.render(this.scene, this.cam);
  }
}
