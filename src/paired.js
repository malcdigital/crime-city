import * as THREE from 'three';
import { restPose, lowestPoint } from './character.js';
import { overlap } from './pairedcontact.js';

// Paired animations: two players animated together, played back apart.
//
// Authoring: a scene file (src/paired/*.js) poses BOTH characters at a time t, in one shared
// space (the runner and the tackler are in the same world, so a hand can be put on the other
// man's hip, a shoulder into his chest). Nothing in the game plays the scene itself.
//
// Export (bakePaired; tools/paired/bake.mjs writes the files): the scene sampled at its fps into
// two separate clips, one per player, the same length and the same frames:
//   <name>.<actor>.json  { name, actor, fps, frames, length, joints, root, tracks, events }
//     root[f]   [x, y, z, qx, qy, qz, qw]: the character's root (its feet, the group) at frame f,
//               relative to where it was at frame 0 (in frame 0's own facing), so the clip
//               plays from wherever the character is
//     tracks[j] one [qx, qy, qz, qw] per frame for each joint j (local rotations)
//     events    the moments that matter ({ contact: frame, down: frame, ... }) and props
// and the alignment that ties them back together:
//   <name>.pair.json  { name, fps, frames, length, actors, anchor, align: { actor: { pos, yaw } } }
//     the anchor actor (the runner) starts wherever he is; every other actor's root at frame 0
//     is pos (x, y, z in the anchor's frame-0 space: +z the way he faces, +x his left) and yaw
//     (radians, relative to his facing). Put the partner there, start both clips together.
//
// Contact (def.contact: { move, against, skip, tol }): bodies don't go through each other. Before
// the export, every frame's overlap is measured (src/pairedcontact.js) and the actor that moves
// (move) is pushed out of the other till they're within tol of touching; the pushes are smoothed
// over the frames so nothing jitters, and the scene's pose(t, chars, adjust) puts adjust[move]
// on that actor's root before his hands are placed, so a hand on the other man still lands on
// him. The bake reports the worst overlap left (bakePaired: report).
//
// Playback (applyClip): one character, one clip, a time and the root it started from.

export const JOINTS = ['spine', 'chest', 'neck', 'legL', 'legR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR', 'wristL', 'wristR'];

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

