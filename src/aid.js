// Helping a knocked-out friend up (cops and gang members alike: police.js, gang.js). The
// downed one calls for help (callForHelp, about once a second while out cold); a free friend
// close by runs over, kneels beside him with a hand on his shoulder giving him a shake, then
// brings him round and helps him up by the arm, moving in beside him as he stands (aidStep,
// every frame, in the helper's update). He comes round helped (groggy.js: no slip on the way
// up, and it wears off sooner).
//   The helper may carry: aidThreat(game) -> true drops it (trouble close by), aidSpeed (run
// speed), aidSay(game, what) for a line ('breathing': a cop radios it in).
import * as THREE from 'three';
import { animateWalk, bendSpine, crouchPose, reachArm, restPose } from './character.js';
import { kneelPose } from './combatpose.js';
import { navStep } from './nav.js';
import { dist, lerpAngle } from './util.js';

// friends: who might come; ok(o): free to (not in a fight, a scene, a car...). Returns the helper.
export function callForHelp(D, game, friends, ok) {
  D.helpT = game.time + 1;
  if (D.t > 0 && (D.downT = (D.downT || 0) + 1) < 2) return null; // (a moment before anyone moves)
  const pool = friends.filter((o) => o !== D && !o.aid && !o.groggy && dist(o.x, o.z, D.x, D.z) < 60 && ok(o));
  if (!pool.length) return null;
  pool.sort((a, b) => dist(a.x, a.z, D.x, D.z) - dist(b.x, b.z, D.x, D.z));
  const o = pool[0];
  o.aid = D;
  o.aidSide = null;
  o.aidStage = 'go';
  o.aidT = 0;
  o.aidBest = Infinity;
  o.aidStuck = 0;
  D.helper = o;
  return o;
}

