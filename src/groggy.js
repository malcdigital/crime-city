// Coming round after a knockout (main.js knockOut): the same for peds, gang members and cops.
//   stir:   still on the ground, the head rolling, a hand going to the face.
//   roll:   on the back? roll over onto the front first.
//   push:   a shaky push up off the ground (it gives halfway, then goes again).
//   steady: up, bent over with the hands on the knees, swaying.
//   stumble: a weaving, lurching walk away from you, a hand to the head, till it wears off.
// While it plays the body stays 'down' (out of fights) until it's on its feet; from the
// stumble on it counts as standing again (it can be hit, and knocked out again).
import * as THREE from 'three';
import { animateWalk, bendSpine, crouchPose, fallPose, restPose, setDown } from './character.js';
import { navStep } from './nav.js';

const STIR = 2.2;
const ROLL = 0.8;
const PUSH = 2.0;
const STEADY = 1.1;

const ease = (k) => k * k * (3 - 2 * k);
const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);

// Start coming round. standState: the state that counts as up for this kind of character;
// done(): back to its own AI once it's worn off.
export function startGroggy(e, standState, done, helped = false) {
  const c = e.char;
  const face = c.group.rotation.x > 0 ? 'front' : 'back';
  setDown(c, false); // (we pose it from here)
  e.groggy = {
    t: 0,
    face,
    standState,
    done,
    seed: Math.random() * 10,
    walk: helped ? 2.5 + Math.random() : 7 + Math.random() * 3,
    helped, // (a partner helping him up: no slip on the way up, and it wears off sooner)
    rolled: face === 'back',
    goalT: 0,
    phase: 0,
  };
  e.state = 'down';
}

function clearPose(c) {
  restPose(c);
  animateWalk(c, 0, 0);
  for (const k of ['legL', 'legR', 'kneeL', 'kneeR']) c[k].rotation.set(0, 0, 0);
}

function finish(e, ok) {
  const G = e.groggy;
  e.groggy = null;
  clearPose(e.char);
  e.char.group.rotation.set(0, e.heading, 0, 'YXZ');
  if (ok) {
    e.ko = false;
    G.done?.();
  }
}