// The scene sampled into one clip per actor and the pair (see the top). def: the scene file's
// export; chars: { actor: character } (made by the caller: the same rig the game uses).
export function bakePaired(def, chars) {
  const fps = def.fps || 30;
  const frames = Math.round(def.length * fps) + 1;
  const reset = () => {
    for (const a of def.actors) {
      const c = chars[a];
      for (const j of JOINTS) c[j].rotation.set(0, 0, 0);
      restPose(c);
      c.group.position.set(0, 0, 0);
      c.group.rotation.set(0, 0, 0);
    }
  };
  const C = def.contact;
  // (how far a character's lowest point is under the turf; 0 if it isn't)
  const below = (c) => Math.max(0, -(c.group.position.y + lowestPoint(c)));
  const adj = Array.from({ length: frames }, () => new THREE.Vector3());
  const measure = (f) => {
    reset();
    def.pose(Math.min(def.length, f / fps), chars, { [C.move]: adj[f] });
    return overlap(chars[C.against], chars[C.move], C.skip?.[C.against] || [], C.skip?.[C.move] || []);
  };
  if (C) {
    // (each frame pushed clear, starting from the last frame's push; then smoothed, the biggest
    // push in a little window kept so smoothing never lets them back in; twice over)
    const tol = C.tol ?? 0.015;
    for (let pass = 0; pass < 3; pass++) {
      for (let f = 0; f < frames; f++) {
        if (pass === 0 && f > 0) adj[f].copy(adj[f - 1]);
        for (let it = 0; it < 24; it++) {
          const o = measure(f);
          // (and not into the turf: his lowest point on or above it)
          const sink = below(chars[C.move]);
          if (o.depth <= tol && sink <= tol) break;
          if (o.depth > tol) adj[f].addScaledVector(o.push, 0.8);
          if (sink > tol) adj[f].y += sink;
          adj[f].y = Math.max(0, adj[f].y);
        }
      }
      const wide = adj.map((v, f) => {
        let best = v;
        for (let k = Math.max(0, f - 2); k <= Math.min(frames - 1, f + 2); k++) if (adj[k].length() > best.length()) best = adj[k];
        return best.clone();
      });
      for (let f = 0; f < frames; f++) {
        const sum = new THREE.Vector3();
        let wt = 0;
        for (let k = -2; k <= 2; k++) {
          const g = Math.max(0, Math.min(frames - 1, f + k));
          const w = 3 - Math.abs(k);
          sum.addScaledVector(wide[g], w);
          wt += w;
        }
        adj[f].copy(sum.divideScalar(wt));
      }
    }
  }
  // (no lift the overlap doesn't need: feet back on the turf wherever that's still clear)
  if (C) {
    const tol = C.tol ?? 0.015;
    for (let f = 0; f < frames; f++) {
      if (adj[f].y === 0) continue;
      const y = adj[f].y;
      adj[f].y = 0;
      if (measure(f).depth > tol || below(chars[C.move]) > tol) adj[f].y = y;
    }
  }
  const clips = {};
  const start = {};
  for (const a of def.actors) clips[a] = { name: def.name, actor: a, fps, frames, length: def.length, joints: JOINTS, root: [], tracks: Object.fromEntries(JOINTS.map((j) => [j, []])), events: { ...(def.events || {}), ...(def.props?.[a] ? { props: def.props[a] } : {}) } };
  for (let f = 0; f < frames; f++) {
    const t = Math.min(def.length, f / fps);
    reset();
    def.pose(t, chars, C ? { [C.move]: adj[f] } : {});
    for (const a of def.actors) {
      const c = chars[a];
      const C = clips[a];
      c.group.updateMatrix();
      if (f === 0) start[a] = c.group.matrix.clone();
      // (the root relative to its own start)
      _m1.copy(start[a]).invert().multiply(c.group.matrix);
      _m1.decompose(_p, _q, _s);
      C.root.push([_p.x, _p.y, _p.z, _q.x, _q.y, _q.z, _q.w].map(r4));
      for (const j of JOINTS) {
        const q = c[j].quaternion;
        C.tracks[j].push([q.x, q.y, q.z, q.w].map(r4));
      }
    }
  }
  // (where each actor starts, in the anchor's start space)
  const anchor = def.actors[0];
  const inv = _m0.copy(start[anchor]).invert();
  const align = {};
  for (const a of def.actors) {
    _m1.copy(inv).multiply(start[a]);
    _m1.decompose(_p, _q, _s);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(_q);
    align[a] = { pos: [r4(_p.x), r4(_p.y), r4(_p.z)], yaw: r4(Math.atan2(fwd.x, fwd.z)) };
  }
  // (what's left: the worst overlap, and how many frames are over the tolerance)
  let report = null;
  if (C) {
    report = { worst: 0, at: 0, over: 0, tol: C.tol ?? 0.015, sink: {} };
    for (let f = 0; f < frames; f++) {
      const o = measure(f);
      for (const a of def.actors) report.sink[a] = Math.max(report.sink[a] || 0, below(chars[a]));
      if (o.depth > report.worst) Object.assign(report, { worst: o.depth, at: f, parts: o.parts });
      if (o.depth > report.tol + 0.01) report.over++;
    }
  }
  const pair = { name: def.name, fps, frames, length: def.length, actors: def.actors, anchor, align, events: def.events || {}, clips: Object.fromEntries(def.actors.map((a) => [a, `${def.name}.${a}.json`])) };
  if (report) pair.contact = { worstCm: r4(report.worst * 100), atFrame: report.at, tolCm: r4(report.tol * 100), framesOver: report.over, underTurfCm: Object.fromEntries(Object.entries(report.sink).map(([k, v]) => [k, r4(v * 100)])) };
  return { clips, pair, report };
}

// One character posed from one clip at time t (seconds; clamped to the clip). origin: where it
// started ({ x, y, z, yaw }): its root is put at origin ∘ the clip's root. Frames in between are
// blended (positions lerped, rotations slerped). Returns the frame (a float).
export function applyClip(c, clip, t, origin) {
  const fr = Math.max(0, Math.min(clip.frames - 1, t * clip.fps));
  const i = Math.floor(fr);
  const k = fr - i;
  const n = Math.min(clip.frames - 1, i + 1);
  for (const j of clip.joints) {
    const A = clip.tracks[j][i];
    const B = clip.tracks[j][n];
    _qa.set(A[0], A[1], A[2], A[3]);
    _qb.set(B[0], B[1], B[2], B[3]);
    c[j].quaternion.copy(_qa.slerp(_qb, k));
  }
  const A = clip.root[i];
  const B = clip.root[n];
  _p.set(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
  _qa.set(A[3], A[4], A[5], A[6]);
  _qb.set(B[3], B[4], B[5], B[6]);
  _q.copy(_qa.slerp(_qb, k));
  // (origin ∘ root)
  _m0.compose(_s.set(origin.x, origin.y || 0, origin.z), _qb.setFromAxisAngle(_p.clone().set(0, 1, 0), origin.yaw || 0), _p.clone().set(1, 1, 1));
  _m1.compose(_p, _q, _s.set(1, 1, 1));
  _m0.multiply(_m1);
  const sc = c.group.scale.clone();
  _m0.decompose(c.group.position, c.group.quaternion, _s);
  c.group.scale.copy(sc);
  return fr;
}

// Where a partner's clip starts, from where the anchor's starts (pair.align): { x, y, z, yaw }.
export function alignedOrigin(pair, actor, anchorOrigin) {
  const A = pair.align[actor];
  const yaw = anchorOrigin.yaw || 0;
  const [x, y, z] = A.pos;
  return {
    x: anchorOrigin.x + Math.cos(yaw) * x + Math.sin(yaw) * z,
    y: (anchorOrigin.y || 0) + y,
    z: anchorOrigin.z - Math.sin(yaw) * x + Math.cos(yaw) * z,
    yaw: yaw + A.yaw,
  };
}