// One frame of helping. Returns true if it handled (posed and placed) the helper.
export function aidStep(o, dt, game) {
  const D = o.aid;
  const G = D.groggy;
  const lying = (D.state === 'down' && D.ko) || (G && !G.up);
  const threat = o.aidStage !== 'lift' && !!o.aidThreat?.(game);
  if (!o.standing || D.state === 'dead' || !lying || threat) {
    o.aid = null;
    if (D.helper === o) D.helper = null;
    o.crouched = false;
    restPose(o.char);
    return false;
  }
  o.aidT += dt;
  const c = o.char;
  // (where his chest is on the ground, and a spot kneeling beside it, on our side)
  const face = G ? G.face : D.char.group.rotation.x > 0 ? 'front' : 'back';
  const hs = face === 'front' ? 1 : -1; // (rolling over turns him round: the same spot either way)
  const chx = D.x + Math.sin(D.heading) * 1.23 * hs; // (his chest: 1.23 up the body from the feet)
  const chz = D.z + Math.cos(D.heading) * 1.23 * hs;
  const qx = Math.cos(D.heading) * hs;
  const qz = -Math.sin(D.heading) * hs;
  o.aidSide ??= (o.x - chx) * qx + (o.z - chz) * qz >= 0 ? 1 : -1;
  const kx = chx + qx * 0.62 * o.aidSide;
  const kz = chz + qz * 0.62 * o.aidSide;
  const tgt = (node, up = 0, wob = 0) => {
    const w = node.getWorldPosition(new THREE.Vector3());
    w.y += up;
    w.x += wob;
    return c.group.worldToLocal(w);
  };
  if (o.aidStage === 'go') {
    const far = dist(o.x, o.z, kx, kz);
    // (can't get to that side of him, a car or a wall in the way: try the other side; close
    // enough after a while: kneel where he can reach)
    o.aidStuck = far < (o.aidBest ?? Infinity) - 0.2 ? 0 : (o.aidStuck || 0) + dt;
    if (o.aidStuck === 0) o.aidBest = far;
    if (o.aidStuck > 2.5 && far > 1.3) {
      o.aidSide = -o.aidSide;
      o.aidStuck = 0;
      o.aidBest = Infinity;
    }
    if (far < 0.3 || (far < 1.3 && o.aidStuck > 0.8)) {
      o.aidBest = Infinity;
      o.aidStuck = 0;
      o.aidStage = 'check';
      o.aidT = 0;
    } else {
      const speed = far > 4 ? o.aidSpeed || 4.5 : Math.max(1, far * 1.5);
      const h = navStep(o, kx, kz, speed, dt, game, 0.35);
      if (h !== null) o.heading = lerpAngle(o.heading, h, Math.min(1, dt * 10));
      o.phase += dt * speed * 3.2;
      animateWalk(c, o.phase, Math.min(1, speed / 2));
      o.crouched = false;
      o.tw = 0;
      o.place();
      return true;
    }
  }
  if (o.aidStage === 'check') {
    // Down on a knee by him: a hand on his shoulder, shaking it; then the radio.
    o.x = kx;
    o.z = kz;
    o.heading = Math.atan2(chx - kx, chz - kz);
    restPose(c);
    animateWalk(c, 0, 0);
    o.crouched = true;
    o.gunUp = false;
    o.tw = 0;
    o.crouchY = kneelPose(c);
    bendSpine(c, 0.35, 0, 0);
    o.place();
    c.group.updateMatrixWorld(true);
    D.char.group.updateMatrixWorld(true);
    const shake = Math.sin(o.aidT * 14) * 0.05 * (o.aidT < 1.6 ? 1 : 0.3);
    reachArm(c, 'R', tgt(D.char.chest, 0.05, shake), new THREE.Vector3(-1, -0.5, -0.4), null, null, 'group');
    if (o.aidT < 1.6) reachArm(c, 'L', tgt(D.char.neck, 0, shake), new THREE.Vector3(1, -0.5, -0.4), null, null, 'group');
    else {
      // (left hand up to the radio on his shoulder, head turned to it)
      reachArm(c, 'L', new THREE.Vector3(0.14, 1.42, 0.1), new THREE.Vector3(1, -0.6, -0.3), null, null, 'group');
      c.neck.rotation.set(0.1, 0.45, 0);
      if (!o.aidRadio) {
        o.aidRadio = true;
        o.aidSay?.(game, 'breathing');
      }
    }
    if (o.aidT > 3.6) {
      D.t = 0; // (he comes round: groggy.js, helped)
      o.aidStage = 'lift';
      o.aidT = 0;
      o.aidRadio = false;
    }
    return true;
  }
  // Lift: kneeling with him while he comes to, then up with him, hands on his arm and back,
  // moving in beside him as he stands.
  const rise = D.char.group.rotation.x ? 1 - Math.min(1, Math.abs(D.char.group.rotation.x) / (Math.PI / 2)) : 1;
  const pushing = G && G.t > 2.2 + (G.rolled ? 0.8 : 0) - 0.1;
  const fx = D.x + qx * 0.58 * o.aidSide;
  const fz = D.z + qz * 0.58 * o.aidSide;
  const k = pushing ? rise : 0;
  o.x = kx + (fx - kx) * k;
  o.z = kz + (fz - kz) * k;
  D.char.group.updateMatrixWorld(true);
  const dc = D.char.chest.getWorldPosition(new THREE.Vector3());
  o.heading = lerpAngle(o.heading, Math.atan2(dc.x - o.x, dc.z - o.z), Math.min(1, dt * 6));
  restPose(c);
  animateWalk(c, 0, 0);
  o.tw = 0;
  o.gunUp = false;
  if (!pushing) {
    o.crouched = true;
    o.crouchY = kneelPose(c);
    bendSpine(c, 0.35, 0, 0);
  } else {
    o.crouched = false;
    const drop = crouchPose(c, 0.45 * (1 - k));
    bendSpine(c, 0.55 - 0.35 * k, 0, 0);
    o.place();
    c.group.position.y += drop;
  }
  if (o.crouched) o.place();
  c.group.updateMatrixWorld(true);
  const near = o.aidSide > 0 ? D.char.elbowL : D.char.elbowR;
  reachArm(c, 'L', tgt(near), new THREE.Vector3(1, -0.5, -0.4), null, null, 'group');
  reachArm(c, 'R', tgt(D.char.chest, 0.1), new THREE.Vector3(-1, -0.5, -0.4), null, null, 'group');
  return true;
}