// One frame. Returns true if it handled (posed and placed) the character this frame.
export function stepGroggy(e, dt, game) {
  const G = e.groggy;
  if (!G) return false;
  const c = e.char;
  const g = c.group;
  const lying = G.t < G.upAt;
  // Something else took over (shot dead, knocked down again, ran from gunfire): let go.
  if (e.state === 'dead' || (G.up && e.state !== G.standState) || (!G.up && e.state !== 'down')) {
    finish(e, false);
    return false;
  }
  G.t += dt;
  let t = G.t;
  const s = G.seed;
  const gy = game.city.groundY(e.x, e.z);
  const roll = G.face === 'back' ? ROLL : 0;
  const tPush = STIR + roll;
  const tSteady = tPush + PUSH;
  const tWalk = tSteady + STEADY;

  if (t < STIR) {
    // Still down: the landed pose, coming to.
    const f = fallPose(c, 1.3, G.face);
    const k = seg(t, 0.4, STIR);
    c.neck.rotation.y = c.neck.rotation.y * (1 - k) + Math.sin(t * 2.3 + s) * 0.45 * k;
    // (a hand drifting up to the face)
    const h = ease(seg(t, 0.9, 1.8)) * (1 - ease(seg(t, STIR - 0.3, STIR)));
    c.armR.rotation.x += (-2.3 - c.armR.rotation.x) * h;
    c.armR.rotation.z *= 1 - h;
    c.elbowR.rotation.x += (-2.2 - c.elbowR.rotation.x) * h;
    // (a knee drawn up)
    c.kneeL.rotation.x += 0.25 * Math.sin(seg(t, 0.6, 2.0) * Math.PI);
    g.rotation.set(f.rot, e.heading, 0, 'YXZ');
    g.position.set(e.x, gy + 0.2, e.z);
    return true;
  }
  if (t < tPush) {
    // On the back: roll over onto the front, about the body's length.
    const k = ease(seg(t, STIR, tPush));
    fallPose(c, 1.3, 'back');
    // (arms come in under the chest, legs straight)
    for (const [sh, el] of [[c.armL, c.elbowL], [c.armR, c.elbowR]]) {
      sh.rotation.x += (-1.5 - sh.rotation.x) * k;
      sh.rotation.z *= 1 - k;
      el.rotation.x *= 1 - k;
    }
    for (const j of [c.legL, c.legR, c.kneeL, c.kneeR]) {
      j.rotation.x *= 1 - k;
      j.rotation.z *= 1 - k;
    }
    c.neck.rotation.y *= 1 - k;
    _qa.setFromAxisAngle(_Y, e.heading).multiply(_qb.setFromAxisAngle(_X, -Math.PI / 2)).multiply(_qb.setFromAxisAngle(_Y, Math.PI * k));
    g.quaternion.copy(_qa);
    g.position.set(e.x, gy + 0.2 + 0.08 * Math.sin(Math.PI * k), e.z);
    return true;
  }
  if (G.face === 'back') {
    // (rolled over: now face down, head the other way)
    G.face = 'front';
    e.heading += Math.PI;
  }
  if (t < tSteady) {
    // Push up off the ground, pivoting on the feet; it gives once on the way.
    const u = seg(t, tPush, tSteady);
    const k = G.helped ? ease(u) : ease(seg(u, 0, 0.45)) * 0.55 - 0.12 * Math.sin(Math.PI * seg(u, 0.4, 0.62)) + ease(seg(u, 0.62, 1)) * 0.45;
    const eLie = 1 - Math.max(0, Math.min(1, k)); // 1 lying -> 0 up
    const lean = (Math.PI / 2) * eLie;
    restPose(c);
    const bend = Math.sin(Math.PI * (1 - eLie)) * 0.6;
    const drop = crouchPose(c, bend);
    c.armL.rotation.x = c.armR.rotation.x = -0.4 - 1.1 * eLie;
    c.elbowL.rotation.x = c.elbowR.rotation.x = -0.3 * Math.sin(Math.PI * seg(u, 0.3, 0.7));
    c.neck.rotation.set(-0.3 * eLie, 0, Math.sin(t * 3 + s) * 0.15);
    g.rotation.set(lean, e.heading, Math.sin(t * 2.6 + s) * 0.05 * (1 - eLie), 'YXZ');
    g.position.set(e.x, gy + 0.2 * Math.sin(lean) + drop * Math.cos(lean), e.z);
    return true;
  }
  if (!G.up) {
    G.up = true;
    e.state = G.standState; // on its feet: standing again
  }
  const sway = Math.sin(t * 1.9 + s) + 0.4 * Math.sin(t * 3.7 + s * 2);
  if (t < tWalk && !walkable(game, e.x, e.z)) G.t = t = tWalk; // (up in the road: no pause, off it)
  if (t < tWalk) {
    // Bent over, hands on the knees, catching itself.
    const k = 1 - ease(seg(t, tWalk - 0.4, tWalk));
    restPose(c);
    const drop = crouchPose(c, 0.28 * k);
    bendSpine(c, 0.75 * k + 0.15, 0, sway * 0.12);
    c.armL.rotation.x = c.armR.rotation.x = -0.75 * k;
    c.armL.rotation.z = 0.12 * k;
    c.armR.rotation.z = -0.12 * k;
    c.elbowL.rotation.x = c.elbowR.rotation.x = -0.15;
    c.neck.rotation.set(-0.35 * k, 0, sway * 0.15);
    g.rotation.set(0, e.heading, sway * 0.05, 'YXZ');
    g.position.set(e.x, gy + drop, e.z);
    return true;
  }
  const w = t - tWalk;
  if (w > G.walk) {
    finish(e, true);
    return false;
  }
  // Stumbling off: away from you, weaving, the odd lurch to the side; but kept out of the
  // traffic: on the sidewalk it picks a way that stays on it, and catches itself at the curb;
  // in the street it makes for the nearest sidewalk first.
  G.goalT -= dt;
  const [px, pz] = game.player.pos();
  const onWalk = walkable(game, e.x, e.z);
  if (G.goalT <= 0 || onWalk !== G.wasWalk) {
    G.goalT = 0.7;
    G.wasWalk = onWalk;
    const away = Math.atan2(e.x - px, e.z - pz);
    const goal = onWalk ? walkGoal(game, e, away + Math.sin(w * 0.9 + s) * 0.9) : curbGoal(game, e, away);
    G.gx = goal ? goal[0] : e.x;
    G.gz = goal ? goal[1] : e.z;
    G.stuck = !goal;
  }
  const lurch = G.stuck ? 0 : Math.max(0, Math.sin(w * 1.6 + s * 3)) ** 6; // (a stagger every few seconds)
  const fade = Math.min(1, (G.walk - w) / 2); // (steadier toward the end)
  let speed = G.stuck ? 0 : (0.8 + 0.25 * Math.sin(w * 2.3 + s) + 0.9 * lurch) * (1.3 - 0.3 * fade);
  if (!onWalk) speed = Math.max(speed, 2.1); // (hurry out of the road)
  const ox = e.x;
  const oz = e.z;
  const h = navStep(e, G.gx, G.gz, speed, dt, game, 0.35);
  if (onWalk && !walkable(game, e.x, e.z)) {
    // (at the curb: catch yourself, and go another way)
    e.x = ox;
    e.z = oz;
    G.goalT = 0;
  }
  if (h !== null) {
    let d = h - e.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    e.heading += d * Math.min(1, dt * 2.5);
  }
  if (e.speed !== undefined) e.speed = speed;
  G.phase += dt * speed * (4 + 1.5 * Math.sin(w * 3.1 + s));
  animateWalk(c, G.phase, 0.75);
  // (knees soft, back hunched, leaning the way it sways)
  c.kneeL.rotation.x += 0.15 * fade;
  c.kneeR.rotation.x += 0.15 * fade;
  bendSpine(c, 0.22 * fade + 0.05, 0, (sway * 0.25 + lurch * 0.3) * fade);
  c.neck.rotation.set(0.3 * fade, Math.sin(w * 1.1 + s) * 0.25 * fade, -sway * 0.2 * fade);
  // (a hand to the head for a while, the other arm out for balance on a lurch)
  const hand = fade * (1 - ease(seg(w, G.walk * 0.55, G.walk * 0.7)));
  c.armR.rotation.x += (-2.0 - c.armR.rotation.x) * hand;
  c.armR.rotation.z = -0.45 * hand;
  c.elbowR.rotation.x += (-2.25 - c.elbowR.rotation.x) * hand;
  c.armL.rotation.z = 0.15 + 0.55 * lurch;
  g.rotation.set(0, e.heading, (sway * 0.06 + lurch * 0.08) * fade, 'YXZ');
  g.position.set(e.x, gy - 0.04 * fade, e.z);
  return true;
}

// Somewhere off the street: a block's sidewalk or a lot, not a road or a freeway ramp.
function walkable(game, x, z) {
  const b = game.city.blockAt(x, z);
  return !!b && b.type !== 'ramps';
}

// A way to stumble that stays off the street for a few metres (as near `dir` as it can).
function walkGoal(game, e, dir) {
  for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
    const a = dir + off;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    if ([1.5, 3, 4.5].every((d) => walkable(game, e.x + sx * d, e.z + sz * d))) return [e.x + sx * 4.5, e.z + sz * 4.5];
  }
  return null;
}

// In the street: the nearest bit of sidewalk (a little past the curb), away from you if it's a tie.
function curbGoal(game, e, away) {
  for (let d = 1; d <= 16; d += 1) {
    let best = null;
    for (let i = 0; i < 16; i++) {
      const a = away + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * (Math.PI / 8);
      const x = e.x + Math.sin(a) * d;
      const z = e.z + Math.cos(a) * d;
      if (walkable(game, x, z)) {
        best = [e.x + Math.sin(a) * (d + 1), e.z + Math.cos(a) * (d + 1)];
        break;
      }
    }
    if (best) return best;
  }
  return null;
}
