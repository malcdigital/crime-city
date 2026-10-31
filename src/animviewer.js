import * as THREE from 'three';
import { makeCharacter, animateWalk, crouchPose, crouchWalk, restPose, fallPose, lam } from './character.js';
import { aimPose, lowReady, fightStance, markPunch, punchPose, markFlinch, flinchPose, markRecoil, reloadPose, kneelPose, FIGHT_STYLES, PUNCH_T } from './combatpose.js';
import { qbStance, wrStance, dbStance, holdBall, pocketStance, POCKET_CLOSE, tuckCarry, throwPose, catchPose, reachBackPose, pickPose, pickUndercutPose, pickShoulderPose, pickScoopPose, tackledPose, tacklerPose, griddyPose, upsetPose, layoutPose, jukedPose, reachBall, jukePose, spinPose, stiffArmPose, fbBallAt, fbBallQuat, pickupPose, PICK_T, fbPose, PocketFeet } from './footballpose.js';
import { shotForm, dribbleArm, hesiPush, handoff, dribbleFrom, HO_TOP, SPIN_REL, dribbleArms, pivotPose, fadePose, triplePose, anklePose } from './streetball.js';
import { dunkPose, dunkPhase } from './dunkpose.js';
import { markJump, jumpPose } from './blockpose.js';
import { readyPose, boxOutPose, markGrab, grabPose } from './reboundpose.js';
import { markReach, reachPose } from './reachpose.js';
import { markPass, markCatch, passPose, handsAt, holdPose, palmBall, twoHandBall } from './passpose.js';
import { ballMesh } from './court.js';
import { dirIcon, setRich } from './icons.js';

