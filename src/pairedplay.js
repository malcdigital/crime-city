import * as THREE from 'three';
import { applyClip, alignedOrigin, JOINTS } from './paired.js';

// The paired animations in the game (authored together, exported apart: src/paired.js, the
// clips in src/anims/paired/). A pair starts from wherever the two of them are:
//   startPair(name, A, B, { at, mirror, now }) → { a, b }: a play for each, the anchor (A: the
//   runner, the receiver) from where he is, the partner (B: the tackler, the defender) on the
//   clip's alignment from him, blended in from where he really is over BLEND seconds; at: the
//   moment in the clip to start from (an event name, less LEAD, or seconds).
//   playClip(c, play, now, rise) poses one character from his play; rise 0..1 brings a man who
//   ends down on the turf back up to his feet (the get-up). Returns the root (world) and done.
// A and B: anything with x, z, heading and char (the NPCs, you).

const FILES = import.meta.glob('./anims/paired/*.json', { eager: true, import: 'default' });
export const PAIRED = {};
for (const [path, data] of Object.entries(FILES)) {
  const [, name, part] = path.match(/([\w-]+)\.(\w+)\.json$/);
  PAIRED[name] ||= { clips: {} };
  if (part === 'pair') PAIRED[name].pair = data;
  else PAIRED[name].clips[part] = data;
}

const LEAD = 0.1; // (a tackle starts this long before contact: it fires as they meet)
const BLEND = 0.22; // (seconds to blend in from where he really is)

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _up = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();

// (a clip's root at t (mirrored or not): its position and facing, from its own start)
function rootAt(clip, t, mirror) {
  const f = Math.max(0, Math.min(clip.frames - 1, Math.round(t * clip.fps)));
  const r = clip.root[f];
  _q.set(r[3], r[4], r[5], r[6]);
  if (mirror) _q.set(_q.x, -_q.y, -_q.z, _q.w);
  _e.setFromQuaternion(_q, 'YXZ');
  return { x: mirror ? -r[0] : r[0], z: r[2], yaw: _e.y };
}
// (the world point an origin and a clip-space point make)
const place = (o, x, z) => [o.x + Math.cos(o.yaw) * x + Math.sin(o.yaw) * z, o.z - Math.sin(o.yaw) * x + Math.cos(o.yaw) * z];
const joints = (c) => JOINTS.map((j) => c[j].quaternion.clone());

export function startPair(name, A, B, { at = 0, mirror = false, now = 0, maxTurn = 1.2 } = {}) {
  const P = PAIRED[name];
  if (!P) return null;
  const { pair, clips } = P;
  const [nA, nB] = pair.actors;
  let start = typeof at === 'string' ? Math.max(0, pair.events[at] / pair.fps - LEAD) : at;
  if (typeof at === 'string') {
    // (from the frame, up to that moment, where they're as far apart in the clip as they are
    // now: so he's blended in from about where he is, not dragged through the other man)
    const d = Math.hypot(B.x - A.x, B.z - A.z);
    const o0 = { x: 0, z: 0, yaw: 0 };
    const oB0 = alignedOrigin(pair, nB, o0, mirror);
    let best = Infinity;
    for (let f = 0; f <= pair.events[at]; f++) {
      const ra = rootAt(clips[nA], f / pair.fps, mirror);
      const rb = rootAt(clips[nB], f / pair.fps, mirror);
      const [bx, bz] = place(oB0, rb.x, rb.z);
      const e = Math.abs(Math.hypot(bx - ra.x, bz - ra.z) - d);
      if (e < best) {
        best = e;
        start = f / pair.fps;
      }
    }
  }
  // (the anchor: his clip's root at the start put where he is now, facing his way, then the
  // pair turned round him so the partner's start is the way the partner really is from him;
  // the anchor's own facing comes round that bit over the blend, never a man dragged through
  // the other)
  const rA = rootAt(clips[nA], start, mirror);
  const rB0 = rootAt(clips[nB], start, mirror);
  const oB0 = alignedOrigin(pair, nB, { x: 0, z: 0, yaw: 0 }, mirror);
  const [cbx, cbz] = place(oB0, rB0.x, rB0.z);
  const inClip = Math.atan2(cbx - rA.x, cbz - rA.z) - rA.yaw; // (the partner's bearing off the anchor's facing, in the clip)
  const real = Math.atan2(B.x - A.x, B.z - A.z) - A.heading; // (and really)
  const turn = Math.atan2(Math.sin(real - inClip), Math.cos(real - inClip));
  if (Math.abs(turn) > maxTurn) return null; // (too far round from how it was authored)
  const yawA = A.heading + turn - rA.yaw;
  const [ox, oz] = [A.x - (Math.cos(yawA) * rA.x + Math.sin(yawA) * rA.z), A.z - (-Math.sin(yawA) * rA.x + Math.cos(yawA) * rA.z)];
  const oA = { x: ox, y: 0, z: oz, yaw: yawA };
  // (the partner: on the alignment from him; blended in from where he really is)
  const oB = alignedOrigin(pair, nB, oA, mirror);
  const rB = rootAt(clips[nB], start, mirror);
  const [bx, bz] = place(oB, rB.x, rB.z);
  const mk = (clip, origin, off, c, yawOff = 0) => ({ name, clip, origin, mirror, start, t0: now, off, yawOff, from: c ? joints(c) : null, length: clip.length });
  return {
    a: mk(clips[nA], oA, [0, 0], A.char, -turn),
    b: mk(clips[nB], oB, [B.x - bx, B.z - bz], B.char),
    pair,
  };
}

