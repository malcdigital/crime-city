import * as THREE from 'three';
import { animateWalk, bendLeg, bendSpine, reachArm, restPose, fallPose } from './character.js';
import { carFrame } from './carscenes.js';

// Arrests, played out on you and the cops who have you (main.js bust): the cops walk up and take
// you, the cuffs go on, and BUSTED comes up after. Four ways it goes:
//   quiet   you gave up: hands up, they tell you to turn around, the first cop steps in behind
//           you, brings your hands down behind your back one at a time, cuffs, and walks you off
//           a couple of steps by the arm; the others cover you with their guns
//   car     they're rough about it: the first cop grabs you and slams you chest-down over the
//           nearest car (yours, if you were in one), pins you there, wrenches your hands behind
//           you and cuffs you, then hauls you upright; a second cop holds your other arm
//   ground  he takes you down: a tackle, you go face first, he drops a knee in your back,
//           pulls your arms behind you and cuffs you; a second cop kneels on your legs
//   beaten  you fought them: you shove the first cop off, he comes back with the baton, twice,
//           you go down, the others pile in with kicks and the baton, then a knee in your back
//           and the cuffs
// Any number of cops: the first takes you, the second helps (an arm, your legs, the beating),
// the rest stand off and cover you. Everyone's posed live, from where they actually are.
//
// arrestScene(kind, P, cops, opts) -> { len, t, update(dt) -> done, pos, cuffedAt, clear() }
//   P: your character; cops: [{ c: character, o: the officer (x, z, heading kept up to date) }]
//   opts: { car (the car for 'car'), groundY, onSlam(), onCuffed() }

const ease = (k) => k * k * (3 - 2 * k);
const seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const lerp = (a, b, k) => a + (b - a) * k;
const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function place(c, x, y, z, yaw, tip = 0) {
  c.group.rotation.order = 'YXZ';
  c.group.position.set(x, y, z);
  c.group.rotation.set(tip, yaw, 0);
}
// A hand to a world point.
function handTo(c, side, p, pole = new THREE.Vector3(side === 'L' ? 1 : -1, -0.5, -0.4)) {
  c.group.updateMatrixWorld(true);
  reachArm(c, side, c.group.worldToLocal(_v.copy(p)), pole, null, null, 'group');
}
// Where a joint is in the world.
function at(node, out = new THREE.Vector3(), up = 0) {
  node.getWorldPosition(out);
  out.y += up;
  return out;
}
// Hands up (k 0..1): high, open, by the head.
function handsUp(c, k) {
  if (k <= 0) return;
  reachArm(c, 'L', new THREE.Vector3(0.32, 1.95, 0.06).lerp(new THREE.Vector3(0.22, 0.95, 0.12), 1 - k), new THREE.Vector3(1, 0, -0.3), null, null, 'group');
  reachArm(c, 'R', new THREE.Vector3(-0.32, 1.95, 0.06).lerp(new THREE.Vector3(-0.22, 0.95, 0.12), 1 - k), new THREE.Vector3(-1, 0, -0.3), null, null, 'group');
}
// Hands behind the back, wrists together (k 0..1 from wherever: lerped from the side).
function handsBehind(c, k, from = null) {
  if (k <= 0) return;
  const L = new THREE.Vector3(0.05, 1.06, -0.2); // (at the small of the back, over the seat)
  const R = new THREE.Vector3(-0.05, 1.06, -0.2);
  const L0 = from?.L || new THREE.Vector3(0.3, 0.9, 0.05);
  const R0 = from?.R || new THREE.Vector3(-0.3, 0.9, 0.05);
  reachArm(c, 'L', L0.clone().lerp(L, k), new THREE.Vector3(1, 0, -0.6), null, null, 'group');
  reachArm(c, 'R', R0.clone().lerp(R, k), new THREE.Vector3(-1, 0, -0.6), null, null, 'group');
}
// A cop's pistol out, both hands, on a point.
function aimAt(c, p) {
  c.group.updateMatrixWorld(true);
  const t = c.group.worldToLocal(_v.copy(p));
  const d = t.clone().sub(new THREE.Vector3(0, 1.45, 0)).normalize();
  const hand = new THREE.Vector3(0, 1.42, 0).addScaledVector(d, 0.5);
  reachArm(c, 'R', hand.clone().add(new THREE.Vector3(-0.02, 0, 0)), new THREE.Vector3(-1, -0.5, 0), d, null, 'group');
  reachArm(c, 'L', hand.clone().add(new THREE.Vector3(0.05, -0.03, -0.04)), new THREE.Vector3(1, -0.5, 0), null, null, 'group');
}
// Down on one knee (the left), the right foot planted: returns how far the hips drop.
function kneel(c, k) {
  const dl = bendLeg(c.legL, c.kneeL, 0.3 * k, 2.0 * k);
  const dr = bendLeg(c.legR, c.kneeR, 1.5 * k, 1.6 * k);
  return Math.max(dl, dr) * 0.85;
}
// A baton in a cop's hand (for 'beaten').
function baton(c) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.6, 8), new THREE.MeshLambertMaterial({ color: 0x111111 }));
  m.position.set(0, -0.05, 0.22);
  m.rotation.x = Math.PI / 2;
  c.wristR.add(m);
  return m;
}
// The cuffs: a ring on each wrist and the chain between.
function cuffs(P) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xc8ccd2 });
  const out = [];
  for (const w of [P.wristL, P.wristR]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 14), mat);
    r.rotation.x = Math.PI / 2;
    r.position.set(0, -0.03, 0);
    w.add(r);
    out.push(r);
  }
  return out;
}