// The animation viewer: every pose and move in the game, one at a time, on a character in an
// empty little set (the game's paused under it). Open it from the pause menu (or V / □ while
// paused). ◀ ▶ (arrows, D-pad, or a swipe) step through; pause and slow-mo to look closely;
// drag to turn the camera round; ✕ / Esc / ○ to close.

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
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
    ...[['two', 'two hands'], ['one', 'one hand'], ['side', 'sideways']].flatMap(([st, nm]) => [
      ['Guns', `Pistol, ${nm}: aim (looking up and down)`, 4, (c, t) => ({ gun: 'pistol', turn: aimPose(c, 'pistol', 0.45 * sweep(t, 4), 99, 'R', st) })],
      ['Guns', `Pistol, ${nm}: firing`, 1.4, (c, t, S) => { [0.2, 0.6, 1.0].forEach((a) => once(S, a, () => markRecoil(c, S.now))); return { turn: aimPose(c, 'pistol', 0, S.now, 'R', st), gun: 'pistol', flash: S.since(0.2, 0.6, 1.0) }; }],
    ]),
    ['Guns', 'Pistol: reload', 1.6, (c, t) => ({ gun: 'pistol', turn: reloadPose(c, 'pistol', clamp01(t / 1.2)) })],
    ['Guns', 'Rifle: aim', 4, (c, t) => ({ gun: 'rifle', turn: aimPose(c, 'rifle', 0.35 * sweep(t, 4), 99) })],
    ['Guns', 'Rifle: full auto', 1.2, (c, t, S) => { for (let k = 0; k < 8; k++) once(S, 0.1 + k * 0.11, () => markRecoil(c, S.now)); return { turn: aimPose(c, 'rifle', 0, S.now), gun: 'rifle', flash: t > 0.1 && t < 1.0 && (t * 9) % 1 < 0.35 }; }],
    ['Guns', 'Rifle: reload', 2.4, (c, t) => ({ gun: 'rifle', turn: reloadPose(c, 'rifle', clamp01(t / 2.0)) })],
    ['Guns', 'Shotgun: firing', 1.6, (c, t, S) => { once(S, 0.3, () => markRecoil(c, S.now)); once(S, 1.1, () => markRecoil(c, S.now)); return { turn: aimPose(c, 'shotgun', 0, S.now), gun: 'shotgun', flash: S.since(0.3, 1.1) }; }],
    ['Guns', 'SMG: aim', 3, (c, t) => ({ gun: 'smg', turn: aimPose(c, 'smg', 0.25 * sweep(t, 3), 99) })],
    ['Guns', 'Rifle: carried (walking)', 1.2, (c, t) => { animateWalk(c, t * 5.2, 0.6); lowReady(c, 'rifle'); return { gun: 'rifle' }; }],
    ['Guns', 'Kneeling aim', 3, (c, t) => { const y = kneelPose(c); return { y, gun: 'rifle', turn: aimPose(c, 'rifle', 0.2 * sweep(t, 3), 99) }; }],
    // ---- Fighting ----
    ...Object.entries(FIGHT_STYLES).map(([st, S]) => ['Fighting', `Stance: ${S.name}`, 2, (c, t, Sv) => ({ y: fightStance(c, Sv.now, 0, st), turn: punchPose(c, Sv.now) })]),
    ...['jab', 'cross', 'hook', 'uppercut', 'kick'].map((k) => ['Fighting', k[0].toUpperCase() + k.slice(1), PUNCH_T[k] + 0.7, (c, t, S) => { const y = fightStance(c, S.now); once(S, 0.2, () => markPunch(c, S.now, k)); return { y, turn: punchPose(c, S.now) }; }]),
    ['Fighting', 'Combo: jab, cross, hook, uppercut, kick', 3, (c, t, S) => { const y = fightStance(c, S.now); [['jab', 0.15], ['cross', 0.5], ['hook', 0.88], ['uppercut', 1.35], ['kick', 1.85]].forEach(([k, a]) => once(S, a, () => markPunch(c, S.now, k))); return { y, turn: punchPose(c, S.now) }; }],
    ['Fighting', 'Philly shell: jab, cross, uppercut', 2.2, (c, t, S) => { const y = fightStance(c, S.now, 0, 'philly'); [['jab', 0.15], ['cross', 0.55], ['uppercut', 1.0]].forEach(([k, a]) => once(S, a, () => markPunch(c, S.now, k))); return { y, turn: punchPose(c, S.now) }; }],
    ['Fighting', 'Punched (jab)', 1.2, (c, t, S) => { once(S, 0.3, () => markFlinch(c, S.now, 'hit', 'jab')); flinchPose(c, S.now); return {}; }],
    ['Fighting', 'Punched (hook)', 1.2, (c, t, S) => { once(S, 0.3, () => markFlinch(c, S.now, 'hit', 'hook')); flinchPose(c, S.now); return {}; }],
    ['Fighting', 'Punched with the hands up', 1.2, (c, t, S) => { const y = fightStance(c, S.now); const turn = punchPose(c, S.now); once(S, 0.3, () => markFlinch(c, S.now, 'hit', 'cross')); flinchPose(c, S.now); return { y, turn }; }],
    ['Fighting', 'Uppercut to the chin (hands up)', 1.2, (c, t, S) => { const y = fightStance(c, S.now); const turn = punchPose(c, S.now); once(S, 0.3, () => markFlinch(c, S.now, 'hit', 'uppercut')); flinchPose(c, S.now); return { y, turn }; }],
    ['Fighting', 'Shot (hit, still up)', 1.2, (c, t, S) => { once(S, 0.3, () => markFlinch(c, S.now, 'shot')); flinchPose(c, S.now); return {}; }],
    ['Fighting', 'Shot down: falls back', 2.6, (c, t) => S_fall(c, t - 0.3, 'back')],
    ['Fighting', 'Shot from behind: falls forward', 2.6, (c, t) => S_fall(c, t - 0.3, 'front')],
    // ---- Football (footballpose.js: yours and theirs) ----
    ['Football', 'QB stance (at the line)', 2, (c) => ({ y: qbStance(c), fball: 1 })],
    ['Football', 'In the pocket: side-on (the target straight ahead)', 2, (c, t) => {
      c.group.rotation.y = -POCKET_CLOSE;
      return { y: pocketStance(c, 0, t * 2, 0), fball: 1 };
    }],
    ['Football', 'In the pocket: shuffling', 1.2, (c, t) => {
      c.group.rotation.y = -POCKET_CLOSE;
      return { y: pocketStance(c, 0, (t / 1.2) * Math.PI * 4, 1), fball: 1 };
    }],
    ['Football', 'In the pocket: stepping round to a new target', 2.4, (c, t, S) => {
      // (looking left, then right: he steps round to each, footballpose.js PocketFeet)
      const F = (S.pf ||= new PocketFeet());
      const dt = Math.max(0, Math.min(0.1, t - (S.pt ?? t)));
      S.pt = t;
      const r = F.update(t % 2.4 < 1.2 ? 0.9 : -0.9, 0, dt);
      return { y: fbPose(c, { lower: ['pocket', r.step, r.moving], upper: ['pocketHands', 0] }), turn: r.yaw - POCKET_CLOSE, fball: 1 };
    }],
    ['Football', 'In the pocket (scanning)', 3, (c, t) => ({ y: holdBall(c, Math.sin((t / 3) * Math.PI * 2) * 0.8, true, t), fball: 1 })],
    ['Football', 'Throw (wind up, release, follow-through)', 1.6, (c, t) => {
      if (t < 0.25) return { y: holdBall(c, 0, true, t), fball: 1 };
      if (t < 0.55) { throwPose(c, (t - 0.25) / 0.3, 0); return { fball: 1 }; }
      throwPose(c, 1, Math.min(1, (t - 0.55) / 0.4));
      return { fball: 1 };
    }],
    // (layers: the legs running, the hands doing something else: footballpose.js fbPose)
    ['Football', 'Layers: throw on the run', 1.2, (c, t) => {
      animateWalk(c, t * 7.85, 1);
      const k = t / 1.2;
      fbPose(c, { lower: ['run'], upper: k < 0.4 ? ['throw', k / 0.4, 0] : ['throw', 1, Math.min(1, (k - 0.4) / 0.45)] });
      return { y: Math.abs(Math.sin(t * 7.85)) * 0.05, fball: k < 0.45 ? 1 : 0 };
    }],
    ['Football', 'Layers: hands up for a lob on the run', 1, (c, t) => { animateWalk(c, t * 7.85, 1); fbPose(c, { lower: ['run'], upper: ['catch', true] }); return { y: Math.abs(Math.sin(t * 7.85)) * 0.05 }; }],
    ['Football', 'Layers: reaching back on the run', 1, (c, t) => { animateWalk(c, t * 7.85, 0.6); fbPose(c, { lower: ['run'], upper: ['reachBack', 1] }); return { y: Math.abs(Math.sin(t * 7.85)) * 0.03 }; }],
    ['Football', 'Receiver stance', 2, (c) => ({ y: wrStance(c) })],
    ['Football', 'Defender stance', 2, (c) => ({ y: dbStance(c) })],
    ['Football', 'Catch: high (a lob)', 1.4, (c) => { catchPose(c, true); return { fball: 'hands' }; }],
    ['Football', 'Catch: at the chest (a bullet)', 1.4, (c) => { catchPose(c, false); return { fball: 'hands' }; }],
    ['Football', 'Catch: reaching back (thrown behind him)', 1.4, (c) => { reachBackPose(c, 1); return {}; }],
    ['Football', 'Catch: high-pointing it (sailed high)', 1.2, (c, t) => { const k = (t % 1.2) / 1.2; return { y: pickPose(c, Math.min(1, k / 0.75)) }; }],
    ['Football', 'Catch: in stride (on target)', 1.2, (c, t) => { const k = (t % 1.2) / 1.2; animateWalk(c, t * 7.85, 1); pickUndercutPose(c, Math.min(1, k / 0.6)); return { y: Math.abs(Math.sin(t * 7.85)) * 0.05 }; }],
    ['Football', 'Catch: over the shoulder (deep / a lob)', 1.4, (c, t) => { const k = (t % 1.4) / 1.4; animateWalk(c, t * 7.85, 1); pickShoulderPose(c, Math.min(1, k / 0.65), -1); return { y: Math.abs(Math.sin(t * 7.85)) * 0.05 }; }],
    ['Football', 'Catch: scooping a low one (short)', 1.2, (c, t) => { const k = (t % 1.2) / 1.2; return { y: pickScoopPose(c, Math.min(1, k / 0.8)) }; }],
    ['Football', 'Catch: diving', 2, (c, t) => { const k = t < 0.4 ? t / 0.4 : t > 1.6 ? (2 - t) / 0.4 : 1; const y = layoutPose(c, k, true); return { y, rotX: c.group.rotation.x }; }],
    ['Football', 'Interception: high-pointing it', 1.2, (c, t) => { const k = (t % 1.2) / 1.2; return { y: pickPose(c, Math.min(1, k / 0.75)) }; }],
    ['Football', 'Interception: jumping the route', 1.2, (c, t) => { const k = (t % 1.2) / 1.2; animateWalk(c, t * 7.85, 1); pickUndercutPose(c, Math.min(1, k / 0.6)); return { y: Math.abs(Math.sin(t * 7.85)) * 0.05 }; }],
    ['Football', 'Interception: over the shoulder', 1.4, (c, t) => { const k = (t % 1.4) / 1.4; animateWalk(c, t * 7.85, 1); pickShoulderPose(c, Math.min(1, k / 0.65), 1); return { y: Math.abs(Math.sin(t * 7.85)) * 0.05 }; }],
    ['Football', 'Interception: scooping a low one', 1.2, (c, t) => { const k = (t % 1.2) / 1.2; return { y: pickScoopPose(c, Math.min(1, k / 0.8)) }; }],
    ['Football', 'Interception: diving', 2, (c, t) => { const k = t < 0.4 ? t / 0.4 : t > 1.6 ? (2 - t) / 0.4 : 1; const y = layoutPose(c, k, true); return { y, rotX: c.group.rotation.x }; }],
    ['Football', 'Touchdown dance: the Griddy', 3.2, (c, t) => ({ y: griddyPose(c, t) })],
    ['Football', 'Turnover: gutted (the quarterback)', 5.0, (c, t) => ({ y: upsetPose(c, t) })],
    ['Football', 'Running with it (tucked)', 0.8, (c, t) => { animateWalk(c, t * 7.85, 1); tuckCarry(c, 7); return { y: Math.abs(Math.sin(t * 7.85)) * 0.05, fball: 1 }; }],
    ['Football', 'Picking it up off the grass', 1.4, (c, t) => {
      // (walking up to it, the scoop, up with it)
      const k = (t - 0.2) / PICK_T;
      if (k < 0) { animateWalk(c, t * 5.2, 0.6); return { fwd: -0.5 + t * 2.5, fball: 'ground' }; }
      if (k < 1) { const y = pickupPose(c, k); return { y, fball: k < 0.5 ? 'ground' : 1 }; }
      return { y: holdBall(c, 0, true, t), fball: 1 };
    }],
    ['Football', 'Juke', 1, (c, t) => { animateWalk(c, t * 7.85, 1); if (t > 0.3 && t < 0.58) jukePose(c, 1, (t - 0.3) / 0.28, 6); else tuckCarry(c, 6); return { slide: t > 0.3 ? -Math.min(1, (t - 0.3) / 0.28) * 0.8 : 0, fball: 1 }; }],
    ['Football', 'Spin', 1.2, (c, t) => { animateWalk(c, t * 7.85, 1); const k = Math.max(0, Math.min(1, (t - 0.3) / 0.45)); if (k > 0 && k < 1) spinPose(c, k); else tuckCarry(c, 6); return { turn: -Math.PI * 2 * k * k * (3 - 2 * k), fball: 1 }; }],
    ['Football', 'Stiff-arm', 1.2, (c, t) => { animateWalk(c, t * 7.85, 1); if (t > 0.2 && t < 0.8) stiffArmPose(c, (t - 0.2) / 0.6, 6); else tuckCarry(c, 6); return { fball: 1 }; }],
    ['Football', 'Diving catch', 2, (c, t) => { const k = t < 0.4 ? t / 0.4 : t > 1.6 ? (2 - t) / 0.4 : 1; const y = layoutPose(c, k, true); return { y, rotX: c.group.rotation.x }; }],
    ['Football', 'Tackled from behind', 2, (c, t) => { const k = t < 0.3 ? t / 0.3 : t > 1.6 ? (2 - t) / 0.4 : 1; const y = tackledPose(c, k, 'behind'); return { y, rotX: c.group.rotation.x, rotZ: c.group.rotation.z }; }],
    ['Football', 'Tackled head on', 2, (c, t) => { const k = t < 0.3 ? t / 0.3 : t > 1.6 ? (2 - t) / 0.4 : 1; const y = tackledPose(c, k, 'front'); return { y, rotX: c.group.rotation.x, rotZ: c.group.rotation.z }; }],
    ['Football', 'Tackled from the side', 2, (c, t) => { const k = t < 0.3 ? t / 0.3 : t > 1.6 ? (2 - t) / 0.4 : 1; const y = tackledPose(c, k, 'side', 1); return { y, rotX: c.group.rotation.x, rotZ: c.group.rotation.z }; }],
    ['Football', 'The tackle (wrapping him up)', 2, (c, t) => { const k = t < 0.3 ? t / 0.3 : t > 1.6 ? (2 - t) / 0.4 : 1; const y = tacklerPose(c, k); return { y, rotX: c.group.rotation.x, rotZ: c.group.rotation.z }; }],
    ['Football', 'Juked (caught leaning)', 1.4, (c) => { jukedPose(c, 1); return {}; }],
    ['Football', 'Defender going up for the ball', 1.4, (c) => { reachBall(c); return {}; }],
    // ---- Basketball ----
    ['Basketball', 'Dribble (stance)', 1.2, (c, t) => { const ph = t * 9; const y = sb ? sb.dribblePose(c, 0, null, 0, 1, false) : crouchPose(c, 0.28); return { y, ball: [-0.42, 0.18 + Math.abs(Math.sin(ph)) * 0.8, 0.46], dribble: 'R' }; }],
    ...[['front', 'Crossover (one bounce across)'], ['legs', 'Between the legs'], ['behind', 'Behind the back']].map(([kind, nm]) => ['Basketball', nm, 1.3, (c, t, S) => {
      // (the same path as the game's: streetball.js handoff, one bounce from hand to hand)
      const side = S.loopN % 2 ? -1 : 1;
      const t0 = 0.3;
      const T = 0.4;
      const k = (t - t0) / (T * 0.85);
      const R = 9;
      let ph = t * R;
      let s = side;
      let fwd = 0.4;
      let y;
      if (k < 0) y = 0.18 + Math.abs(Math.sin(ph)) * 0.8;
      else if (k < 1) [s, fwd, y] = handoff(kind, side, -side, k, 0.18 + Math.abs(Math.sin(t0 * R)) * 0.8);
      else {
        ph = dribbleFrom((t0 + T * 0.85) * R, HO_TOP, 0.8) + (t - t0 - T * 0.85) * R;
        s = -side;
        y = 0.18 + Math.abs(Math.sin(ph)) * 0.8;
      }
      const mid = k >= 0 && k < 1;
      void mid;
      const mv = t >= t0 && t < t0 + T ? { kind: kind === 'front' ? 'cross' : kind, t: t - t0, T, to: -side, from: side } : null;
      const yy = sb ? sb.dribblePose(c, 0, mv, 0, s >= 0 ? 1 : -1, false) : 0;
      return { y: yy, ball: [-0.42 * s, y, fwd], dribble: s >= 0 ? 'R' : 'L' };
    }]),
    ['Basketball', 'Triple threat', 2, (c) => ({ y: triplePose(c, 1, {}), ball: 'two' })],
    ['Basketball', 'Jab step: forward', 1, (c, t) => ({ y: triplePose(c, 1, { jab: t > 0.2 && t < 0.62 ? { k: (t - 0.2) / 0.42, x: 0, z: 1 } : null }), ball: 'two' })],
    ['Basketball', 'Jab step: right, then left (crossing over)', 1.6, (c, t) => {
      const j = t > 0.2 && t < 0.62 ? { k: (t - 0.2) / 0.42, x: 1, z: 0 } : t > 0.9 && t < 1.32 ? { k: (t - 0.9) / 0.42, x: -1, z: 0.3 } : null;
      return { y: triplePose(c, 1, { jab: j }), ball: 'two' };
    }],
    ['Basketball', 'Pump fake', 1.2, (c, t) => ({ y: triplePose(c, 1, { pump: t > 0.25 && t < 0.67 ? (t - 0.25) / 0.42 : 0 }), ball: 'two' })],
    ['Basketball', 'Ankles broken (and getting up)', 2.5, (c, t) => ({ y: t < 0.2 ? sb ? sb.defensePose(c, 0, 0, 0, 0, 0) : 0 : anklePose(c, Math.min(1.9, t - 0.2), 1.9, 1) })],
    ['Basketball', 'Hesitation', 1.1, (c, t) => { const T = 0.48; const y = sb ? sb.dribblePose(c, 0, t < T ? { kind: 'hesi', t, T, from: 1 } : null, 0, 1, false) : 0; const m = t < T ? hesiPush(t / T) : 0; return { y, ball: [-(0.42 + 0.24 * m), 0.18 + Math.abs(Math.sin(t * 7)) * 0.8, 0.46 + 0.1 * m], dribble: 'R' }; }], // (the ball pushed out wide, selling it)
    ['Basketball', 'Spin move', 1.1, (c, t) => {
      // (the same as the game's: turning toward the ball's side, the ball palmed and pulled round,
      // let go and bounced once across in front into the other hand)
      const T = 0.54;
      const mv = t < T ? { kind: 'spin', t, T, from: 1, to: -1 } : null;
      const k = t / (T * 0.85);
      const y = sb ? sb.dribblePose(c, 0, mv, 0, k < SPIN_REL ? 1 : -1, false) : 0;
      const turn = t < T ? -Math.PI * 2 * ease(t / T) : 0;
      if (k < SPIN_REL) return { y, turn, ball: 'palmR' };
      if (k < 1) {
        const [s, fwd, by] = handoff('spin', 1, -1, k);
        return { y, turn, ball: [-0.42 * s, by, fwd], dribble: s >= 0 ? 'R' : 'L', fromPalm: 'R', fromW: Math.min(1, (k - SPIN_REL) / 0.12) };
      }
      const ph = dribbleFrom(T * 0.85 * 9, HO_TOP, 0.8) + (t - T * 0.85) * 9;
      return { y, turn, ball: [0.42, 0.18 + Math.abs(Math.sin(ph)) * 0.8, 0.46], dribble: 'L' };
    }],
    ['Basketball', 'Jump shot', 1.8, (c, t) => {
      const rel = 0.55;
      const g0 = rel - 0.25;
      const f = t >= rel ? t - rel : -1;
      const jump = jumpY(t, g0, 0.55, 0.45);
      const r = shotForm(c, { kind: 'jumper', hand: 1, g: (t - 0.1) / 0.14, u: t <= g0 ? 0 : Math.min(1, (t - g0) / 0.25), f, air: jump > 0.02, land: f > 0.3 && jump <= 0.02 ? f - 0.3 : -1 });
      return { y: jump + r.y, ball: t < rel ? 'shoot' : [0, 2.4 + (t - rel) * 2.2 - (t - rel) * (t - rel) * 4, 0.6 + (t - rel) * 5] };
    }],
    ['Basketball', 'Turnaround jumper (pivot, then up)', 2.2, (c, t) => {
      // (back to the basket: ball in, pivot on the left foot, the right swinging round, then the jumper)
      const P = 0.38;
      if (t < P) {
        const k = t / P;
        const left = Math.PI * (1 - ease(k));
        shotForm(c, { kind: 'jumper', hand: 1, g: Math.min(1, t / 0.12), u: 0, legs: false });
        return { y: pivotPose(c, k, 1, left), turn: -left, ball: 'two' };
      }
      const tt = t - P + 0.14;
      const rel = 0.55;
      const g0 = rel - 0.25;
      const f = tt >= rel ? tt - rel : -1;
      const jump = jumpY(tt, g0, 0.55, 0.45);
      const r = shotForm(c, { kind: 'jumper', hand: 1, g: 1, u: tt <= g0 ? 0 : Math.min(1, (tt - g0) / 0.25), f, air: jump > 0.02, land: f > 0.3 && jump <= 0.02 ? f - 0.3 : -1 });
      return { y: jump + r.y, ball: tt < rel ? 'shoot' : [0, 2.4 + (tt - rel) * 2.2 - (tt - rel) * (tt - rel) * 4, 0.6 + (tt - rel) * 5] };
    }],
    ['Basketball', 'Fadeaway jumper', 1.9, (c, t) => {
      const rel = 0.55;
      const g0 = rel - 0.25;
      const f = t >= rel ? t - rel : -1;
      const jump = jumpY(t, g0, 0.6, 0.45);
      const r = shotForm(c, { kind: 'jumper', hand: 1, g: (t - 0.1) / 0.14, u: t <= g0 ? 0 : Math.min(1, (t - g0) / 0.25), f, air: jump > 0.02, land: f > 0.3 && jump <= 0.02 ? f - 0.3 : -1 });
      const fk = Math.min(1, jump / 0.45);
      if (jump > 0.02) fadePose(c, 1, fk);
      const back = -0.7 * ease(clamp01((t - g0) / 0.7)); // (drifting back through it)
      return { y: jump + r.y, rotX: -0.12 * fk, fwd: back, ball: t < rel ? 'shoot' : [0, 2.4 + (t - rel) * 2.2 - (t - rel) * (t - rel) * 4, back + 0.6 + (t - rel) * 5] };
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
      return { y: (t < 0.2 ? 0 : h) + r.y, ball: P.ph === 'rise' ? (r.two ? 'two' : 'palmR') : null };
    }]),
    ['Basketball', 'Pass', 1.2, (c, t, S) => { once(S, 0.25, () => markPass(c, S.now)); holdPose(c); passPose(c, S.now); return { ball: t < 0.4 ? 'hands' : [0, 1.2, 0.5 + (t - 0.4) * 9] }; }],
    ['Basketball', 'Catch', 1.2, (c, t, S) => { once(S, 0, () => markCatch(c, S.now + 0.5)); passPose(c, S.now); return { ball: t < 0.5 ? [0, 1.2, 4.5 - t * 8] : 'hands' }; }],
    ['Basketball', 'Rebound: hands up, ready', 1.5, (c) => { readyPose(c); return { y: crouchPose(c, 0.2) }; }],
    ['Basketball', 'Rebound: going up for it', 1.6, (c, t, S) => { once(S, 0.2, () => markJump(c, S.now, 0.75, 'rebound', 1)); const y = jumpPose(c, S.now) || 0; return { y: y + jumpY(t, 0.3, 0.6, 0.55) }; }],
    ['Basketball', 'Rebound: snatching it', 1.2, (c, t, S) => { once(S, 0.2, () => markGrab(c, S.now, true)); const y = grabPose(c, S.now) || 0; return { y, ball: t > 0.2 ? 'two' : [0, 2.4, 0.4] }; }],
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