// One character posed from his play at time now. rise (0..1): back up off the turf. Returns
// { x, y, z, heading, t (seconds into the clip), done }.
export function playClip(c, play, now, rise = 0) {
  const t = play.start + (now - play.t0);
  const scale = c.group.scale.clone();
  applyClip(c, play.clip, t, play.origin, play.mirror);
  c.group.scale.copy(scale);
  // (blended in: from his own pose, and from where he really was)
  const k = Math.min(1, (now - play.t0) / BLEND);
  const w = 1 - k * k * (3 - 2 * k);
  if (w > 0) {
    c.group.position.x += play.off[0] * w;
    c.group.position.z += play.off[1] * w;
    if (play.yawOff) c.group.quaternion.premultiply(_q.setFromAxisAngle(_up, play.yawOff * w));
    if (play.from) JOINTS.forEach((j, i) => c[j].quaternion.slerp(play.from[i], w));
  }
  // (getting up: the joints back to standing, upright, feet on the turf)
  if (rise > 0) {
    const r = rise * rise * (3 - 2 * rise);
    for (const j of JOINTS) c[j].quaternion.slerp(_q.identity(), r);
    _e.setFromQuaternion(c.group.quaternion, 'YXZ');
    c.group.quaternion.slerp(_q.setFromAxisAngle(_up, _e.y), r);
    c.group.position.y *= 1 - r;
  }
  _e.setFromQuaternion(c.group.quaternion, 'YXZ');
  c.group.rotation.copy(_e);
  _p.copy(c.group.position);
  return { x: _p.x, y: _p.y, z: _p.z, heading: _e.y, t, done: t >= play.length };
}

// Which way round a pair goes: is the partner on the anchor's left (+1) or right (-1)?
export function sideOf(A, B) {
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  return dx * Math.cos(A.heading) - dz * Math.sin(A.heading) >= 0 ? 1 : -1;
}

// Which tackle, from where the tackler is (football.js tackle): in front of him (head on),
// behind him or at his side (the side one mirrored from his right); side +1: on his left.
export function tackleKind(rx, rz, rh, tx, tz) {
  const dx = tx - rx;
  const dz = tz - rz;
  const L = Math.hypot(dx, dz) || 1;
  const ahead = (dx * Math.sin(rh) + dz * Math.cos(rh)) / L;
  const left = (dx * Math.cos(rh) - dz * Math.sin(rh)) / L;
  const from = ahead > 0.45 ? 'front' : ahead < -0.45 ? 'behind' : 'side';
  const side = left >= 0 ? 1 : -1;
  return { from, side, name: from === 'front' ? 'tackle-front' : from === 'behind' ? 'tackle-behind' : 'tackle-side', mirror: from === 'side' && side < 0 };
}
// How close the tackler has to be for that tackle: how far apart they are in its clip when
// they meet (the 'touch' event: leaning in, diving), so it's on from right where they are.
const REACH = {};
export function tackleReach(rx, rz, rh, tx, tz) {
  const { name } = tackleKind(rx, rz, rh, tx, tz);
  if (REACH[name] == null) {
    const P = PAIRED[name];
    const f = P?.pair.events.touch;
    if (f == null) return (REACH[name] = 1.0);
    const [a, b] = P.pair.actors;
    const o = alignedOrigin(P.pair, b, { x: 0, z: 0, yaw: 0 });
    const ra = P.clips[a].root[f];
    const rb = P.clips[b].root[f];
    const [bx, bz] = place(o, rb[0], rb[2]);
    REACH[name] = Math.hypot(bx - ra[0], bz - ra[2]);
  }
  return REACH[name];
}