export function arrestScene(kind, P, cops, { car = null, groundY = (x, z) => 0, onSlam = null, onCuffed = null } = {}) {
  const p0 = [P.group.position.x, P.group.position.z];
  const gy = groundY(...p0);
  const C1 = cops[0];
  const C2 = cops[1];
  const cover = cops.slice(kind === 'quiet' ? 1 : 2);
  // (where the cops start: their own spots; anyone far off comes in from a few meters out)
  const starts = cops.map(({ c }) => {
    const x = c.group.position.x;
    const z = c.group.position.z;
    const d = Math.hypot(x - p0[0], z - p0[1]) || 1;
    const far = Math.min(d, 7);
    return [p0[0] + ((x - p0[0]) / d) * far, p0[1] + ((z - p0[1]) / d) * far];
  });
  const from1 = starts[0] || [p0[0] + 4, p0[1]];
  const toward1 = Math.atan2(from1[0] - p0[0], from1[1] - p0[1]); // (the way the first cop is)
  const props = [];
  let cuffed = null;
  const S = { len: 4.2, t: 0, pos: p0, cuffedAt: 2.6 };
  // Cover: the cops not in it stand off a few meters round you, guns on you, till you're cuffed.
  const coverStep = (t, cuffT) => {
    cover.forEach(({ c, o }, k) => {
      const i = cops.indexOf(cover[k]);
      const a = toward1 + (k % 2 ? 1 : -1) * (0.7 + 0.35 * Math.floor(k / 2)) + Math.PI * (k >= 2 ? 0.5 : 0);
      const spot = [p0[0] + Math.sin(a) * 3.2, p0[1] + Math.cos(a) * 3.2];
      const st = starts[i];
      const kk = ease(seg(t, 0, 1.1));
      const x = lerp(st[0], spot[0], kk);
      const z = lerp(st[1], spot[1], kk);
      restPose(c);
      if (kk < 1) animateWalk(c, t * 10, 0.8 * (1 - kk));
      const yaw = Math.atan2(S.pos[0] - x, S.pos[1] - z);
      place(c, x, groundY(x, z), z, yaw);
      if (t < cuffT + 0.6) aimAt(c, at(P.chest, _w));
      if (o) {
        o.x = x;
        o.z = z;
        o.heading = yaw;
      }
    });
  };
  const keep = (who, x, z, yaw) => {
    if (!who?.o) return;
    who.o.x = x;
    who.o.z = z;
    who.o.heading = yaw;
  };
  const cuffNow = (t) => {
    if (cuffed || t < S.cuffedAt) return;
    cuffed = cuffs(P);
    props.push(...cuffed);
    onCuffed?.();
  };

  if (kind === 'quiet') {
    S.len = 4.4;
    S.cuffedAt = 2.7;
    const faceCop = toward1;
    const away = faceCop + Math.PI;
    const front = [p0[0] + Math.sin(faceCop) * 1.5, p0[1] + Math.cos(faceCop) * 1.5];
    const behind = [p0[0] + Math.sin(faceCop) * 0.5, p0[1] + Math.cos(faceCop) * 0.5];
    S.step = (t) => {
      // You: hands up, turn round, hands behind, cuffed, walked off a couple of steps.
      restPose(P);
      const turn = ease(seg(t, 0.9, 1.45));
      const walk = ease(seg(t, 3.3, 4.4));
      const px = p0[0] + Math.sin(away) * 1.1 * walk;
      const pz = p0[1] + Math.cos(away) * 1.1 * walk;
      const yaw = angLerp(faceCop, away, turn);
      place(P, px, gy, pz, yaw);
      if (walk > 0 && walk < 1) animateWalk(P, t * 7, 0.5);
      const behindK = ease(seg(t, 1.8, 2.7));
      if (behindK <= 0) handsUp(P, ease(seg(t, 0, 0.5)));
      else handsBehind(P, behindK, { L: new THREE.Vector3(0.3, 1.9, 0.06), R: new THREE.Vector3(-0.3, 1.9, 0.06) });
      P.neck.rotation.set(0.1, 0, 0);
      S.pos = [px, pz];
      cuffNow(t);
      // The first cop: up in front of you, gun on you; then in behind you, takes your wrists,
      // cuffs, and a hand on your arm walking you off.
      if (C1) {
        const { c } = C1;
        restPose(c);
        let x;
        let z;
        if (t < 1.45) {
          const k = ease(seg(t, 0, 0.9));
          x = lerp(from1[0], front[0], k);
          z = lerp(from1[1], front[1], k);
          if (k < 1) animateWalk(c, t * 10, 0.8 * (1 - k));
        } else {
          const k = ease(seg(t, 1.45, 1.85));
          x = lerp(front[0], behind[0], k) + Math.sin(away) * 1.1 * walk;
          z = lerp(front[1], behind[1], k) + Math.cos(away) * 1.1 * walk;
          if (k > 0 && k < 1) animateWalk(c, t * 9, 0.5);
          if (walk > 0 && walk < 1) animateWalk(c, t * 7, 0.5);
        }
        const yaw = Math.atan2(px - x, pz - z);
        place(c, x, groundY(x, z), z, yaw);
        if (t < 1.6) aimAt(c, at(P.chest, _w));
        else if (t < 3.0) {
          handTo(c, 'L', at(P.wristL, _w));
          handTo(c, 'R', at(P.wristR, _w));
        } else {
          handTo(c, 'R', at(P.elbowR, _w));
          handTo(c, 'L', at(P.chest, _w, 0.15));
        }
        keep(C1, x, z, yaw);
      }
      coverStep(t, S.cuffedAt);
    };
  } else if (kind === 'car' && car) {
    S.len = 4.0;
    S.cuffedAt = 2.4;
    // (the slam spot: the side of the car nearest you, square to it)
    const F = carFrame(car);
    const L = car.type.l / 2 - 0.6;
    const W = car.type.w / 2;
    const dx = p0[0] - car.x;
    const dz = p0[1] - car.z;
    const c0 = Math.cos(car.heading);
    const s0 = Math.sin(car.heading);
    const lx = dx * c0 - dz * s0;
    const lz = dx * s0 + dz * c0;
    const side = lx >= 0 ? 1 : -1;
    const slam = F.w(side * (W + 0.5), Math.max(-L, Math.min(L, lz)));
    const faceCar = F.yaw(-side, 0);
    const sgy = groundY(...slam);
    const belt = (car.model?.belt || 1.0) + F.y;
    S.step = (t) => {
      restPose(P);
      // You: grabbed, shoved over to the car, slammed chest-down on it, hands wrenched behind,
      // cuffed, hauled up and turned round.
      const shove = ease(seg(t, 0.35, 0.9));
      const px = lerp(p0[0], slam[0], shove);
      const pz = lerp(p0[1], slam[1], shove);
      const up = ease(seg(t, 3.0, 3.6));
      const yaw = angLerp(angLerp(toward1 + Math.PI, faceCar, ease(seg(t, 0.3, 0.8))), faceCar + Math.PI, up);
      place(P, px, lerp(gy, sgy, shove), pz, yaw);
      if (shove > 0 && shove < 1) animateWalk(P, t * 13, 0.7);
      // (bent over the car: the chest down on it, the head turned)
      const bend = ease(seg(t, 0.82, 1.0)) * (1 - up);
      const rest = Math.max(0, (P.group.scale.y || 1) * 1.45 - (belt - sgy) + 0.1);
      bendSpine(P, bend * Math.min(1.35, 0.6 + rest), 0, 0);
      P.neck.rotation.set(-0.3 * bend, 1.0 * bend, 0);
      bendLeg(P.legL, P.kneeL, 0.15 * bend, 0.15 * bend);
      bendLeg(P.legR, P.kneeR, 0.2 * bend, 0.2 * bend);
      const behindK = ease(seg(t, 1.5, 2.3));
      if (behindK <= 0 && bend > 0) {
        // (hands down on the car first)
        reachArm(P, 'L', new THREE.Vector3(0.35, 1.0, 0.45), new THREE.Vector3(1, 0, 0), null, null, 'body');
        reachArm(P, 'R', new THREE.Vector3(-0.35, 1.0, 0.45), new THREE.Vector3(-1, 0, 0), null, null, 'body');
      } else if (behindK > 0) handsBehind(P, Math.max(behindK, up > 0 ? 1 : 0));
      S.pos = [px, pz];
      if (t >= 0.9 && !S.slammed) {
        S.slammed = true;
        onSlam?.();
      }
      cuffNow(t);
      // The first cop: grabs you, drives you into the car, pins you, the wrists, hauls you up.
      if (C1) {
        const { c } = C1;
        restPose(c);
        const k = ease(seg(t, 0, 0.45));
        const bx = px - Math.sin(faceCar) * 0.55;
        const bz = pz - Math.cos(faceCar) * 0.55;
        const x = lerp(from1[0], bx, k);
        const z = lerp(from1[1], bz, k);
        if (k < 1) animateWalk(c, t * 13, 0.9);
        const yaw = Math.atan2(px - x, pz - z);
        place(c, x, groundY(x, z), z, yaw);
        bendSpine(c, 0.45 * bend, 0, 0);
        bendLeg(c.legL, c.kneeL, 0.35 * bend, 0.5 * bend);
        if (t > 0.35) {
          handTo(c, 'L', at(P.chest, _w, 0.08));
          handTo(c, 'R', t > 1.5 && t < 3.0 ? at(P.wristR, _w) : at(P.elbowR, _w));
        }
        keep(C1, x, z, yaw);
      }
      // The second: your other arm.
      if (C2) {
        const { c } = C2;
        restPose(c);
        const k = ease(seg(t, 0.2, 1.3));
        const sx = px - Math.sin(faceCar) * 0.3 + Math.cos(faceCar) * 0.6;
        const sz = pz - Math.cos(faceCar) * 0.3 - Math.sin(faceCar) * 0.6;
        const x = lerp(starts[1][0], sx, k);
        const z = lerp(starts[1][1], sz, k);
        if (k < 1) animateWalk(c, t * 11, 0.8 * (1 - k));
        const yaw = Math.atan2(px - x, pz - z);
        place(c, x, groundY(x, z), z, yaw);
        if (t > 1.2) handTo(c, 'L', at(P.elbowL, _w));
        else aimAt(c, at(P.chest, _w));
        keep(C2, x, z, yaw);
      }
      coverStep(t, S.cuffedAt);
    };
  } else {
    // 'ground' and 'beaten': both end with you face down, a knee in your back, cuffed.
    const beaten = kind === 'beaten';
    S.len = beaten ? 5.0 : 4.0;
    S.cuffedAt = beaten ? 4.0 : 2.8;
    const fallAt = beaten ? 1.55 : 0.6;
    const fallLen = 0.9;
    const dir = toward1 + Math.PI; // (you go down facing away from him)
    const land = [p0[0] + Math.sin(dir) * 0.6, p0[1] + Math.cos(dir) * 0.6];
    const strikes = beaten ? [1.3, 1.75, 2.45, 2.75] : [];
    const kicks = beaten ? [2.25, 2.6] : [];
    let bat1 = null;
    let bat2 = null;
    if (beaten) {
      if (C1) props.push((bat1 = baton(C1.c)));
      if (C2) props.push((bat2 = baton(C2.c)));
    }
    // (a swing: up, then down through the hit at time h)
    const swing = (t, h) => {
      const u = seg(t, h - 0.3, h);
      const d = seg(t, h, h + 0.15);
      return u < 1 ? -2.9 * ease(u) : -2.9 + 2.3 * ease(d) - (d >= 1 ? 0 : 0);
    };
    S.step = (t) => {
      restPose(P);
      // You.
      const k = seg(t, fallAt, fallAt + fallLen);
      let px = lerp(p0[0], land[0], ease(k));
      let pz = lerp(p0[1], land[1], ease(k));
      if (t < fallAt) {
        // (standing: a shove at him, then the hits)
        const yaw = angLerp(toward1, toward1, 1);
        place(P, p0[0], gy, p0[1], beaten ? toward1 : dir);
        if (beaten) {
          const push = Math.sin(seg(t, 0.35, 0.8) * Math.PI);
          reachArm(P, 'L', new THREE.Vector3(0.18, 1.4, 0.25 + 0.3 * push), new THREE.Vector3(1, -0.5, 0), null, null, 'group');
          reachArm(P, 'R', new THREE.Vector3(-0.18, 1.4, 0.25 + 0.3 * push), new THREE.Vector3(-1, -0.5, 0), null, null, 'group');
          const hit = strikes.reduce((m, h) => Math.max(m, Math.exp(-(((t - h) / 0.08) ** 2))), 0);
          bendSpine(P, 0.5 * hit, 0.4 * hit, 0.2 * hit);
          P.neck.rotation.set(0.6 * hit, 0.5 * hit, 0);
        } else handsUp(P, 0.5 * ease(seg(t, 0, 0.4)));
        void yaw;
      } else {
        // (down, face first, then lying there: the hits jolt you; hands wrenched behind)
        const fp = fallPose(P, k * 1.25, 'front');
        const hit = [...strikes, ...kicks].reduce((m, h) => (h > fallAt ? Math.max(m, Math.exp(-(((t - h) / 0.07) ** 2))) : m), 0);
        place(P, px, groundY(px, pz) + 0.2 + fp.y + 0.03 * hit, pz, dir, fp.rot);
        const behindK = ease(seg(t, S.cuffedAt - 1.0, S.cuffedAt - 0.1));
        if (behindK > 0) handsBehind(P, behindK, { L: new THREE.Vector3(0.45, 1.6, 0.2), R: new THREE.Vector3(-0.45, 1.6, 0.2) });
        P.neck.rotation.y += 0.2 * hit;
      }
      S.pos = [px, pz];
      cuffNow(t);
      P.group.updateMatrixWorld(true);
      const back = at(P.chest, new THREE.Vector3());
      const hips = at(P.spine, new THREE.Vector3());
      const legs = at(P.kneeL, new THREE.Vector3());
      // The first cop.
      if (C1) {
        const { c } = C1;
        restPose(c);
        let x;
        let z;
        let y;
        const reach = ease(seg(t, 0, beaten ? 0.45 : 0.5));
        const nearP = [p0[0] + Math.sin(toward1) * 0.7, p0[1] + Math.cos(toward1) * 0.7];
        if (t < fallAt + 0.3) {
          // (in on you; beaten: shoved back a step, then in with the baton)
          const shoved = beaten ? Math.sin(seg(t, 0.55, 1.05) * Math.PI) * 0.5 : 0;
          x = lerp(from1[0], nearP[0], reach) + Math.sin(toward1) * shoved;
          z = lerp(from1[1], nearP[1], reach) + Math.cos(toward1) * shoved;
          y = groundY(x, z);
          if (reach < 1) animateWalk(c, t * 13, 0.9);
          if (!beaten) {
            // (the takedown: low, arms round your waist, driving through)
            const tk = ease(seg(t, 0.4, fallAt + 0.3));
            bendSpine(c, 0.9 * tk, 0, 0);
            bendLeg(c.legL, c.kneeL, 0.6 * tk, 0.8 * tk);
            bendLeg(c.legR, c.kneeR, 0.2 * tk, 0.5 * tk);
            if (t > 0.4) {
              handTo(c, 'L', hips);
              handTo(c, 'R', hips);
            }
          }
        } else {
          // (down on a knee beside you, the knee in your back)
          const kk = ease(seg(t, fallAt + 0.3, fallAt + 0.8));
          const side = [hips.x + Math.cos(dir) * 0.45, hips.z - Math.sin(dir) * 0.45];
          x = lerp(nearP[0], side[0], kk);
          z = lerp(nearP[1], side[1], kk);
          const drop = kneel(c, kk);
          y = groundY(x, z) - drop;
          bendSpine(c, 0.5 * kk, 0, 0);
        }
        const yaw = t < fallAt + 0.3 ? Math.atan2(p0[0] - x, p0[1] - z) : Math.atan2(back.x - x, back.z - z);
        place(c, x, y, z, yaw);
        if (beaten && t < S.cuffedAt - 1.0) {
          // (the baton: the swing on each strike)
          const h = strikes.find((s) => t > s - 0.35 && t < s + 0.2);
          c.armR.rotation.set(h ? swing(t, h) : -0.4, 0, -0.2);
          c.elbowR.rotation.set(h ? -0.3 : -0.6, 0, 0);
          if (t > fallAt + 0.3) bendSpine(c, 0.6, 0, 0);
        } else if (t >= fallAt + 0.5) {
          handTo(c, 'L', back);
          handTo(c, 'R', t > S.cuffedAt - 1.0 ? at(P.wristR, _w) : back);
        }
        keep(C1, x, z, yaw);
      }
      // The second: in on your legs (beaten: the boots and the baton first).
      if (C2) {
        const { c } = C2;
        restPose(c);
        const arrive = ease(seg(t, 0.3, fallAt + 0.9));
        const spot = [legs.x - Math.cos(dir) * 0.5, legs.z + Math.sin(dir) * 0.5];
        const x = lerp(starts[1][0], spot[0], arrive);
        const z = lerp(starts[1][1], spot[1], arrive);
        let y = groundY(x, z);
        if (arrive < 1) animateWalk(c, t * 12, 0.9 * (1 - arrive));
        const yaw = Math.atan2(hips.x - x, hips.z - z);
        if (beaten && t < S.cuffedAt - 1.2) {
          const kick = kicks.find((s) => t > s - 0.25 && t < s + 0.15);
          if (kick) bendLeg(c.legR, c.kneeR, 1.2 * Math.sin(seg(t, kick - 0.25, kick + 0.15) * Math.PI), 0.4);
          const h = strikes.find((s) => s > fallAt && t > s - 0.35 && t < s + 0.2);
          c.armR.rotation.set(h ? swing(t, h) : -0.4, 0, -0.2);
        } else if (t > fallAt + 0.9) {
          y -= kneel(c, ease(seg(t, fallAt + 0.9, fallAt + 1.3)));
          bendSpine(c, 0.5, 0, 0);
          handTo(c, 'L', legs);
          handTo(c, 'R', legs);
        }
        place(c, x, y, z, yaw);
        keep(C2, x, z, yaw);
      }
      coverStep(t, S.cuffedAt);
      void bat1;
      void bat2;
    };
  }
  S.update = (dt) => {
    S.t = Math.min(S.len, S.t + dt);
    S.step(S.t);
    return S.t >= S.len;
  };
  // (everything off again: the cuffs, the batons, everyone upright)
  S.clear = () => {
    for (const m of props) m.parent?.remove(m);
    for (const ch of [P, ...cops.map((x) => x.c)]) {
      restPose(ch);
      ch.group.rotation.set(0, ch.group.rotation.y, 0);
    }
  };
  return S;
}