// Shot down (character.js fallPose, the same as in the game): from standing to lying there.
function S_fall(c, t, face) {
  if (t < 0) return {};
  const f = fallPose(c, Math.min(t, 1.3), face);
  return { y: 0.2 + f.y, rotX: f.rot };
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
    // (a football, for the football poses)
    const fg = new THREE.SphereGeometry(0.11, 10, 8);
    fg.scale(1, 1, 1.6);
    this.fball = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ color: 0x6b3a1f }));
    this.fball.visible = false;
    scene.add(this.fball);
    this.cam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 50);
    this.list = list(this.game);
    // The panel.
    const el = (this.el = document.createElement('div'));
    el.id = 'animview';
    el.innerHTML = `<div class="av-top"><b>ANIMATIONS</b><span class="av-n"></span><button class="av-x" aria-label="close">✕</button></div>
      <div class="av-bar"><button class="av-prev" aria-label="previous">${dirIcon('left')}</button><div class="av-name"><small></small><span></span></div><button class="av-next" aria-label="next">${dirIcon('right')}</button></div>
      <div class="av-tools"><button class="av-play">❚❚ PAUSE</button><button class="av-slow">½ SLOW</button><button class="av-body">♂ MAN</button></div>
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
    btn('.av-body', () => this.setBody(!this.female));
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

  // Man or woman: the same poses on the other build (character.js makeCharacter female); the
  // guns move over to the new hand.
  setBody(female) {
    this.female = !!female;
    const old = this.c;
    const c = (this.c = makeCharacter({ shirt: 0x1e7d32, pants: 0x1b1b1b, skin: 0x8d5524, bandana: female ? null : 0x1e7d32, female, hair: 0x1c120d, hairStyle: 'pony' }));
    for (const g of Object.values(this.guns)) c.wristR.add(g);
    this.scene.remove(old.group);
    this.scene.add(c.group);
    Object.assign(c.group.userData, { punchAt: null, flinchAt: null, recoilAt: null });
    const b = this.el.querySelector('.av-body');
    b.textContent = female ? '♀ WOMAN' : '♂ MAN';
    b.classList.toggle('on', !!female);
  }

  select(i) {
    this.i = i;
    this.t = 0;
    this.now = 100;
    this.fired = new Set();
    this.loopN = 0;
    Object.assign(this.c.group.userData, { punchAt: null, flinchAt: null, recoilAt: null, fightStyle: null, sm: null });
    const [group, name] = this.list[i];
    this.el.querySelector('.av-name small').textContent = group.toUpperCase();
    this.el.querySelector('.av-name span').textContent = name;
    this.el.querySelector('.av-n').textContent = `${i + 1} / ${this.list.length}`;
    const g = this.game;
    const how = g.input.touchMode ? 'swipe or ◀ ▶ · drag to turn it round' : g.input.mode === 'pad' ? 'D-pad ◀ ▶ · ✕ pause · □ slow · △ man / woman · right stick turns it · ○ close' : '← → · Space pause · S slow · B man / woman · drag to turn it round · Esc close';
    setRich(this.el.querySelector('.av-hint'), how);
    const u = this.c.group.userData;
    for (const k of Object.keys(u)) delete u[k];
  }

  togglePlay() {
    this.playing = !this.playing;
    this.el.querySelector('.av-play').innerHTML = this.playing ? '❚❚ PAUSE' : `${dirIcon('right')} PLAY`;
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
    if (a.enter || this.game.input.hit?.('KeyB')) this.setBody(!this.female); // (△ / B: man or woman)
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
    restPose(c);
    c.group.userData.fbGrip = null;
    c.group.rotation.order = 'YXZ';
    c.group.position.set(0, 0, 0);
    for (const g of Object.values(this.guns)) g.visible = false;
    const r = run(c, this.t, this) || {};
    c.group.position.y += r.y || 0;
    c.group.position.x += r.slide || 0;
    c.group.position.z += r.fwd || 0;
    c.group.rotation.y = r.turn || 0;
    c.group.rotation.x = r.rotX || 0;
    c.group.rotation.z = r.rotZ || 0;
    if (r.gun) this.guns[r.gun].visible = true;
    // The muzzle flash at the end of the barrel.
    this.flash.visible = !!(r.gun && r.flash);
    if (this.flash.visible) {
      const g = this.guns[r.gun];
      c.group.updateMatrixWorld(true);
      g.localToWorld(_v.set(0, 0, g.geometry.parameters.depth / 2 + 0.06));
      this.flash.position.copy(_v);
    }
    // A football: in the hands where the pose holds it (fbBallAt), or in front of the hands.
    this.fball.visible = false;
    if (r.fball) {
      c.group.updateMatrixWorld(true);
      const at = r.fball === 'ground' ? _v.set(0, 0.12, 0.62) : r.fball === 'hands' ? c.group.localToWorld(handsAt(c, _v) && c.group.worldToLocal(_v).add(_v2.set(0, 0, 0.12))) : fbBallAt(c, _v);
      if (at) {
        this.fball.visible = true;
        this.fball.position.copy(at);
        if (!fbBallQuat(c, this.fball.quaternion)) this.fball.rotation.set(0, c.group.rotation.y, 0); // (tucked: along the forearm)
      }
    }
    // The ball: in the hands, set to shoot, at a spot (character space), or put away.
    this.ball.visible = !!r.ball;
    if (r.ball === 'hands' || r.ball === 'shoot') {
      handsAt(c, _v);
      this.ball.position.set(_v.x, _v.y + (r.ball === 'shoot' ? 0.1 : 0), _v.z + 0.08);
    } else if (r.ball === 'two') this.ball.position.copy(twoHandBall(c, _v)); // (between the palms)
    else if (r.ball === 'palmR' || r.ball === 'palmL') {
      this.ball.position.copy(palmBall(c, r.ball === 'palmR' ? 'R' : 'L', _v)); // (on a palm)
      if (r.palmW > 0) this.ball.position.lerp(palmBall(c, r.palmTo, _v), r.palmW * r.palmW * (3 - 2 * r.palmW)); // (across to the other)
    }
    else if (r.ball) {
      this.ball.position.set(r.ball[0], r.ball[1], r.ball[2]);
      if (r.fromPalm && r.fromW < 1) { const e = r.fromW * r.fromW * (3 - 2 * r.fromW); this.ball.position.lerpVectors(palmBall(c, r.fromPalm, _v), this.ball.position.clone(), e); } // (just let go of the palm)
      // (dribbling: both arms the same as the game's: the hand riding the ball, the other guarding)
      if (r.dribble) {
        c.group.updateMatrixWorld(true);
        dribbleArms(c, r.dribble, c.group.worldToLocal(_v.set(r.ball[0], r.ball[1], r.ball[2])), this.now);
      }
    }
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
