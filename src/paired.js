import * as THREE from 'three';
import { restPose } from './character.js';

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
  const clips = {};
  const start = {};
  for (const a of def.actors) clips[a] = { name: def.name, actor: a, fps, frames, length: def.length, joints: JOINTS, root: [], tracks: Object.fromEntries(JOINTS.map((j) => [j, []])), events: { ...(def.events || {}), ...(def.props?.[a] ? { props: def.props[a] } : {}) } };
  for (let f = 0; f < frames; f++) {
    const t = Math.min(def.length, f / fps);
    for (const a of def.actors) {
      const c = chars[a];
      for (const j of JOINTS) c[j].rotation.set(0, 0, 0);
      restPose(c);
      c.group.position.set(0, 0, 0);
      c.group.rotation.set(0, 0, 0);
    }
    def.pose(t, chars);
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
  const pair = { name: def.name, fps, frames, length: def.length, actors: def.actors, anchor, align, events: def.events || {}, clips: Object.fromEntries(def.actors.map((a) => [a, `${def.name}.${a}.json`])) };
  return { clips, pair };
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
