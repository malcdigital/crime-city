import * as THREE from 'three';
import { dist, rand, pick, lerpAngle, clamp, wrapAngle } from './util.js';
import { crouchPose, bendLeg, bendSpine, restPose } from './character.js';
import { ballMesh } from './court.js';
import { Scoreboard } from './scoreboard.js';
import { Contest, RACK_NAMES } from './contest.js';
import { HeatFx } from './heatfx.js';
import { dunkPose, dunkPhase, dunkBall } from './dunkpose.js';
import { markReach, reachWhiff, reachHit, reachPose } from './reachpose.js';
import { markJump, markSwat, jumpPose } from './blockpose.js';
import { markStripped, markScoop, scooping, strippedPose, scoopPose, markFoul, foulPose } from './stealpose.js';
import { readyPose, boxOutPose, markGrab, grabbing, grabPose } from './reboundpose.js';
import { markPass, markCatch, passPose, passReset, passFrom, steerPass, handsAt, holdPose, catching } from './passpose.js';
import { CFG } from './config.js';

const px0 = (p) => p.pos()[0];
const pz0 = (p) => p.pos()[1];
const SHOT_NAMES = { jumper: 'Jump shot', layup: 'Layup', floater: 'Floater', dunk: 'Dunk' };

// One-on-one at a basketball court against one of the people shooting there (hoops.js),
// played like NBA 2K's Blacktop.
//
// Joining: on the court, on foot, nobody after you. E / D-pad ↑ / USE plays. Q / ○ changes the
// bet ($0-$500; he matches it, never more than your cash), R / □ the game (to 11, 15 or 21).
// Each player has an overall rating (60-90), shown when he offers.
//
// Rules: 1s and 2s (2 from beyond the arc). A miss is a live ball. After a defensive rebound or
// a steal the ball has to be taken back past the arc before a basket counts. After a basket
// the other player checks it at the top. No free throws: a reach-in keeps the ball with the
// offense; a foul on a made shot is an and-one (+1).
//
// Controls (NBA 2K's layout on the controller; input.js has the keyboard and touch versions):
//   Offense  □ hold, let go at the top of the meter = shoot (a quick tap is a pump fake).
//            What you get depends on where you are: a jumper, a layup driving in close, a
//            floater sprinting in from mid-range, a dunk sprinting at the rim.
//            R2 / ✕ sprint (it costs energy). Right stick = Pro Stick dribble moves: flick left
//            or right a crossover, up a hesitation (hold up to size him up), down a step-back,
//            down-left / down-right a spin, up-left / up-right behind the back. On the controller
//            the camera looks down the court on its own while you play.
//   Defense  L2 hold = intense D (face him, slide; drive into you and you cut him off; box out
//            on a shot). □ steal (the timing matters: easier while he's doing a move; reach
//            twice in a row and it's a foul). △ block as he goes up / jump for a rebound.
// The shot meter: a perfect release ("Excellent", green) always goes in. The green window
// shrinks when he's in your face, when you shoot on the run or from deep, and when you're
// tired. Anything else is a "Slightly Early", "Late", "Very Late"... and only a chance.
// Energy: sprinting and moves drain it; standing still brings it back. Tired players are
// slower, shoot worse and get beaten off the dribble.
// Ankles: chain moves (or size him up first) and a move that beats your man can put him on the
// floor for a second. He can do it to you too.
// Walk off the court, get in a car or have the police after you and you forfeit (the bet too).
// If he gets scared off or hurt, it's called off and the bet comes back.
// (Betting against another player waits for multiplayer: the wager is held the same way.)
const ARC = 6.75;
const BETS = [0, 50, 100, 250, 500];
const TARGETS = [11, 15, 21, 33]; // (33: the game called 33, everyone at the court)
// 33: each player's color (yours first).
// 33: an easy, unhurried dribble while you wait and set up (a game's is 9).
const DRIBBLE33 = 5.5;
const COLORS33 = [0xffd23f, 0x6fa8ff, 0xff6b6b, 0x3ddc97, 0xff79c6];
// A name floating over a spot (33): a label that always faces the camera.
function textSprite33(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const g = cv.getContext('2d');
  g.font = 'bold 38px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(0,0,0,.85)';
  g.strokeText(text, 128, 34);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0');
  g.fillText(text, 128, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  s.scale.set(2, 0.5, 1);
  s.renderOrder = 10;
  return s;
}
// Asking to play, and their answers (one of each, picked at random).
const ASKS = ["Y'all wanna play?", "Y'all tryna run one?", 'Can I get in?', 'Who got next?', "Y'all tryna hoop?", 'Run it?', "What's up, y'all playing?"];
const REPLIES = ["Yeah! What you wanna play?", 'Bet. What we playing?', "Aight, what you tryna run?", "You got next. What's the game?", 'Pull up. What you want?', "Say less. What we playing?", "Yeah, we need one. What's it gon' be?"];
const NAMES = ['Dre', 'Tank', 'Lil Mike', 'Jojo', 'Smoke', 'Ray', 'Peanut', 'Boogie', 'Shorty', 'Deuce'];
const G = 9.8;
const _axis = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
// Shots: T = seconds to the perfect release, W = green window (seconds, its full width).
// (NBA 2K's green window is about 40-60 ms; ours is wider for a browser and a phone screen.)
const SHOTS = {
  jumper: { T: 0.5, W: 0.08 }, // (a quick jump: the top of it is the release)
  layup: { T: 0.45, W: 0.13 },
  floater: { T: 0.45, W: 0.09 },
  dunk: { T: 0.42, W: 0 },
};
const LATE = 0.35; // (held this long past the top it goes up anyway: very late)
// The green window by shot (seconds, full width). A three from the arc out to 8 m keeps its
// 80 ms; everything else is set from there: wide for layups, wider the closer a jumper is, and
// shrinking fast past 8 m (half court ~20 ms, three-quarter court a couple of ms).
// Jumpers go up 28% quicker than they used to, everybody's, and their green windows shrink by
// the same amount (a three's is now ~66 ms). Layups, floaters and dunks are as they were.
const SHOT_SPEED = 0.72;
function greenWindow(type, d) {
  if (type === 'layup') return 0.2;
  if (type === 'floater') return 0.12;
  return jumperWindow(d) * 1.15 * SHOT_SPEED;
}
// Heat check / on fire, per player: n makes in a row; st null, 'check' (the next shot is a heat
// check: the ball smokes) or 'fire' (left: shots still on fire).
const newHeat = () => ({ you: { n: 0, st: null, left: 0 }, opp: { n: 0, st: null, left: 0 } });
const FIRE_RANGE = 8;
const REB_READY = 3.5; // (inside this far from the rim, hands come up for the rebound while a shot's up) // (on fire, the window and the odds never shrink past this distance)

function jumperWindow(d) {
  if (d <= 2) return 0.15;
  if (d <= 4.5) return 0.15 - (d - 2) * 0.012;
  if (d <= ARC) return 0.12 - ((d - 4.5) / (ARC - 4.5)) * 0.04;
  if (d <= 8) return 0.08;
  if (d <= 14) return 0.08 * Math.pow(0.7, d - 8);
  return Math.max(0.002, 0.0094 * Math.pow(0.8, d - 14));
}
// Dribble moves: how long they take, the chance they beat a good defender, the chance of
// losing it if you do it right into him.
const MOVES = {
  cross: { T: 0.32, beat: 0.3, risk: 0, name: 'Crossover' },
  behind: { T: 0.38, beat: 0.33, risk: 0.1, name: 'Behind the back' },
  spin: { T: 0.48, beat: 0.4, risk: 0.08, name: 'Spin' },
  hesi: { T: 0.48, beat: 0.3, risk: 0, name: 'Hesi' },
  step: { T: 0.34, beat: 0, risk: 0, name: 'Step-back' },
  legs: { T: 0.32, beat: 0.32, risk: 0.04, name: 'Between the legs' },
};
// How the ball changes hands: in front of you (a crossover), down under you (between the legs)
// or round your back. Returns [side (-1 your left .. 1 your right), forward, height].
const HANDOFF = { cross: 'front', spin: 'spin', behind: 'behind', legs: 'legs' };
const SHUFFLES = new Set(['cross', 'legs', 'behind']); // (the hand switches you shuffle out of, not turn)
const LOCKED = new Set(['cross', 'legs', 'behind', 'hesi']); // (moves that keep you facing the way you were)
// A spin: the facing during it (a full turn toward the new hand's side, eased in and out).
const spinHeading = (mv, k) => mv.h0 - (mv.to || 1) * Math.PI * 2 * (k * k * (3 - 2 * k));
// Smoothing between poses (yours and his): every joint eases to where this frame's pose puts it
// (about 0.1 s to settle), so moves, stances and shots blend instead of snapping.
const JOINTS = ['armL', 'armR', 'legL', 'legR', 'kneeL', 'kneeR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'spine', 'chest', 'neck'];
export function smoothJoints(c, dt) {
  const s = c.group.userData.sm || (c.group.userData.sm = {});
  const k = Math.min(1, dt * 22);
  for (const j of JOINTS) {
    const r = c[j].rotation;
    const p = s[j];
    if (p) {
      r.x = p.x + (r.x - p.x) * k;
      r.y = p.y + (r.y - p.y) * k;
      r.z = p.z + (r.z - p.z) * k;
    }
    s[j] = { x: r.x, y: r.y, z: r.z };
  }
  const g = c.group.rotation;
  if (s.g) {
    g.x = s.g.x + (g.x - s.g.x) * k;
    g.z = s.g.z + (g.z - s.g.z) * k;
  }
  s.g = { x: g.x, z: g.z };
  return s;
}
// Shot form, yours and his, from one set of keys:
//   g: through the gather (0-1): the ball up from the dribble into both hands at the chest,
//      knees dipping.
//   u: through the rise (0-1): a jumper gets to the set point above the forehead (the guide
//      hand on the side of the ball) by 60%, then the shooting arm extends to the release at
//      the top. A layup reaches up one-handed, the knee on that side driving up; a floater is
//      a softer, earlier one-hand push.
//   f: seconds since the release (-1 before): the follow-through holds, the guide hand drops,
//      then the arms come down. land: seconds since landing (-1 in the air): the knees give.
// hand: +1 right, -1 left. Sets the arms and legs on c; returns the height change for a bend
// on the floor and how far the ball has gone from two hands to the shooting hand (one).
const ease = (k) => k * k * (3 - 2 * k);
const mix = (a, b, k) => a + (b - a) * k;
export function shotForm(c, o) {
  const { kind, hand, g, u, f = -1, air = false, land = -1, legs = true } = o;
  const k0 = ease(Math.min(1, Math.max(0, g)));
  // Each arm: [shoulder (raised forward), in toward the middle, elbow, wrist (- cocked back)].
  const mixA = (A, B, k) => A.map((v, i) => mix(v, B[i], k));
  const POCKET = [-0.55, 0.38, -1.25, -0.2]; // (two hands on it at the chest, elbows in)
  let S = mixA([-0.5, 0.1, -0.5, 0], POCKET, k0);
  let G = S.slice();
  let one = 0;
  let drive = 0; // (a knee driving up: layup, floater)
  let flick = 0.9; // (the wrist through the ball at the release)
  const u1 = ease(Math.min(1, u / (kind === 'layup' ? 1 : 0.6)));
  if (kind === 'jumper') {
    // The set point: elbow under the ball, forearm up, wrist cocked, the ball above the forehead;
    // then the arm extends to the release at the top.
    const u2 = ease(Math.min(1, Math.max(0, (u - 0.6) / 0.4)));
    S = mixA(mixA(S, [-2.15, 0.3, -1.05, -0.85], u1), [-2.85, 0.12, -0.12, -0.75], u2);
    G = mixA(mixA(G, [-1.9, 0.5, -1.1, -0.2], u1), [-1.95, 0.62, -0.95, 0], u2);
    one = u1;
    flick = 1.1;
  } else if (kind === 'layup') {
    S = mixA(S, [-2.7, 0.15, -0.35, -0.5], u1);
    G = mixA(G, [-1.5, -0.1, -0.7, 0], u1); // (the off arm out, protecting it)
    one = ease(Math.min(1, u / 0.5));
    drive = u1;
    flick = 0.7;
  } else {
    const u3 = ease(Math.min(1, Math.max(0, (u - 0.7) / 0.3)));
    S = mixA(S, [-2.35, 0.22, -0.7, -0.6], u1);
    G = mixA(mixA(G, [-2.0, 0.45, -0.9, 0], u1), [-1.5, 0.4, -0.7, 0], u3);
    one = u1;
    drive = u1 * 0.6;
  }
  if (f >= 0) {
    // The follow-through: the wrist snaps through (the gooseneck) and the arm stays up, the
    // guide hand comes off first; then the arms come down.
    one = 1;
    const hold = kind === 'jumper' ? 0.22 : 0.12;
    S = S.slice();
    S[3] = mix(S[3], flick, ease(Math.min(1, f / 0.07)));
    const sk = ease(Math.min(1, Math.max(0, (f - hold) / 0.23)));
    S = mixA(S, [-0.5, 0.05, -0.4, 0], sk);
    const gk = ease(Math.min(1, f / 0.12));
    const gk2 = ease(Math.min(1, Math.max(0, (f - 0.12) / 0.3)));
    G = mixA(mixA(G, [-1.3, 0.3, -0.6, 0], gk), [-0.5, 0.05, -0.4, 0], gk2);
    drive *= 1 - ease(Math.min(1, f / 0.25));
  }
  // The body with it: leaning in over the gather, tall through the rise with the head up to the
  // rim, a touch back at the release; a layup reaching up and over to the shooting side.
  const lay = kind === 'layup' ? 1 : 0;
  const ret = f >= 0 ? ease(Math.min(1, Math.max(0, (f - 0.3) / 0.3))) : 0;
  bendSpine(c, mix(0.2 * k0 * (1 - u1) - 0.06 * u1 * (1 - lay) + 0.12 * lay * u1, 0.04, ret), hand * 0.18 * lay * u1 * (1 - ret), -hand * 0.14 * lay * u1 * (1 - ret));
  c.neck.rotation.set(mix(0.12 * k0 * (1 - u1) - 0.3 * u1, 0, ret), 0, 0);
  const sA = hand >= 0 ? c.armR : c.armL;
  const gA = hand >= 0 ? c.armL : c.armR;
  const sg = hand >= 0 ? 1 : -1; // (in toward the middle: + for the right arm, - for the left)
  sA.rotation.x = S[0];
  sA.rotation.z = sg * S[1];
  gA.rotation.x = G[0];
  gA.rotation.z = -sg * G[1];
  (hand >= 0 ? c.elbowR : c.elbowL).rotation.x = S[2];
  (hand >= 0 ? c.wristR : c.wristL).rotation.x = S[3];
  (hand >= 0 ? c.elbowL : c.elbowR).rotation.x = G[2];
  (hand >= 0 ? c.wristL : c.wristR).rotation.x = G[3];
  if (!legs) return { y: 0, one };
  const dL = hand >= 0 ? [c.legR, c.kneeR] : [c.legL, c.kneeL]; // (the shooting side's knee drives)
  const tL = hand >= 0 ? [c.legL, c.kneeL] : [c.legR, c.kneeR];
  if (air) {
    // Up: the legs long, toes down, a little give at the knees; a layup's knee up.
    bendLeg(dL[0], dL[1], mix(0.08, 1.35, drive), mix(0.22, 1.7, drive));
    bendLeg(tL[0], tL[1], 0.05, 0.18);
    return { y: 0, one };
  }
  if (land >= 0) return { y: crouchPose(c, 0.3 * Math.max(0, 1 - land / 0.3)), one }; // (landing soft)
  if (f >= 0) return { y: 0, one };
  return { y: crouchPose(c, 0.32 * k0 * (1 - u1)), one }; // (the dip, then the push up)
}
// The dribbling arm (yours and his): the shoulder and elbow push the ball down, the wrist
// follows through it; behind the back (bk) the arm swings back round the hip.
export function dribbleArm(c, side, ph, bk) {
  const arm = side < 0 ? c.armL : c.armR;
  const el = side < 0 ? c.elbowL : c.elbowR;
  const wr = side < 0 ? c.wristL : c.wristR;
  if (bk) {
    arm.rotation.x = 0.9 * bk;
    el.rotation.x = -0.6 * bk;
    wr.rotation.x = 0;
    return;
  }
  const push = Math.abs(Math.sin(ph + 0.5)); // (1 with the ball up in the hand, 0 at the floor: in step with the bounce (|sin|), a touch ahead so the eased joints land on it)
  arm.rotation.x = -0.35 - push * 0.2;
  el.rotation.x = -0.35 - push * 0.6;
  wr.rotation.x = -0.5 * push + 0.25; // (cupped on top, then pushing through)
}
// One bounce from hand to hand: pushed down from wherever the ball was (y0), quicker as it
// goes, off the floor once (in front for a crossover, under you between the legs, behind your
// back), then up into the other hand, slowing as it rises to the top of the dribble.
const HO_FLOOR = 0.16;
export const HO_TOP = 0.92;
const HO_BOUNCE = 0.42; // (when in the switch it hits the floor)
export function handoff(kind, from, to, k, y0 = 0.75) {
  const s = from + (to - from) * k;
  const m = Math.sin(Math.PI * k);
  if (kind === 'spin') return [s, 0.12, mix(y0, 0.78, Math.min(1, k * 4))]; // (pulled in tight at the hip and carried round)
  const y = k < HO_BOUNCE ? y0 + (HO_FLOOR - y0) * Math.pow(k / HO_BOUNCE, 1.4) : HO_FLOOR + (HO_TOP - HO_FLOOR) * (1 - Math.pow(1 - (k - HO_BOUNCE) / (1 - HO_BOUNCE), 2));
  if (kind === 'legs') return [s, 0.4 - 0.42 * m, y];
  if (kind === 'behind') return [s, 0.4 - 0.75 * m, y];
  return [s, 0.42 + 0.08 * m, y];
}
// A switch that's over: the dribble picks up from where the ball is (rising, in the new hand)
// so it doesn't jump. Returns the dribble phase to carry on from.
export function dribbleFrom(ph, y, amp) {
  const a = Math.asin(Math.min(1, Math.max(0, (y - 0.18) / amp)));
  return Math.floor(ph / Math.PI) * Math.PI + a;
}
// Ball handling (55-99), yours and his: how far the dribble moves carry (a 60 handle goes about
// 70% as far as a 90) and how well they work (beating a man, keeping the ball).
const handleDist = (h) => clamp(0.7 + (h - 60) / 100, 0.6, 1.1);
const handleEff = (h) => clamp(0.6 + (h - 60) / 75, 0.5, 1.15);
const HANDLE_KEY = 'crimecity.handle.v1';
const DEF_KEY = 'crimecity.defense.v1';
// An alley-oop's takeoff: within this far of where the ball comes down (the gather and steps
// happen on the run before it). Further out you have to get there first.
const OOP_REACH = 2.1;
// Defense (55-99): how strongly holding GUARD keeps you in front of him (and him in front of you).
const defK = (d) => clamp((d - 55) / 44, 0, 1);
const OPEN = ['Wide Open', 'Open', 'Contested', 'Heavily Contested'];
const OPEN_WINDOW = [1, 1, 0.7, 0.45]; // (green window)
const OPEN_MAKE = [1.08, 1, 0.75, 0.45]; // (a white release's chance)

export class Streetball {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.betI = 2;
    this.toI = 0;
    this.shot = null;
    this.spares = this.placeSpares();
    // Your ball handling: starts at 72, grows as your moves beat people (saved).
    this.handle = 72;
    try {
      const v = Number(localStorage.getItem(HANDLE_KEY));
      if (v >= 55 && v <= 99) this.handle = v;
    } catch {
      // (storage unavailable)
    }
    // Your defense: starts at 72, grows with stops (his misses, your takeaways), saved.
    this.defense = 72;
    try {
      const v = Number(localStorage.getItem(DEF_KEY));
      if (v >= 55 && v <= 99) this.defense = v;
    } catch {
      // (storage unavailable)
    }
  }

  gainDefense(x) {
    const before = Math.floor(this.defense);
    this.defense = Math.min(99, this.defense + x * (this.defense > 88 ? 0.5 : 1));
    if (Math.floor(this.defense) > before) this.game.hud.toast(`Defense up: ${Math.floor(this.defense)}`, '#7ee081');
    try {
      localStorage.setItem(DEF_KEY, String(this.defense));
    } catch {
      // (storage unavailable)
    }
  }

  gainHandle(x) {
    const before = Math.floor(this.handle);
    this.handle = Math.min(99, this.handle + x);
    if (Math.floor(this.handle) > before) this.game.hud.toast(`Ball handling up: ${Math.floor(this.handle)}`, '#7ee081');
    try {
      localStorage.setItem(HANDLE_KEY, String(this.handle));
    } catch {
      // (storage unavailable)
    }
  }

  // Spare balls lying around each court: along both sidelines, between the lines and the fence.
  // Walk up to one and pick it up to shoot around; put it down and it stays where you left it.
  placeSpares() {
    const list = [];
    for (const H of this.game.hoops || []) {
      const C = H.site.court;
      const P = H.site.pad;
      const alongZ = C.z1 - C.z0 > C.x1 - C.x0;
      // (a random 3 to 6 of them, anywhere along either sideline)
      const spots = [];
      for (const f of [0.15, 0.3, 0.45, 0.6, 0.75, 0.88]) {
        for (const side of [0, 1]) {
          const j = rand(-0.03, 0.03);
          const off = rand(-0.5, 0.5);
          if (alongZ) spots.push([side ? (C.x1 + P.x1) / 2 + off : (C.x0 + P.x0) / 2 + off, C.z0 + (C.z1 - C.z0) * (f + j)]);
          else spots.push([C.x0 + (C.x1 - C.x0) * (f + j), side ? (C.z1 + P.z1) / 2 + off : (C.z0 + P.z0) / 2 + off]);
        }
      }
      for (let i = spots.length - 1; i > 0; i--) {
        const k = Math.floor(Math.random() * (i + 1));
        [spots[i], spots[k]] = [spots[k], spots[i]];
      }
      spots.length = 3 + Math.floor(Math.random() * 4);
      for (const [x, z] of spots) {
        const mesh = ballMesh();
        mesh.position.set(x, 0.18, z);
        mesh.rotation.set(rand(0, 6), rand(0, 6), 0);
        this.game.scene.add(mesh);
        list.push({ H, mesh, home: [x, z] });
      }
    }
    return list;
  }

  nearSpare() {
    const [px, pz] = this.game.player.pos();
    let best = null;
    for (const sp of this.spares) {
      if (!sp.mesh.visible) continue;
      const d = dist(px, pz, sp.mesh.position.x, sp.mesh.position.z);
      if (d < 1.6 && (!best || d < best.d)) best = { sp, d };
    }
    return best?.sp || null;
  }

  // A group's ball lying loose right by you (after a game of 33 or a one-on-one, say): you can
  // pick it up too. They get the nearest spare on the court in its place (no spare left: it's
  // theirs).
  nearGroupBall() {
    const [px, pz] = this.game.player.pos();
    for (const H of this.game.hoops || []) {
      for (const g of H.groups) {
        const b = g.ball;
        if (!b || g.match || b.mode !== 'loose' || b.y > 1 || dist(px, pz, b.x, b.z) > 1.6) continue;
        let sub = null;
        for (const sp of this.spares) if (sp.H === H && sp.mesh.visible && (!sub || dist(g.rim.x, g.rim.z, sp.mesh.position.x, sp.mesh.position.z) < dist(g.rim.x, g.rim.z, sub.mesh.position.x, sub.mesh.position.z))) sub = sp;
        if (!sub) continue;
        return {
          H,
          get mesh() {
            return b.mesh;
          },
          take: () => {
            // (swap: you get their ball, they get the spare where it lies)
            const mine = { H, mesh: b.mesh, home: [b.x, b.z] };
            b.mesh = sub.mesh;
            b.x = sub.mesh.position.x;
            b.z = sub.mesh.position.z;
            b.y = 0.12;
            b.vx = b.vy = b.vz = 0;
            this.spares.splice(this.spares.indexOf(sub), 1);
            this.spares.push(mine);
            return mine;
          },
        };
      }
    }
    return null;
  }

  // The basket to shoot at: the nearest one nobody's using (or just the nearest).
  soloRim(H) {
    const [px, pz] = this.game.player.pos();
    const rims = [...H.site.hoops].sort((a, b) => dist(px, pz, a.x, a.z) - dist(px, pz, b.x, b.z));
    return rims.find((rim) => !H.groups.some((g) => g.rim === rim && g.players.length)) || rims[0];
  }

  // ---- Joining (main.js handleInteractions, on foot) ----
  nearGame() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    for (const H of game.hoops || []) {
      const P = H.site.pad;
      if (px < P.x0 || px > P.x1 || pz < P.z0 || pz > P.z1) continue;
      let best = null;
      for (const g of H.groups) {
        if (!g.players.length || g.match) continue;
        const d = dist(px, pz, g.rim.x, g.rim.z);
        if (!best || d < best.d) best = { H, g, d };
      }
      return best;
    }
    return null;
  }

  // A basket nobody's using (on the court you're standing on): yours to shoot around at.
  freeBasket() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    for (const H of game.hoops || []) {
      const P = H.site.pad;
      if (px < P.x0 || px > P.x1 || pz < P.z0 || pz > P.z1) continue;
      let best = null;
      for (const rim of H.site.hoops) {
        if (H.groups.some((g) => g.rim === rim && g.players.length)) continue;
        const d = dist(px, pz, rim.x, rim.z);
        if (!best || d < best.d) best = { H, rim, d };
      }
      return best;
    }
    return null;
  }

  offer(a) {
    const game = this.game;
    if (this.active || game.player.vehicle || game.stars > 0 || game.stop || game.time < (this.again || 0)) return;
    const near = this.nearGame();
    let spare = this.nearSpare();
    // (the ball a group's playing with, lying loose at your feet, counts too: they get a spare
    // off the sideline in its place)
    const gb = !spare && this.nearGroupBall();
    if (gb) spare = gb;
    if (spare) {
      game.prompt = `Pick up the ball and shoot around: ${game.input.label('interact')}`;
      if (a.interactHeld && !game.interactWasHeld) this.startSolo(spare.H, this.soloRim(spare.H), spare.take ? spare.take() : spare);
      return;
    }
    if (!near) {
      this.talk = null;
      return;
    }
    return this.askToPlay(a, near);
  }

  // Walking up to a court: you ask if they want to play, one of them answers, and the games come
  // up in a menu (one-on-one to 11 / 15 / 21, or 33 with everybody there; the bet's in there
  // too). What's said changes every time.
  askToPlay(a, near) {
    const game = this.game;
    const opp = near.g.players[0];
    if (!opp.ballName) opp.ballName = pick(NAMES);
    if (!opp.ballR) opp.ballR = Math.round(clamp(rand(58, 92) * 0.5 + rand(58, 92) * 0.5, 60, 90));
    const T = this.talk;
    if (T && T.g === near.g) {
      // (waiting on his answer, then the menu)
      if (!T.open && game.time >= T.at) {
        T.open = true;
        game.hud.toast(`${opp.ballName}: "${pick(REPLIES)}"`, '#ffd23f');
        this.gameMenu(near, opp);
      }
      if (!T.open) game.prompt = '';
      return;
    }
    if (!this.askFor || this.askFor !== near.g) {
      this.askFor = near.g;
      this.askLine = pick(ASKS);
    }
    game.prompt = `${game.input.label('interact')}: "${this.askLine}"`;
    if (a.interactHeld && !game.interactWasHeld) {
      game.hud.toast(`You: "${this.askLine}"`, '#ffffff');
      this.talk = { g: near.g, at: game.time + 0.9, open: false };
      this.askFor = null; // (something different next time)
    }
  }

  // The menu of games (courtmenu.js: the game waits while it's up): one-on-one with him or 33
  // with everybody there; the house rules (the wager, how long the one-on-one goes); START, or
  // watch from the side.
  gameMenu(near, opp) {
    const game = this.game;
    const n = Math.min(4, near.g.players.length) + 1;
    const LENS = [11, 15, 21];
    const bets = BETS.filter((v) => v <= game.cash);
    let bi = bets.indexOf(BETS[this.betI]);
    if (bi < 0) bi = bets.length - 1;
    const to0 = LENS.includes(TARGETS[this.toI]) ? TARGETS[this.toI] : 11;
    const name = opp.ballName.toUpperCase();
    game.courtMenu.show({
      title: `${opp.ballName}'s run`,
      place: near.H.site?.name || 'The court',
      games: [
        { id: '1v1', title: `1 on 1 vs. ${name}`, sub: (st) => `${opp.ballR} OVR · First to ${st.to}` },
        { id: '33', title: `33 · ${n} players`, sub: (st) => `Every player for themselves${st.wager ? ` · winner takes $${st.wager * n}` : ''}` },
        { id: '3pt', title: '3-Point Contest · solo', sub: (st) => `70 seconds · money rack: ${RACK_NAMES[st.money]} · beat the high score` },
      ],
      rules: [
        { id: 'wager', label: 'Wager', values: bets, i: bi, fmt: (v) => (v ? `$${v}` : 'None'), only: ['1v1', '33'] },
        { id: 'money', label: 'Money rack', values: [0, 1, 2, 3, 4], i: this.moneyI ?? 4, fmt: (v) => RACK_NAMES[v], only: '3pt' },
        { id: 'to', label: 'Play to', values: LENS, i: LENS.indexOf(to0), fmt: (v) => String(v), only: '1v1' },
      ],
      start: (st) => (st.game === '3pt' ? 'START THE CLOCK' : `START GAME${st.wager ? ` · $${st.wager}` : ''}`),
      watch: pick(['Watch courtside', 'Nah, just watching', 'Maybe next time']),
      onChange: (R) => {
        // (remembered for next time)
        if (R.id === 'wager') this.betI = BETS.indexOf(R.values[R.i]);
        if (R.id === 'to') this.toI = TARGETS.indexOf(R.values[R.i]);
        if (R.id === 'money') this.moneyI = R.values[R.i];
      },
      onStart: (st) => {
        this.talk = null;
        if (st.game === '33') this.start33(near.H, near.g, st.wager);
        else if (st.game === '3pt') this.startContest(near.H, near.g, st.money);
        else this.start(near.H, near.g, opp, st.wager, st.to);
      },
      onClose: () => {
        this.talk = null;
        this.again = game.time + 0.8; // (the button that closed it doesn't ask again)
      },
    });
  }

  start(H, g, opp, bet, to) {
    const game = this.game;
    this.active = true;
    this.H = H;
    this.g = g;
    this.opp = opp;
    this.rim = g.rim;
    this.bet = bet;
    this.to = to;
    this.r = opp.ballR || 75;
    game.cash -= bet; // (held until it's over)
    this.score = { you: 0, opp: 0 };
    this.gameNo = (this.gameNo || 0) + 1;
    this.heat = newHeat();
    this.poss = null;
    this.cleared = true;
    this.shot = null;
    this.outT = 0;
    this.dead = null;
    this.foul = null;
    this.lastShooter = null;
    this.touch = null;
    this.clock = 0;
    this.you = { st: 1, beatT: 0, fallT: 0, jumpT: 0, move: null, combo: 0, lastMoveEnd: -9, rhythm: 0, hand: 1, stealT: 0, lastSteal: -9, blockT: 0, intense: false, ps: { on: false, t: 0, x: 0, y: 0 }, sizeUp: false };
    g.match = this;
    game.player.char.group.userData.sm = opp.char.group.userData.sm = null; // (no leftover pose to ease from)
    // Everyone else at that basket steps off and watches from the side.
    const C = H.site.court;
    const side = g.players.filter((q) => q !== opp);
    side.forEach((q, k) => {
      q.hp.role = 'watch';
      const along = this.rim.dz !== 0; // (the court runs along z)
      q.hp.spot = along ? [C.x0 - 1.2, this.rim.z + this.rim.dz * (5 + k * 2.5)] : [this.rim.x + this.rim.dx * (5 + k * 2.5), C.z0 - 1.2];
      // (already off the court when it starts, not wandering off through the check-up)
      q.x = q.hp.spot[0];
      q.z = q.hp.spot[1];
      q.speed = 0;
    });
    const hp = opp.hp;
    hp.role = 'opp';
    hp.st = 1;
    hp.beatT = 0;
    hp.fallT = 0;
    hp.lagT = 0;
    hp.combo = 0;
    hp.style = pick(['slasher', 'shooter', 'balanced']);
    hp.handle = Math.round(clamp(this.r + (hp.style === 'slasher' ? 5 : hp.style === 'shooter' ? -3 : 0) + rand(-6, 6), 55, 99));
    hp.def = Math.round(clamp(this.r + (hp.style === 'balanced' ? 3 : hp.style === 'shooter' ? -4 : 0) + rand(-6, 6), 55, 99)); // (his defense)
    this.solo = false;
    const first = Math.random() < 0.5 ? 'you' : 'opp';
    this.checkup(first);
    // The matchup: squared up at the top of the key for a short cinematic (the card: overalls,
    // what it's to, what's on it, a line from him), then the check-up.
    if (game.matchup) {
      const rim = this.rim;
      const p = game.player;
      const [yx, yz] = this.onCourt(rim.x + rim.dx * 7.0, rim.z + rim.dz * 7.0);
      const [hx, hz] = this.onCourt(rim.x + rim.dx * 5.3, rim.z + rim.dz * 5.3); // (face to face, close)
      p.x = yx;
      p.z = yz;
      opp.x = hx;
      opp.z = hz;
      const dl = Math.hypot(hx - yx, hz - yz) || 1;
      const dir = [(hx - yx) / dl, (hz - yz) / dl];
      p.heading = Math.atan2(dir[0], dir[1]);
      opp.heading = Math.atan2(-dir[0], -dir[1]);
      for (const [q, x, z, h] of [[p, yx, yz, p.heading], [opp, hx, hz, opp.heading]]) {
        q.char.group.position.x = x;
        q.char.group.position.z = z;
        q.char.group.rotation.y = h;
      }
      const yourOvr = Math.round((this.handle + this.defense) / 2);
      game.matchup.play({
        you: { ovr: yourOvr, sub: `HANDLE ${Math.floor(this.handle)} · D ${Math.floor(this.defense)}` },
        opp: { name: opp.ballName, ovr: this.r, sub: `HANDLE ${hp.handle} · D ${hp.def}` },
        line: `FIRST TO ${to}${bet ? ` · $${bet} EACH` : ''}`,
        at: [(yx + hx) / 2, (yz + hz) / 2],
        dir,
      }, () => {
        if (this.active && !this.solo && this.opp === opp) this.checkup(first);
      });
    } else {
      game.hud.toast(`One-on-one with ${opp.ballName} (${this.r} OVR)${bet ? ` · $${bet} on it` : ''}. First to ${to}`, '#ffd23f');
    }
  }

  // ---- Shooting around on your own ----
  // The same ball handling and shot meter, no opponent: you rebound your own misses. A stand-in
  // "opponent" stays far off the court so everything that looks for him finds nobody.
  startSolo(H, rim, spare = null) {
    const game = this.game;
    // (the ball you picked up is the one you play with)
    if (spare) this.spares.splice(this.spares.indexOf(spare), 1);
    this.strays = [];
    this.fetch = null;
    this.active = true;
    this.solo = true;
    this.H = H;
    this.rim = rim;
    this.bet = 0;
    this.to = Infinity;
    this.r = 75;
    this.score = { you: 0, opp: 0 };
    this.gameNo = (this.gameNo || 0) + 1;
    this.heat = newHeat();
    this.poss = null;
    this.stats = { att: 0, made: 0, streak: 0, best: 0 };
    this.cleared = true;
    this.shot = null;
    this.outT = 0;
    this.dead = null;
    this.check = null;
    this.flight = null;
    this.lastShooter = null;
    this.touch = null;
    this.clock = 0;
    this.you = { st: 1, beatT: 0, fallT: 0, jumpT: 0, move: null, combo: 0, lastMoveEnd: -9, rhythm: 0, hand: 1, stealT: 0, lastSteal: -9, blockT: 0, intense: false, ps: { on: false, t: 0, x: 0, y: 0 }, sizeUp: false };
    this.opp = { x: 1e5, z: 1e5, heading: 0, speed: 0, state: 'play', removed: false, ballName: '', hp: { st: 1, beatT: 0, fallT: 0, lagT: 0, jumpT: 0 } };
    let mesh = spare?.mesh;
    if (!mesh) {
      mesh = ballMesh();
      game.scene.add(mesh);
    }
    const [px, pz] = game.player.pos();
    this.g = { rim, players: [], match: this, ball: { mesh, x: px, y: 1, z: pz, vx: 0, vy: 0, vz: 0, mode: 'held', holder: 'you', t: 0 } };
    game.player.char.group.userData.sm = null;
    this.give('you');
    game.hud.toast(`Shooting around. ${game.input.touchMode ? 'QUIT' : game.input.label('interact')} to put the ball down`, '#ffd23f'); // (a phone has no USE in a pickup game)
  }

  // ---- 33 ----
  // 2-5 players. Five rings on the three-point line: you pick yours (step on one: it flashes and
  // pulls you onto it; press to take it, and it bursts into your color), then they take the rest
  // one by one. The order goes from the left corner round to the right. Everyone shoots from his
  // own spot with his own ball, goes after his own rebound (yours runs itself) and walks back to
  // his spot; the next one shoots once everybody's back. Every make puts 3 in the pot; a miss
  // takes the whole pot onto your score; 33 or more and you're out; last one standing wins
  // (everyone's buy-in). The bigger the pot, the smaller the green window.
  // ---- The 3-point contest (solo; contest.js keeps the racks, the clock and the score) ----
  startContest(H, g, money) {
    const game = this.game;
    this.active = true;
    this.solo = true;
    this.H = H;
    this.realG = g;
    this.money3 = money;
    this.rim = g.rim;
    this.r = 75;
    this.to = Infinity;
    this.score = { you: 0, opp: 0 };
    this.gameNo = (this.gameNo || 0) + 1;
    this.heat = null; // (no heat checks in the contest)
    this.poss = null;
    this.stats = { att: 0, made: 0, streak: 0, best: 0 };
    this.cleared = true;
    this.shot = null;
    this.outT = 0;
    this.dead = null;
    this.foul = null;
    this.check = null;
    this.flight = null;
    this.lastShooter = null;
    this.touch = null;
    this.clock = 0;
    this.strays = [];
    this.fetch = null;
    this.you = { st: 1, beatT: 0, fallT: 0, jumpT: 0, move: null, combo: 0, lastMoveEnd: -9, rhythm: 0, hand: 1, stealT: 0, lastSteal: -9, blockT: 0, intense: false, ps: { on: false, t: 0, x: 0, y: 0 }, sizeUp: false };
    this.opp = { x: 1e5, z: 1e5, heading: 0, speed: 0, state: 'play', removed: false, ballName: '', hp: { st: 1, beatT: 0, fallT: 0, lagT: 0, jumpT: 0 } };
    g.match = this;
    game.player.char.group.userData.sm = null;
    // (everybody at that basket steps off and watches)
    const C = H.site.court;
    g.players.forEach((q, k) => {
      q.hp.role = 'watch';
      const along = this.rim.dz !== 0;
      q.hp.spot = along ? [C.x0 - 1.2, this.rim.z + this.rim.dz * (5 + k * 2.5)] : [this.rim.x + this.rim.dx * (5 + k * 2.5), C.z0 - 1.2];
      q.x = q.hp.spot[0];
      q.z = q.hp.spot[1];
    });
    // The rack spots (the same as 33's: corner to corner, just outside the arc) and the two deep
    // spots between the wings and the top, a couple of meters back.
    const rim = this.rim;
    const ax = -rim.dz;
    const az = rim.dx;
    const at = (along, across) => [rim.x + rim.dx * along + ax * across, rim.z + rim.dz * along + az * across];
    const ring = (deg, r) => {
      const a = (deg * Math.PI) / 180;
      return at(Math.cos(a) * r, Math.sin(a) * r);
    };
    const spots = [at(0.6, 7.16), ring(42, 7.86), ring(0, 7.86), ring(-42, 7.86), at(0.6, -7.16)];
    const deep = [ring(21, 9.2), ring(-21, 9.2)];
    this.t3 = new Contest(this, spots, deep, money);
    // (a stand-in group: the ball you're on is whichever rack ball's next)
    this.g = { ball: this.t3.stations[0].balls[0], players: g.players, rim: g.rim };
    const p = game.player;
    [p.x, p.z] = spots[0];
    p.speed = 0;
    this.has = null;
    // (no message: the countdown and the money rack show in the middle of the screen)
  }

  // (the results card's Run it back)
  again3() {
    const H = this.H;
    const g = this.realG;
    if (!H || !g || this.active) return;
    this.startContest(H, g, this.money3 ?? 4);
  }

  // (the contest's over: contest.js shows the results)
  endContest() {
    this.end('contest');
  }

  start33(H, g, bet) {
    const game = this.game;
    this.active = true;
    this.solo = true; // (no defender: the shootaround setup, with 33's turns on top)
    this.H = H;
    this.g = g;
    this.rim = g.rim;
    this.r = 75;
    this.to = Infinity;
    this.score = { you: 0, opp: 0 };
    this.gameNo = (this.gameNo || 0) + 1;
    this.heat = newHeat();
    this.poss = null;
    this.stats = { att: 0, made: 0, streak: 0, best: 0 };
    this.cleared = true;
    this.shot = null;
    this.outT = 0;
    this.dead = null;
    this.check = null;
    this.flight = null;
    this.lastShooter = null;
    this.touch = null;
    this.clock = 0;
    this.strays = [];
    this.fetch = null;
    this.you = { st: 1, beatT: 0, fallT: 0, jumpT: 0, move: null, combo: 0, lastMoveEnd: -9, rhythm: 0, hand: 1, stealT: 0, lastSteal: -9, blockT: 0, intense: false, ps: { on: false, t: 0, x: 0, y: 0 }, sizeUp: false };
    this.opp = { x: 1e5, z: 1e5, heading: 0, speed: 0, state: 'play', removed: false, ballName: '', hp: { st: 1, beatT: 0, fallT: 0, lagT: 0, jumpT: 0 } };
    g.match = this;
    game.player.char.group.userData.sm = null;
    const npcs = g.players.slice(0, 4);
    for (const q of npcs) {
      if (!q.ballName) q.ballName = pick(NAMES.filter((n) => !npcs.some((o) => o !== q && o.ballName === n)));
      if (!q.ballR) q.ballR = Math.round(clamp(rand(58, 92) * 0.5 + rand(58, 92) * 0.5, 60, 90));
      q.hp.role = 't33';
      q.hp.s33 = null;
    }
    g.players.slice(4).forEach((q) => (q.hp.role = 'watch'));
    // The spots, corner to corner, all the way outside the painted three-point line (court.js:
    // an arc 7.24 m out, straight in the corners 6.7 m to the side, the sideline at 7.62): the
    // corners in the strip between the line and the sideline, the wings and the top a step
    // outside the arc.
    const rim = this.rim;
    const px = -rim.dz; // (across the court)
    const pz = rim.dx;
    const at = (along, across) => [rim.x + rim.dx * along + px * across, rim.z + rim.dz * along + pz * across];
    const out = 7.24 + 0.62; // (the ring's outer edge clear of the arc)
    const wing = (deg) => {
      const a = (deg * Math.PI) / 180;
      return at(Math.cos(a) * out, Math.sin(a) * out);
    };
    // (left to right as you face the basket: + across is your left)
    const spots = [at(0.6, 7.16), wing(42), wing(0), wing(-42), at(0.6, -7.16)];
    // (everyone's own ball: yours is the court's; theirs come out of the bag) and a color each
    const players = [{ who: 'you', name: 'You', color: COLORS33[0] }, ...npcs.map((q, k) => ({ who: q, name: q.ballName, r: q.ballR, color: COLORS33[k + 1] }))].map((P) => {
      const Q = { ...P, score: 0, out: false, spot: null, home: null, st: 'ready', shotClock: 0 };
      if (P.who !== 'you') {
        const mesh = ballMesh();
        game.scene.add(mesh);
        Q.ball = { mesh, x: P.who.x, y: 1, z: P.who.z, vx: 0, vy: 0, vz: 0, mode: 'held', holder: P.who, t: 0 };
      }
      return Q;
    });
    this.t33 = { bet, pot: 0, spots, players, phase: 'pick', turn: 0, shots: 0, t: 0, inAir: null, wait: 0, near: null };
    // The rings (and the burst that goes off when one's taken).
    this.rings33 = spots.map(([x, z]) => {
      const y = (game.city.groundY?.(x, z) || 0) + 0.12;
      const mk = (r0, r1) => {
        const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, y, z);
        m.renderOrder = 5;
        game.scene.add(m);
        return m;
      };
      const burst = mk(0.38, 0.48);
      burst.visible = false;
      return { mesh: mk(0.32, 0.44), burst, burstT: -1, owner: null }; // (small enough for the corners)
    });
    this.labels33 = [];
    game.cash -= bet; // (everyone's buy-in is held till it's over)
    this.give('you');
    game.hud.toast(`33 with ${npcs.map((q) => q.ballName).join(', ')}${bet ? ` · $${bet} each, winner takes $${bet * (npcs.length + 1)}` : ''}. Pick your spot`, '#ffd23f');
  }

  // A spot's taken: the ring flashes white, a ring bursts out from it like a shockwave, and it
  // settles in his color; his name floats up over it for a moment.
  claim33(P, i) {
    const T = this.t33;
    const R = this.rings33[i];
    P.spot = i;
    P.home = T.spots[i];
    R.owner = P;
    R.burstT = 0;
    R.flashT = 0;
    R.burst.visible = true;
    R.burst.material.color.set(P.color);
    R.mesh.material.color.set(P.color);
    const [x, z] = P.home;
    const s = textSprite33(P.name, P.color);
    s.position.set(x, (this.game.city.groundY?.(x, z) || 0) + 2.6, z);
    this.game.scene.add(s);
    this.labels33.push({ s, t: 0 });
  }

  // How much the pressure shrinks the green window (a bigger pot, a smaller window).
  pressure33() {
    return 1 - Math.min(0.5, (this.t33?.pot || 0) / 40);
  }

  // The rings, every frame: picking (a slow, smooth pulse; faster where you're standing), the
  // burst when one's taken, then in play each player's in his color, faint, and the shooter's
  // pulsing.
  rings33Step(dt) {
    const T = this.t33;
    const game = this.game;
    const up = T.players[T.turn];
    for (let i = 0; i < this.rings33.length; i++) {
      const R = this.rings33[i];
      const m = R.mesh.material;
      const wave = (sp) => 0.5 + 0.5 * Math.sin(this.clock * sp);
      if (R.burstT >= 0) {
        // (the shockwave: out and gone in half a second)
        R.burstT += dt;
        const k = Math.min(1, R.burstT / 0.5);
        R.burst.scale.setScalar(1 + 1.6 * k);
        R.burst.material.opacity = 0.95 * (1 - k);
        if (k >= 1) {
          R.burstT = -1;
          R.burst.visible = false;
        }
      }
      if (R.flashT != null && R.flashT < 0.35) {
        // (the flash: white, then into his color)
        R.flashT += dt;
        m.color.set(R.flashT < 0.12 ? 0xffffff : R.owner.color);
        m.opacity = 1;
        R.mesh.scale.setScalar(1 + 0.25 * Math.max(0, 1 - R.flashT / 0.35));
        continue;
      }
      R.mesh.scale.setScalar(1);
      if (T.phase === 'pick' || T.phase === 'claims') {
        R.mesh.visible = true;
        if (R.owner) m.opacity = 0.75;
        else m.opacity = T.near === i ? 0.35 + 0.6 * wave(8) : 0.2 + 0.35 * wave(2.6);
      } else {
        R.mesh.visible = !!R.owner && !R.owner.out;
        m.opacity = R.owner === up && !T.inAir ? 0.3 + 0.65 * wave(4) : 0.28;
      }
    }
    for (const L of [...this.labels33]) {
      L.t += dt;
      L.s.position.y += dt * 0.4;
      L.s.material.opacity = Math.max(0, 1 - Math.max(0, L.t - 1.2) / 0.6);
      if (L.t > 1.8) {
        game.scene.remove(L.s);
        this.labels33.splice(this.labels33.indexOf(L), 1);
      }
    }
  }

  // Every frame of a game of 33 (from step).
  step33(dt) {
    const T = this.t33;
    const game = this.game;
    const p = game.player;
    const b = this.g.ball;
    const [px, pz] = p.pos();
    T.t += dt;
    for (const P of T.players) if (P.who !== 'you' && P.who.hp.s33) P.who.hp.s33.t += dt; // (their shots' clocks)
    if (this.rings33) this.rings33Step(dt);
    const Y = T.players.find((P) => P.who === 'you');
    if (T.phase === 'pick') {
      // (the free ring you're on or nearest to; pressing on it takes it; 25 s and you get the nearest)
      let near = null;
      let nd = 1.6;
      T.spots.forEach(([x, z], i) => {
        const d = dist(px, pz, x, z);
        if (!this.rings33[i].owner && d < nd) {
          nd = d;
          near = i;
        }
      });
      T.near = near;
      T.onRing = near != null && nd < 0.55;
      if ((T.onRing && T.pick) || T.t > 12.5) {
        let mine = near;
        if (mine == null) mine = T.spots.map((sp, i) => i).sort((i, j) => dist(px, pz, ...T.spots[i]) - dist(px, pz, ...T.spots[j]))[0];
        this.claim33(Y, mine);
        T.phase = 'claims';
        T.t = 0;
        T.near = null;
      }
      T.pick = false;
      return;
    }
    if (T.phase === 'claims') {
      // (they take theirs, one at a time)
      const next = T.players.find((P) => P.spot == null);
      if (next && T.t > 0.35) {
        T.t = 0;
        const free = this.rings33.map((R, i) => (R.owner ? -1 : i)).filter((i) => i >= 0);
        this.claim33(next, pick(free));
      }
      if (!next && T.t > 0.45) {
        // The order: left corner round to the right.
        T.players.sort((A, B) => A.spot - B.spot);
        T.phase = 'play';
        T.turn = 0;
        T.wait = 0.5;
        for (const P of T.players) if (P.who !== 'you') P.st = 'return';
        game.hud.toast(`Order: ${T.players.map((P) => P.name).join(' → ')}`, '#ffd23f');
        Y.st = 'return'; // (onto your spot if you're not quite on it)
      }
      return;
    }
    // Their balls: in the air, rolling, in their hands.
    for (const P of T.players) {
      if (P.ball && !P.out) this.npcBall33(P, dt);
      if (!this.t33) return; // (that shot ended it)
    }
    // Yours: off to get it once it's down; then back to your spot (both run themselves).
    if (Y.st === 'chase' && b.mode === 'loose' && dist(px, pz, b.x, b.z) < 0.9 && b.y < 1.6) {
      this.give('you');
      Y.st = 'return';
    }
    if (Y.st === 'return' && dist(px, pz, ...Y.home) < 0.3) {
      Y.st = 'ready';
      p.x = Y.home[0];
      p.z = Y.home[1];
      p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
    }
    // Your shot's gone up.
    if (Y.st === 'ready' && b.mode === 'flight' && (b.kind === 'shot' || b.kind === 'bank')) {
      Y.st = 'air';
      T.inAir = Y;
    }
    // Turns: the next one shoots once the last shot's down, a beat's gone by, and everybody's
    // back on his spot.
    if (T.inAir) return;
    if (T.wait > 0) {
      T.wait -= dt;
      return;
    }
    const up = T.players[T.turn];
    if (!up) return;
    if (up.out) return this.nextTurn33();
    if (!T.players.every((P) => P.out || P.st === 'ready')) return;
    if (up.who === 'you') {
      if (b.mode === 'held' && b.holder === 'you' && !this.shot) {
        Y.shotClock += dt;
        if (Y.shotClock > 6) {
          game.hud.toast('Shot clock: that counts as a miss', '#ff8080');
          Y.shotClock = 0;
          this.result33(Y, false);
          return;
        }
      }
    } else if (up.ball.holder === up.who) {
      const q = up.who;
      if (!q.hp.s33) q.hp.s33 = { t: 0, rel: rand(0.45, 0.75) }; // (settles, a dribble or two, up)
      this.npcShot33(up);
    }
  }

  // His ball, every frame: flying, rolling (he goes after it), or in his hands.
  npcBall33(P, dt) {
    const b = P.ball;
    const q = P.who;
    if (b.mode === 'flight') {
      b.t += dt;
      const k = Math.min(1, b.t / b.T);
      b.x = b.p0[0] + (b.p1[0] - b.p0[0]) * k;
      b.z = b.p0[2] + (b.p1[2] - b.p0[2]) * k;
      const t = Math.min(b.t, b.T);
      b.y = b.p0[1] + b.vy0 * t - 0.5 * G * t * t;
      if (b.t >= b.T) {
        b.mode = 'loose';
        b.holder = null;
        this.bounce33(b, b.make);
        P.st = 'chase';
        this.result33(P, !!b.make);
      }
    } else if (b.mode === 'loose') {
      this.H.roll(b, dt);
      if (P.st === 'chase' && dist(q.x, q.z, b.x, b.z) < 0.8 && b.y < 1.4) {
        b.mode = 'held';
        b.holder = q;
        P.st = 'return';
      }
    } else if (b.holder === q) {
      const S = q.hp.s33;
      if (S && S.t >= S.rel - 0.4) {
        this.shotBall(b, q.char, 1, clamp((S.t - (S.rel - 0.25)) / 0.15, 0, 1));
      } else {
        // (dribbling, on his right)
        const rx = -Math.cos(q.heading);
        const rz = Math.sin(q.heading);
        b.x = q.x + Math.sin(q.heading) * 0.35 + rx * 0.3;
        b.z = q.z + Math.cos(q.heading) * 0.35 + rz * 0.3;
        b.y = 0.2 + Math.abs(Math.sin(this.clock * DRIBBLE33 + P.score)) * 0.8;
      }
    }
    b.mesh.position.set(b.x, b.y, b.z);
  }

  // Through the net, or off the rim.
  bounce33(b, make) {
    if (make) {
      b.x = this.rim.x;
      b.z = this.rim.z;
      b.vx = b.vz = 0;
      b.vy = -1.5;
      this.game.sfx?.swish?.();
      return;
    }
    const side = rand(-1, 1);
    const sp = rand(1.5, 3.2);
    const L = Math.hypot(side, 1);
    b.vx = ((this.rim.dx - this.rim.dz * side) / L) * sp;
    b.vz = ((this.rim.dz + this.rim.dx * side) / L) * sp;
    b.vy = rand(0.8, 2.6);
  }

  // Whose turn next (the next one still in).
  nextTurn33() {
    const T = this.t33;
    const n = T.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (T.turn + k) % n;
      if (!T.players[i].out) {
        T.turn = i;
        break;
      }
    }
    for (const P of T.players) P.shotClock = 0;
  }

  // Theirs: set, rise, release at the top (the same form as yours), the ball off on his rating
  // and the pressure.
  npcShot33(P) {
    const q = P.who;
    const S = q.hp.s33;
    if (!S || S.done) return;
    q.heading = Math.atan2(this.rim.x - q.x, this.rim.z - q.z);
    if (S.t < S.rel) return;
    S.done = true;
    const d = dist(q.x, q.z, this.rim.x, this.rim.z);
    const u = 1 - Math.random();
    const e = ((150 - P.r) / 1000) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    const w = greenWindow('jumper', d) * this.pressure33();
    const m = Math.abs(e) - w / 2;
    const green = m <= 0;
    const tm = green ? 1 : m < 0.06 ? 0.7 : m < 0.16 ? 0.4 : 0.12;
    const make = green || Math.random() < this.base(d) * tm * (0.6 + 0.4 * this.pressure33());
    const b = P.ball;
    this.shotBall(b, q.char, 1, 1);
    const miss = make ? 0 : rand(0.22, 0.4);
    const a = rand(0, Math.PI * 2);
    this.H.launch(b, this.rim.x + Math.cos(a) * miss, this.rim.y + 0.08, this.rim.z + Math.sin(a) * miss * 0.6, 0.75 + d * 0.06);
    b.make = make;
    P.st = 'air';
    this.t33.inAir = P;
  }

  // A shot's come down (or the shot clock ran out): the pot, the score, who's out, who's next.
  result33(P, make) {
    const game = this.game;
    const T = this.t33;
    T.shots += 1;
    T.inAir = null;
    T.wait = 0.3; // (a beat after every shot)
    if (make) {
      T.pot += 3;
      game.hud.toast(`${P.who === 'you' ? 'Bucket' : `${P.name} hits`} · pot ${T.pot}`, P.who === 'you' ? '#7ee081' : '#ffd23f');
    } else {
      const took = T.pot;
      P.score += took;
      T.pot = 0;
      game.hud.toast(`${P.who === 'you' ? 'You miss' : `${P.name} misses`}${took ? ` and eat${P.who === 'you' ? '' : 's'} ${took} (now ${P.score})` : ''}`, P.who === 'you' ? '#ff8080' : '#9fc3ff');
      if (P.score >= 33) {
        P.out = true;
        if (P.who === 'you') {
          game.hud.toast(`${P.score}: you're out`, '#ff8080');
          return this.end('lose');
        }
        game.hud.toast(`${P.name} is out (${P.score})`, '#7ee081');
        if (P.ball) {
          game.scene.remove(P.ball.mesh);
          P.ball.mode = 'gone';
        }
      }
    }
    const left = T.players.filter((Q) => !Q.out);
    if (left.length === 1) return this.end(left[0].who === 'you' ? 'win' : 'lose');
    this.nextTurn33();
  }

  // Theirs in a game of 33: to his spot once he's picked it; after a shot, after his ball, then
  // back to his spot.
  drive33(p, dt) {
    const T = this.t33;
    const P = T.players.find((Q) => Q.who === p);
    const face = (x, z) => {
      p.heading = lerpAngle(p.heading, Math.atan2(x - p.x, z - p.z), Math.min(1, dt * 8));
    };
    if (!P || !P.home) {
      face(this.rim.x, this.rim.z);
      return { speed: 0 };
    }
    if (P.out) {
      const sp = P.outSpot || (P.outSpot = this.onCourt(this.rim.x + this.rim.dx * 9 + rand(-3, 3), this.rim.z + this.rim.dz * 9 + rand(-3, 3)));
      if (dist(p.x, p.z, ...sp) > 0.4) return { tx: sp[0], tz: sp[1], speed: 2 };
      face(this.rim.x, this.rim.z);
      return { speed: 0 };
    }
    if (P.st === 'chase') {
      const b = P.ball;
      return { tx: b.x + b.vx * 0.25, tz: b.z + b.vz * 0.25, speed: 6 };
    }
    if (P.st === 'return' || (P.st === 'ready' && dist(p.x, p.z, ...P.home) > 0.3)) {
      if (dist(p.x, p.z, ...P.home) > 0.25) return { tx: P.home[0], tz: P.home[1], speed: 4.6 };
      if (P.st === 'return') P.st = 'ready';
    }
    face(this.rim.x, this.rim.z);
    return { speed: 0 };
  }

  // Their bodies in 33: the shot (dribble, gather, rise, release, follow-through) or standing by.
  pose33(p) {
    const c = p.char;
    const S = p.hp.s33;
    const P = this.t33.players.find((Q) => Q.who === p);
    c.group.rotation.x = 0;
    if (S) {
      const rel = S.rel;
      const g0 = rel - 0.25; // (off the floor)
      const tg = rel - 0.4; // (the gather)
      if (S.t < tg) {
        // (a dribble or two first)
        dribbleArm(c, 1, this.clock * DRIBBLE33 + (P?.score || 0), 0);
        return 0.04 + crouchPose(c, 0.15);
      }
      const f = S.t >= rel ? S.t - rel : -1;
      const jump = S.t < g0 ? 0 : S.t < rel ? 0.45 * Math.sin(((S.t - g0) / 0.25) * (Math.PI / 2)) : 0.45 * Math.max(0, Math.cos(Math.min(1, (S.t - rel) / 0.3) * (Math.PI / 2)));
      const r = shotForm(c, { kind: 'jumper', hand: 1, g: (S.t - tg) / 0.14, u: S.t <= g0 ? 0 : Math.min(1, (S.t - g0) / 0.25), f, air: jump > 0.02, land: f > 0.3 && jump <= 0.02 ? f - 0.3 : -1 });
      if (f > 0.7) p.hp.s33 = null;
      return 0.04 + jump + r.y;
    }
    if (P?.ball && P.ball.holder === p && P.ball.mode === 'held') dribbleArm(c, 1, this.clock * DRIBBLE33 + P.score, 0);
    return 0.04;
  }

  // ---- Check up ----
  // Pickup ball: before the game, after every bucket and after a foul or a stoppage, you both
  // go back to the top of the key, face to face (the one with the ball just past the arc, the
  // defender a step in front of him). The ball goes to the defender, he checks it back, and
  // it's live. You check it with ✕ / E (the SHOOT button on a phone).
  checkup(off, why = '') {
    const game = this.game;
    const rim = this.rim;
    const p = game.player;
    const opp = this.opp;
    const hp = opp.hp;
    const b = this.g.ball;
    // (room to breathe: the ball handler just past the arc, the defender back on the free-throw
    // line, 4.2 m out from the rim)
    const O = this.onCourt(rim.x + rim.dx * 8.4, rim.z + rim.dz * 8.4);
    const D = this.onCourt(rim.x + rim.dx * 4.2, rim.z + rim.dz * 4.2);
    const [yx, yz] = off === 'you' ? O : D;
    const [hx, hz] = off === 'you' ? D : O;
    p.x = yx;
    p.z = yz;
    p.speed = 0;
    p.heading = Math.atan2(hx - yx, hz - yz);
    opp.x = hx;
    opp.z = hz;
    opp.speed = 0;
    opp.heading = Math.atan2(yx - hx, yz - hz);
    const Y = this.you;
    Y.move = null;
    Y.dunk = null;
    Y.swap = null;
    Y.beatT = Y.fallT = Y.jumpT = 0;
    Y.sizeUp = false;
    for (const k of ['beatT', 'fallT', 'lagT', 'jumpT', 'closeT']) hp[k] = 0;
    hp.state = 'check';
    hp.boxed = false;
    this.shot = null;
    this.dead = null;
    this.flight = null;
    this.cleared = true;
    this.has = 'check';
    this.lastHas = off;
    this.reset = null;
    this.possession(off);
    this.check = { off, stage: off === 'you' ? 'ready' : 'wait', t: 0 };
    b.mode = 'held';
    b.holder = off === 'you' ? 'you' : opp;
    if (why) game.hud.toast(why, '#9fc3ff');
  }

  // ---- Resetting the play (a one-on-one) ----
  // Every make, miss and turnover resets it: the one who'll be on D next goes and gets the ball
  // (from under the net, off the rim, wherever it went) and walks it to the free-throw line;
  // the one with the ball next walks out past the arc; then he checks it up to him. You do
  // this on your own (tap SHOOT / ✕ to skip to the check); he does it the same way.
  startReset(off) {
    const rim = this.rim;
    const hp = this.opp.hp;
    const Y = this.you;
    this.dead = null;
    this.shot = null;
    this.flight = null;
    this.oop = null;
    this.has = null;
    Y.move = null;
    Y.dunk = null;
    Y.swap = null;
    Y.sizeUp = false;
    for (const k of ['beatT', 'fallT', 'jumpT']) Y[k] = 0;
    for (const k of ['beatT', 'fallT', 'lagT', 'jumpT', 'closeT']) hp[k] = 0;
    hp.state = 'reset';
    hp.boxed = false;
    this.cleared = true;
    this.possession(off);
    this.reset = {
      off,
      fetch: off === 'you' ? 'opp' : 'you',
      t: 0,
      O: this.onCourt(rim.x + rim.dx * 8.4, rim.z + rim.dz * 8.4),
      D: this.onCourt(rim.x + rim.dx * 4.2, rim.z + rim.dz * 4.2),
    };
  }

  // Where each of you is headed right now.
  resetTarget(who) {
    const R = this.reset;
    const b = this.g.ball;
    if (b.mode !== 'held' && who === R.fetch) return [b.x + (b.vx || 0) * 0.3, b.z + (b.vz || 0) * 0.3];
    return who === R.off ? R.O : R.D;
  }

  resetStep(dt) {
    const game = this.game;
    const R = this.reset;
    const b = this.g.ball;
    const opp = this.opp;
    const [px, pz] = game.player.pos();
    R.t += dt;
    this.clock += dt;
    if (b.mode === 'flight') {
      b.t += dt;
      const k = Math.min(1, b.t / b.T);
      b.x = b.p0[0] + (b.p1[0] - b.p0[0]) * k;
      b.z = b.p0[2] + (b.p1[2] - b.p0[2]) * k;
      const t = Math.min(b.t, b.T);
      b.y = b.p0[1] + b.vy0 * t - 0.5 * G * t * t;
      if (b.t >= b.T) {
        b.mode = 'loose';
        b.vx = b.vz = 0;
        b.vy = -1;
      }
    } else if (b.mode === 'loose') {
      this.H.roll(b, dt);
      // (the fetcher scoops it up when he gets there)
      const [fx, fz] = R.fetch === 'you' ? [px, pz] : [opp.x, opp.z];
      if (dist(fx, fz, b.x, b.z) < 0.75 && b.y < 1.4) {
        const c = R.fetch === 'you' ? game.player.char : opp.char;
        if (b.y < 0.7) markScoop(c, game.time);
        else markGrab(c, game.time, false);
        b.mode = 'held';
        b.holder = R.fetch === 'you' ? 'you' : opp;
      }
    }
    if (b.mode === 'held') {
      // (dribbling it along, on his right)
      const q = b.holder === 'you' ? game.player : opp;
      const h = b.holder === 'you' ? game.player.heading : opp.heading;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      b.x = q.x + fx * 0.32 - fz * 0.28;
      b.z = q.z + fz * 0.32 + fx * 0.28;
      b.y = 0.2 + Math.abs(Math.sin(game.time * 7)) * 0.72;
    }
    // Both there (or it's taking too long, or you skipped): the check-up.
    const [ox, oz] = R.off === 'you' ? [px, pz] : [opp.x, opp.z];
    const [dx, dz] = R.off === 'you' ? [opp.x, opp.z] : [px, pz];
    const there = b.mode === 'held' && dist(ox, oz, ...R.O) < 0.5 && dist(dx, dz, ...R.D) < 0.5;
    if (R.skip || R.t > 12) {
      this.checkup(R.off);
      return;
    }
    if (there) {
      const off = R.off;
      const defHas = b.holder === (R.fetch === 'you' ? 'you' : opp);
      this.reset = null;
      this.has = 'check';
      this.lastHas = off;
      this.opp.hp.state = 'check';
      game.player.speed = 0;
      opp.speed = 0;
      // (the one holding it starts it: the defender checks it to him, or he checks it in)
      this.check = { off, stage: defHas ? (off === 'you' ? 'defHolds' : 'youHold') : off === 'you' ? 'ready' : 'wait', t: 0 };
      b.y = 1.1;
    }
    b.mesh.position.set(b.x, b.y, b.z);
    this.hud();
  }

  // His side of the reset: to the ball, then to his spot, then face you.
  resetDrive(p, dt) {
    const [px, pz] = this.game.player.pos();
    const [tx, tz] = this.resetTarget('opp');
    const d = dist(p.x, p.z, tx, tz);
    if (d > 0.3) return { tx, tz, speed: d > 4 ? 4.4 : 2.6 };
    p.heading = lerpAngle(p.heading, Math.atan2(px - p.x, pz - p.z), Math.min(1, dt * 8));
    return { speed: 0 };
  }

  // The ball going across at the check.
  checkPass(to) {
    const b = this.g.ball;
    const [tx, tz] = to === 'you' ? this.game.player.pos() : [this.opp.x, this.opp.z];
    const T = 0.25 + dist(b.x, b.z, tx, tz) * 0.07; // (a longer one now, from the free-throw line)
    this.H.launch(b, tx, 1.2, tz, T);
    b.kind = 'check';
    b.to = to;
    passFrom(b, to === 'you' ? this.opp.char : this.game.player.char, to === 'you' ? this.game.player.char : this.opp.char);
    // (a chest pass across, caught with both hands)
    const you = this.game.player.char;
    const him = this.opp.char;
    const now = this.game.time;
    if (to === 'you') {
      if (him) markPass(him, now);
      markCatch(you, now + T);
    } else {
      markPass(you, now);
      if (him) markCatch(him, now + T);
    }
  }

  checkArrive() {
    const b = this.g.ball;
    const C = this.check;
    b.mode = 'held';
    b.holder = b.to === 'you' ? 'you' : this.opp;
    C.t = 0;
    if (C.stage === 'toDef') C.stage = 'defHolds';
    else if (C.stage === 'toYou') C.stage = 'youHold';
    else if (C.stage === 'back') {
      // Checked: ball's in.
      const off = C.off;
      this.check = null;
      this.give(off, true);
      this.game.hud.toast("Ball's in", '#ffd23f');
    }
  }

  // ---- Passing (shooting around) ----
  // Anyone on the court who hasn't got a ball: people shooting around who are waiting, people
  // watching, passers-by on the court. (Other players too, once there's multiplayer.)
  passTargets() {
    const game = this.game;
    const P = this.H.site.pad;
    const [px, pz] = game.player.pos();
    const busy = new Set();
    for (const H of game.hoops || []) for (const g of H.groups) if (g.ball.holder && g.ball.holder !== 'you') busy.add(g.ball.holder);
    return game.peds.peds.filter((q) => !q.removed && q.standing && !q.kid && q.state !== 'flee' && !busy.has(q)
      && q.x > P.x0 && q.x < P.x1 && q.z > P.z0 && q.z < P.z1 && dist(px, pz, q.x, q.z) < 22 && dist(px, pz, q.x, q.z) > 1);
  }

  // Who you're facing (your body first, then the camera).
  facingTarget(list) {
    const game = this.game;
    const p = game.player;
    const [px, pz] = p.pos();
    let best = null;
    let bs = -Infinity;
    for (const yaw of [p.heading, game.camYaw]) {
      for (const q of list) {
        const d = dist(px, pz, q.x, q.z) || 1;
        const c = ((q.x - px) * Math.sin(yaw) + (q.z - pz) * Math.cos(yaw)) / d;
        const s = c - d * 0.01;
        if (c > 0.5 && s > bs) {
          bs = s;
          best = q;
        }
      }
      if (best) return best;
    }
    return null;
  }

  // The next one over on screen (dir 1: to the right).
  nextOver(cur, dir, list) {
    const cam = this.game.camera;
    const v = new THREE.Vector3();
    v.set(cur.x, 1.3, cur.z).project(cam);
    const x0 = v.x;
    let best = null;
    let bs = Infinity;
    for (const q of list) {
      if (q === cur) continue;
      v.set(q.x, 1.3, q.z).project(cam);
      if (v.z > 1) continue;
      const dx = (v.x - x0) * dir;
      if (dx > 0.01 && dx < bs) {
        bs = dx;
        best = q;
      }
    }
    return best;
  }

  // ✕ held: locked on (the arrow over him); flick or swipe to change who; let go and it's thrown.
  // Returns true while it's taking your buttons.
  passing(dt, a) {
    const game = this.game;
    const b = this.g.ball;
    const held = a.bPass;
    const can = this.has === 'you' && b.mode === 'held' && !this.shot && !this.you.move;
    if (!can && !this.pass && held && !this.prevPass && b.mode === 'loose' && !this.fetch) {
      const [px, pz] = game.player.pos();
      if (dist(px, pz, b.x, b.z) > 7) this.callFetch();
    }
    if (!this.pass) {
      if (held && !this.prevPass && can) {
        const list = this.passTargets();
        this.pass = { target: this.facingTarget(list) || list[0] || null, acc: 0, flick: false };
        if (!this.pass.target) {
          this.pass = null;
          game.hud.toast('Nobody to pass to', '#9fc3ff');
        }
      }
      this.prevPass = held;
      if (!this.pass) {
        this.passMarkShow(null);
        return false;
      }
    }
    this.prevPass = held;
    const P = this.pass;
    const list = this.passTargets();
    if (P.target && !list.includes(P.target)) P.target = this.facingTarget(list);
    // Picking: the right stick on a controller, the camera (mouse / swipe) otherwise.
    let dir = 0;
    if (game.input.mode === 'pad' && !game.input.touchMode) {
      const x = a.bStickX || 0;
      if (Math.abs(x) > 0.6 && !P.flick) {
        dir = Math.sign(x);
        P.flick = true;
      } else if (Math.abs(x) < 0.3) P.flick = false;
    } else {
      P.acc += a.lookX;
      if (Math.abs(P.acc) > 0.06) {
        dir = P.acc < 0 ? 1 : -1;
        P.acc = 0;
      }
    }
    a.lookX = a.lookY = 0;
    if (dir && P.target) P.target = this.nextOver(P.target, dir, list) || P.target;
    // Face him while you pick (you can still walk).
    if (P.target) {
      const p = game.player;
      p.heading = Math.atan2(P.target.x - p.x, P.target.z - p.z);
    }
    this.passMarkShow(P.target);
    if (!held) {
      // Let go: it's on its way.
      this.pass = null;
      this.passMarkShow(null);
      if (P.target && can) this.throwPass(P.target);
      return false;
    }
    return true;
  }

  passMarkShow(q) {
    if (!this.passMark) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      m.rotation.x = Math.PI;
      this.game.scene.add(m);
      this.passMark = m;
    }
    this.passMark.visible = !!q;
    if (q) this.passMark.position.set(q.x, 2.55 + Math.sin(this.game.time * 6) * 0.07, q.z);
  }

  throwPass(q) {
    const game = this.game;
    const b = this.g.ball;
    const p = game.player;
    const [px, pz] = p.pos();
    const d = dist(px, pz, q.x, q.z);
    b.x = px + Math.sin(p.heading) * 0.35;
    b.z = pz + Math.cos(p.heading) * 0.35;
    b.y = 1.25;
    // (lead him a little if he's walking)
    const T = 0.25 + d / 15;
    const sp = q.speed || 0;
    this.H.launch(b, q.x + Math.sin(q.heading) * sp * T, 1.2, q.z + Math.cos(q.heading) * sp * T, T);
    b.kind = 'pass';
    b.to = q;
    passFrom(b, p.char, q.char);
    this.has = null;
    markPass(p.char, game.time);
    markCatch(q.char, game.time + T);
  }

  // He catches it (or it gets away and rolls).
  passArrive() {
    const b = this.g.ball;
    const q = b.to;
    if (q && !q.removed && q.standing && dist(q.x, q.z, b.x, b.z) < 1.6) {
      b.mode = 'held';
      b.holder = q;
      this.has = 'npc';
      this.npc = { q, t: 0, hold: rand(0.6, 1.2) };
      return;
    }
    b.mode = 'loose';
    b.vx = rand(-1, 1);
    b.vz = rand(-1, 1);
    b.vy = -1;
  }

  // His pass back: yours if you're there for it.
  backArrive() {
    const b = this.g.ball;
    const [px, pz] = this.game.player.pos();
    if (dist(px, pz, b.x, b.z) < 2) return this.give('you');
    b.mode = 'loose';
    b.vx = rand(-1, 1);
    b.vz = rand(-1, 1);
    b.vy = -1;
  }

  // Whoever you passed to: a look at the basket, then he shoots it or gives it back.
  npcBall(dt) {
    const N = this.npc;
    if (this.has !== 'npc' || !N) return;
    const game = this.game;
    const b = this.g.ball;
    const q = N.q;
    N.t += dt;
    if (q.removed || !q.standing || q.state === 'flee') {
      this.npc = null;
      b.mode = 'loose';
      b.vx = rand(-1, 1);
      b.vz = rand(-1, 1);
      b.vy = 0;
      this.has = null;
      return;
    }
    if (N.t < N.hold) return;
    this.npc = null;
    const rim = this.rim;
    const dR = dist(q.x, q.z, rim.x, rim.z);
    // Cutting to the rim: he lobs it up for you to finish (an alley-oop).
    {
      const [px, pz] = game.player.pos();
      const Y = this.you;
      const dY = dist(px, pz, rim.x, rim.z);
      const cut = ((Y.vx || 0) * (rim.x - px) + (Y.vz || 0) * (rim.z - pz)) / (dY || 1);
      if (cut > 2.5 && dY > 2.2 && dY < 10 && !Y.dunk && Y.fallT <= 0) {
        q.heading = Math.atan2(px - q.x, pz - q.z);
        b.x = q.x;
        b.z = q.z;
        this.startOop('you', 'lob', q.x, q.z, Y.vx || 0, Y.vz || 0);
        game.hud.toast('He throws it up!', '#ffd23f');
        if (this.fetch && this.fetch.q === q) this.releaseFetch();
        return;
      }
    }
    if (!N.back && dR < 8.5 && Math.random() < 0.5) {
      // Puts it up himself (you rebound it), squared up to the rim.
      q.heading = Math.atan2(rim.x - q.x, rim.z - q.z);
      const make = Math.random() < this.base(dR) * 0.8;
      const miss = make ? 0 : rand(0.22, 0.4);
      const ang = rand(0, Math.PI * 2);
      b.y = 2.2;
      this.H.launch(b, rim.x + Math.cos(ang) * miss, rim.y + 0.08, rim.z + Math.sin(ang) * miss * 0.6, 0.75 + dR * 0.06);
      b.kind = 'npcShot';
      b.make = make;
      this.has = null;
      return;
    }
    // Back to you.
    const [px, pz] = game.player.pos();
    b.y = 1.25;
    const TB = 0.25 + dist(q.x, q.z, px, pz) / 15;
    this.H.launch(b, px, 1.2, pz, TB);
    b.kind = 'back';
    passFrom(b, q.char, game.player.char);
    markPass(q.char, game.time);
    markCatch(game.player.char, game.time + TB);
    this.has = null;
    if (this.fetch && this.fetch.q === q) this.releaseFetch();
  }

  // ---- Shooting around: the whole court ----
  // Past 5/8 of the way to the other end, that basket's yours (the camera swings round to it).
  // Walk over any other ball lying about and you've got it (the one you had stays where it rolls).
  soloCourt(dt, px, pz) {
    const game = this.game;
    const rim = this.rim;
    const other = this.H.site.hoops.find((r) => r !== rim);
    if (other) {
      const L = dist(rim.x, rim.z, other.x, other.z) || 1;
      if (((px - rim.x) * rim.dx + (pz - rim.z) * rim.dz) / L > 5 / 8) {
        this.rim = other;
        this.g.rim = other;
        this.camSwingT = 0.9;
      }
    }
    // Strays: balls you left rolling. When they stop they're spares again.
    for (const st of [...(this.strays || [])]) {
      const b = st.b;
      if (b.mode === 'flight') {
        b.t += dt;
        const k = Math.min(1, b.t / b.T);
        b.x = b.p0[0] + (b.p1[0] - b.p0[0]) * k;
        b.z = b.p0[2] + (b.p1[2] - b.p0[2]) * k;
        const t = Math.min(b.t, b.T);
        b.y = b.p0[1] + b.vy0 * t - 0.5 * G * t * t;
        if (b.t >= b.T) {
          b.mode = 'loose';
          b.vx = b.vx || rand(-1, 1);
          b.vz = b.vz || rand(-1, 1);
          b.vy = -1;
        }
      } else this.H.roll(b, dt);
      b.mesh.position.set(b.x, b.y, b.z);
      if (b.mode === 'loose' && b.y <= 0.2 && Math.hypot(b.vx, b.vz) < 0.08 && Math.abs(b.vy) < 0.1) {
        this.strays.splice(this.strays.indexOf(st), 1);
        this.spares.push({ H: this.H, mesh: b.mesh, home: [b.x, b.z] });
      }
    }
    // Picking up another ball (when yours is loose and not on its way to someone).
    const b = this.g.ball;
    if (this.has !== 'you' && b.mode === 'loose' && !this.fetch) {
      let pick = null;
      for (const sp of this.spares) {
        if (sp.H !== this.H || !sp.mesh.visible) continue;
        const d = dist(px, pz, sp.mesh.position.x, sp.mesh.position.z);
        if (d < 0.9 && (!pick || d < pick.d)) pick = { sp, d };
      }
      for (const st of this.strays || []) {
        const d = dist(px, pz, st.b.x, st.b.z);
        if (st.b.y < 1.5 && d < 0.9 && (!pick || d < pick.d)) pick = { st, d };
      }
      if (pick && dist(px, pz, b.x, b.z) > 1.2) {
        (this.strays ||= []).push({ b }); // (yours keeps rolling where it is)
        let nb;
        if (pick.sp) {
          this.spares.splice(this.spares.indexOf(pick.sp), 1);
          const m = pick.sp.mesh;
          nb = { mesh: m, x: m.position.x, y: m.position.y, z: m.position.z, vx: 0, vy: 0, vz: 0, mode: 'held', holder: 'you', t: 0 };
        } else {
          this.strays.splice(this.strays.indexOf(pick.st), 1);
          nb = pick.st.b;
        }
        this.g.ball = nb;
        this.give('you');
      }
    }
  }

  // "Get that for me": the nearest one on the court without a ball goes after yours and
  // passes it back.
  callFetch() {
    const game = this.game;
    const b = this.g.ball;
    let q = null;
    for (const c of this.passTargets()) if (!q || dist(c.x, c.z, b.x, b.z) < dist(q.x, q.z, b.x, b.z)) q = c;
    // Somebody with a ball closer to you than anybody can get to yours: he gives you his and
    // his group goes and gets the loose one.
    const [px, pz] = game.player.pos();
    let hg = null;
    for (const G of this.H.groups) {
      const h = G.ball.holder;
      if (G.ball.mode !== 'held' || !h || h === 'you' || h.removed || h.state !== 'play') continue;
      if (!hg || dist(h.x, h.z, px, pz) < dist(hg.ball.holder.x, hg.ball.holder.z, px, pz)) hg = G;
    }
    if (hg && (!q || dist(hg.ball.holder.x, hg.ball.holder.z, px, pz) < dist(q.x, q.z, b.x, b.z))) return this.swapWith(hg);
    if (!q) return game.hud.toast('Nobody around to get it', '#9fc3ff');
    this.fetch = { q, saved: { act: q.act, state: q.state, keep: q.keep, sidewalk: q.sidewalk }, t: 0 };
    q.act = this;
    q.state = 'play';
    q.keep = true;
    q.sidewalk = false;
    game.hud.toast('"Aye, grab that for me!"', '#ffd23f');
  }

  // His ball comes to you; yours (where it lies) becomes his group's, and they go get it.
  swapWith(G) {
    const game = this.game;
    const mine = this.g.ball;
    const his = G.ball;
    const h = his.holder;
    const old = { mesh: mine.mesh, x: mine.x, y: mine.y, z: mine.z, vx: mine.vx, vy: mine.vy, vz: mine.vz };
    // (the balls trade places: the one in his hands is yours now)
    mine.mesh = his.mesh;
    mine.x = his.x;
    mine.y = Math.max(1.1, his.y);
    mine.z = his.z;
    his.mesh = old.mesh;
    Object.assign(his, { x: old.x, y: old.y, z: old.z, vx: old.vx, vy: old.vy, vz: old.vz, mode: 'loose', holder: null });
    his.mesh.position.set(his.x, his.y, his.z);
    if (h.hp?.role === 'hold') this.H.toWait(h);
    h.heading = Math.atan2(game.player.pos()[0] - h.x, game.player.pos()[1] - h.z);
    const [px, pz] = game.player.pos();
    this.H.launch(mine, px, 1.2, pz, 0.25 + dist(h.x, h.z, px, pz) / 15);
    mine.kind = 'back';
    this.has = null;
    game.hud.toast('"Here, take mine"', '#ffd23f');
  }

  fetchDrive(p, dt) {
    const F = this.fetch;
    const b = this.g.ball;
    F.t += dt;
    if (this.has === 'npc' && b.holder === p) {
      const [px, pz] = this.game.player.pos();
      p.heading = lerpAngle(p.heading, Math.atan2(px - p.x, pz - p.z), Math.min(1, dt * 8));
      return { speed: 0 };
    }
    if (b.mode !== 'loose' || this.has === 'you' || F.t > 15) {
      this.releaseFetch();
      return { speed: 0 };
    }
    if (dist(p.x, p.z, b.x, b.z) < 0.8 && b.y < 1.2) {
      b.mode = 'held';
      b.holder = p;
      this.has = 'npc';
      this.npc = { q: p, t: 0, hold: 0.45, back: true };
      return { speed: 0 };
    }
    return { tx: b.x + b.vx * 0.3, tz: b.z + b.vz * 0.3, speed: 3.8 };
  }

  releaseFetch() {
    const F = this.fetch;
    if (!F) return;
    this.fetch = null;
    const q = F.q;
    if (q.removed) return;
    q.act = F.saved.act;
    q.keep = F.saved.keep;
    q.sidewalk = F.saved.sidewalk;
    if (F.saved.state === 'play' && F.saved.act?.toWait && q.hp?.g) {
      q.state = 'play';
      F.saved.act.toWait(q);
    } else if (q.standing && q.state !== 'flee') q.resumeWalking();
  }

  // ---- Helpers ----
  topOfKey() {
    return [this.rim.x + this.rim.dx * 8, this.rim.z + this.rim.dz * 8];
  }

  // The check-up camera: aimed at the basket from behind the middle of the two of you, pulled
  // back, so both of you are in it whichever end you're at; after, it eases back onto you.
  checkCam(dt) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const on = !!this.check && !this.t33;
    const tx = on ? (px + this.opp.x) / 2 : px;
    const tz = on ? (pz + this.opp.z) / 2 : pz;
    const F = (this.camF ||= { x: px, z: pz, back: 0, up: 0 });
    const k = Math.min(1, dt * 4);
    F.x += (tx - F.x) * k;
    F.z += (tz - F.z) * k;
    F.back += ((on ? 2.6 : 0) - F.back) * k;
    F.up += ((on ? 0.8 : 0) - F.up) * k;
    if (on) game.camYaw = lerpAngle(game.camYaw, Math.atan2(this.rim.x - F.x, this.rim.z - F.z), Math.min(1, dt * 5));
    if (!on && dist(F.x, F.z, px, pz) < 0.03 && F.back < 0.03) {
      game.camFocus = null;
      this.camF = null;
      return;
    }
    game.camFocus = F;
  }

  // Which side of someone (at x, z facing h) the ball is: 1 his right, -1 his left.
  sideOfBall(x, z, h) {
    const b = this.g.ball;
    return (b.x - x) * -Math.cos(h) + (b.z - z) * Math.sin(h) >= 0 ? 1 : -1;
  }

  // A reach-in foul: the whistle. A beat where nobody moves (his hand comes down on the arm, he
  // owns it with a hand up, the one hacked throws his arms out), then the check-up.
  foulBeat(fouler, off, why) {
    const game = this.game;
    const fc = fouler === 'you' ? game.player.char : this.opp.char;
    const vc = fouler === 'you' ? this.opp.char : game.player.char;
    reachHit(fc);
    markFoul(fc, game.time, true);
    markFoul(vc, game.time, false);
    this.foul = { t: 0, T: 1.2, off, why };
    game.hud.toast('Reach-in foul!', '#ffd23f');
  }

  // Is the defender at (dx, dz) really trailing the driver at (sx, sz), coming from behind: at
  // least 0.7 m further from the rim along the drive, not off to the side, and in reach. (Only
  // then is it a chase-down.)
  trailing(dx, dz, sx, sz) {
    const rx = this.rim.x - sx;
    const rz = this.rim.z - sz;
    const rl = Math.hypot(rx, rz) || 1;
    const along = ((dx - sx) * rx + (dz - sz) * rz) / rl; // (+ toward the rim)
    const side = Math.abs(((dx - sx) * -rz + (dz - sz) * rx) / rl);
    return along < -0.7 && side < 1.3 && dist(dx, dz, sx, sz) < 2.6;
  }

  // A defensive jump by who: a block (the other one has it, or just let it go) or a rebound.
  jumpKind(who) {
    const other = who === 'you' ? 'opp' : 'you';
    const F = this.flight;
    if (this.has === other || (F && F.by === other && this.g.ball.t < 0.35) || this.oop?.by === other) return 'block';
    return 'rebound';
  }

  // ---- Heat check / on fire (both of you, the same) ----
  onFire(who) {
    return !this.t33 && this.heat?.[who]?.st === 'fire';
  }

  // A shot by who ('you' / 'opp') went in or didn't. Two in a row: the next one's a heat check
  // (the ball smokes). Hit the heat check: on fire for up to the next 3 shots while they keep
  // going in (a fire trail, a 20% bigger window, no range), and the rim blows up on every one.
  // A miss (or getting blocked) ends it.
  heatResult(who, make) {
    if (this.t33 || !this.heat) return;
    const H = this.heat[who];
    const game = this.game;
    const name = who === 'you' ? 'You' : this.opp?.ballName || 'He';
    if (!make) {
      // A miss: shooting around it's over; in a game it only ends if he loses the ball
      // (possession), though a miss on fire still uses up one of the fire shots.
      if (this.solo) return this.heatLose(who);
      if (H.st === 'fire') {
        H.left -= 1;
        if (H.left <= 0) this.heatLose(who);
      }
      return;
    }
    H.n += 1;
    const boom = () => {
      const r = this.rim;
      this.fx?.explode(r.x, r.y, r.z);
      game.shakeCamera?.(0.08, 0.3);
    };
    if (H.st === 'check') {
      H.st = 'fire';
      H.left = 3;
      boom();
      game.hud.toast(who === 'you' ? "YOU'RE ON FIRE!" : `${name.toUpperCase()} IS ON FIRE!`, '#ff9a3c');
    } else if (H.st === 'fire') {
      boom();
      H.left -= 1;
      if (H.left <= 0) {
        H.st = null;
        H.n = 0;
        game.hud.toast(who === 'you' ? 'The fire burns out' : `${name}'s fire burns out`, '#ffd23f');
      }
    } else if (H.n >= 2) H.st = 'check'; // (the message waits for the shot itself: heatShot)
  }

  // Heat gone (a miss shooting around, or the ball changing hands without a score).
  heatLose(who) {
    const H = this.heat?.[who];
    if (!H) return;
    const name = who === 'you' ? 'You' : this.opp?.ballName || 'He';
    if (H.st === 'fire') this.game.hud.toast(`${name} cooled off`, '#9fc3ff');
    H.n = 0;
    H.st = null;
    H.left = 0;
  }

  // Who has the ball changed (a rebound, a steal, a check-up): the one who lost it without
  // scoring (make it, take it: a bucket keeps it) loses his heat.
  possession(who) {
    if (this.solo || this.t33 || (who !== 'you' && who !== 'opp')) return;
    if (this.poss && this.poss !== who) this.heatLose(this.poss);
    this.poss = who;
  }

  // Going up with a heat check: now it says so.
  heatShot(who, type) {
    if (this.t33 || this.heat?.[who]?.st !== 'check') return;
    if (this.solo && (type === 'layup' || type === 'dunk')) return; // (shooting around: jumpers only)
    const name = who === 'you' ? '' : `${this.opp?.ballName || 'He'}: `;
    this.game.hud.toast(`${name}HEAT CHECK!`, '#ffb36b');
  }

  // Smoke or flames off the ball, whoever's it is (holding it or just shot it).
  heatFx(dt) {
    if (!this.heat) return;
    this.fx = this.fx || new HeatFx(this.game.scene);
    const b = this.g.ball;
    const who = this.has === 'you' || this.has === 'opp' ? this.has : this.flight ? this.flight.by : null;
    const st = who && this.heat[who].st;
    if (st === 'check') this.fx.smoke(b.x, b.y, b.z, dt);
    else if (st === 'fire') this.fx.fire(b.x, b.y, b.z, dt, b.mode === 'flight');
    this.fx.update(dt);
  }

  // A loose ball on the floor past the painted lines.
  isOut(b) {
    const C = this.H.site.court;
    const m = 0.12;
    return b.y < 0.6 && (b.x < C.x0 - m || b.x > C.x1 + m || b.z < C.z0 - m || b.z > C.z1 + m);
  }

  onCourt(x, z) {
    const C = this.H.site.court;
    return [clamp(x, C.x0 + 0.6, C.x1 - 0.6), clamp(z, C.z0 + 0.6, C.z1 - 0.6)];
  }

  // How open a shooter at (sx, sz) is with the defender at (dx, dz): 0 wide open .. 3 heavily.
  openness(sx, sz, dx, dz, beaten, handsUp) {
    if (beaten) return 0;
    const d = dist(sx, sz, dx, dz);
    const rx = this.rim.x - sx;
    const rz = this.rim.z - sz;
    const rl = Math.hypot(rx, rz) || 1;
    const front = ((dx - sx) * rx + (dz - sz) * rz) / ((d || 1) * rl) > 0.2;
    if (!front && d > 1.2) return 0;
    let lv = d > 3 ? 0 : d > 2 ? 1 : d > 1.05 ? 2 : 3;
    if (handsUp && d < 1.6) lv = Math.min(3, lv + 1);
    return lv;
  }

  // A white (non-green) release's chance before timing and the defense: falls off past 9 m
  // to next to nothing from half court on.
  base(d) {
    if (d < 2) return 0.72;
    if (d <= 9) return Math.max(0.3, 0.8 - d * 0.055);
    return Math.max(0.001, 0.305 * Math.pow(0.6, d - 9));
  }

  give(who, check = false) {
    const b = this.g.ball;
    // (off the floor: whoever gets it scoops it up)
    if (b.mode === 'loose' && (who === 'you' || who === 'opp') && !this.t33) {
      const c = who === 'you' ? this.game.player.char : this.opp.char;
      if (b.y < 0.7) markScoop(c, this.game.time);
      else markGrab(c, this.game.time, b.y > 1.7); // (a rebound: snatched and chinned)
    }
    this.has = who;
    if (who === 'you' || who === 'opp') this.lastHas = who;
    this.possession(who);
    this.touch = null;
    b.mode = 'held';
    b.holder = who === 'you' ? 'you' : this.opp;
    this.shot = null;
    if (check) this.cleared = true;
    if (who === 'opp') {
      const hp = this.opp.hp;
      hp.role = 'opp';
      hp.state = 'walk';
      hp.t = 0;
      hp.plan = { spot: check ? this.topOfKey() : null };
      hp.combo = 0;
      hp.holdT = 0;
    }
  }

  board() {
    return `YOU ${this.score.you} — ${this.score.opp} ${this.opp.ballName.toUpperCase()} · to ${this.to}${this.bet ? ` · $${this.bet}` : ''}`;
  }

  keys() {
    const inp = this.game.input;
    if (inp.touchMode) return { shoot: 'SHOOT', sprint: 'push the stick', d: 'D', steal: 'STEAL', block: '△', moves: 'CROSS / HESI / STEP / SPIN' };
    if (inp.mode === 'pad') return { shoot: '□', sprint: 'R2', d: 'L2', steal: '□', block: '△', moves: 'right stick' };
    return { shoot: 'hold click / Space', sprint: 'Shift', d: 'right-click', steal: 'click / R', block: 'F', moves: 'J L I K U O' };
  }

  // Unit vectors: toward the rim, and to the camera's right.
  dirs(x, z) {
    const rx = this.rim.x - x;
    const rz = this.rim.z - z;
    const rl = Math.hypot(rx, rz) || 1;
    const yaw = this.game.camYaw;
    return { ux: rx / rl, uz: rz / rl, d: rl, sx: -Math.cos(yaw), sz: Math.sin(yaw) };
  }

  // ---- Your buttons (main.js, before you move; they're taken off the action list) ----
  input(dt, a) {
    if (this.t3) this.t3.input(dt, a); // (the contest: your spot, the next ball, the run between racks)
    const game = this.game;
    const p = game.player;
    const Y = this.you;
    const opp = this.opp;
    const hp = opp.hp;
    const b = this.g.ball;
    let shootHeld = a.bShoot;
    const stealHit = a.bSteal;
    const blockHit = a.bBlock;
    const intense = a.bIntense;
    // (for an alley-oop in the air: the catch press, a defender going up)
    this.oopHits = { shoot: (this.oopHits?.shoot || (shootHeld && !this.prevShoot)), block: (this.oopHits?.block || blockHit) };
    let sprint = this.solo ? a.bSprintNoX : a.bSprint; // (shooting around, ✕ passes)
    if (this.t33) {
      // 33: picking, you walk about (a free ring pulls you onto it; press to take it). In play
      // you shoot from your spot; going after your rebound and walking back run themselves.
      const T = this.t33;
      const Y = T.players.find((P) => P.who === 'you');
      const [px, pz] = p.pos();
      const yaw = game.camYaw;
      const steer = (tx, tz) => {
        const dx = tx - px;
        const dz = tz - pz;
        const dl = Math.hypot(dx, dz) || 1;
        a.moveY = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / dl;
        a.moveX = (dx * -Math.cos(yaw) + dz * Math.sin(yaw)) / dl;
      };
      a.bMove = null;
      a.bStickX = a.bStickY = 0;
      if (T.phase === 'pick') {
        if (a.dealYes || (shootHeld && !this.prevShoot) || (a.interactHeld && !game.interactWasHeld)) T.pick = true;
        shootHeld = false;
        // (the magnet: near a free ring and not pushing hard away, you're eased onto its center)
        if (T.near != null && Math.hypot(a.moveX, a.moveY) < 0.6) {
          const [cx, cz] = T.spots[T.near];
          const k = Math.min(1, dt * 5);
          p.x += (cx - px) * k;
          p.z += (cz - pz) * k;
        }
      } else {
        a.moveX = a.moveY = 0;
        sprint = false;
        const b = this.g.ball;
        if ((Y.st === 'chase' || Y.st === 'air') && b.mode === 'loose' && dist(px, pz, b.x, b.z) > 0.3) {
          steer(b.x + b.vx * 0.25, b.z + b.vz * 0.25);
          sprint = true;
        } else if (Y.st === 'return' && Y.home && dist(px, pz, ...Y.home) > 0.25) {
          steer(...Y.home);
          sprint = true; // (hustling back)
        }
        // (your shot: your turn, on your spot, everybody back, nothing in the air)
        const mine = T.phase === 'play' && T.players[T.turn] === Y && Y.st === 'ready' && !T.inAir && T.wait <= 0 && T.players.every((P) => P.out || P.st === 'ready');
        if (!mine && !this.shot) shootHeld = false;
      }
      a.interactHeld = false;
    }
    if (this.solo && !this.t33 && !this.t3 && this.passing(dt, a)) {
      a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.reload = a.dealYes = a.enter = a.crouch = false;
      a.sprint = sprint;
      this.prevShoot = a.bShoot;
      return;
    }
    const stick = this.proStick(dt, a);
    const checkHit = a.dealYes || (a.interactHeld && !game.interactWasHeld && !this.solo) || (shootHeld && !this.prevShoot);
    if (this.solo && !this.t33 && !this.t3 && a.interactHeld && !game.interactWasHeld) {
      this.end('done');
      return;
    }
    a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.reload = a.dealYes = a.enter = a.crouch = false;
    // Switched baskets (shooting around): the camera swings round to the new one.
    if (this.camSwingT > 0) {
      this.camSwingT -= dt;
      const [qx, qz] = game.player.pos();
      game.camYaw = lerpAngle(game.camYaw, Math.atan2(this.rim.x - this.rim.dx * 1.5 - qx, this.rim.z - this.rim.dz * 1.5 - qz), Math.min(1, dt * 5));
    }
    // On the controller the right stick is the Pro Stick: the camera looks down the court. On a
    // phone the same (dragging to look still works: it goes back to the basket a moment after).
    const touch = game.input.touchMode;
    if (touch && (a.lookX || a.lookY)) this.camHold = 1.2;
    else this.camHold = Math.max(0, (this.camHold || 0) - dt);
    if (game.input.mode === 'pad' && (!touch || this.camHold <= 0)) {
      if (!touch) a.lookX = a.lookY = 0;
      // (at the basket from wherever you are: aimed at a spot just behind the rim, so from the top
      // of the key it's straight down the court and from a corner it still has the hoop in view)
      const [qx, qz] = game.player.pos();
      const want = Math.atan2(this.rim.x - this.rim.dx * 1.5 - qx, this.rim.z - this.rim.dz * 1.5 - qz);
      game.camYaw = lerpAngle(game.camYaw, want, Math.min(1, dt * 2.5));
    }
    this.checkCam(dt);
    // The whistle on a reach-in: nobody moves.
    if (this.foul) {
      this.clock += dt;
      a.moveX = a.moveY = 0;
      a.sprint = false;
      this.prevShoot = shootHeld;
      return;
    }
    // Resetting the play: you go on your own (to the ball, then your spot); SHOOT / ✕ / E skips.
    if (this.reset && !this.solo && !this.t33) {
      this.clock += dt;
      const R = this.reset;
      const [qx, qz] = game.player.pos();
      const [tx, tz] = this.resetTarget('you');
      const d = dist(qx, qz, tx, tz);
      if (d > 0.3) {
        const yaw = game.camYaw;
        const ux = (tx - qx) / d;
        const uz = (tz - qz) / d;
        const k = Math.min(1, d / 0.9);
        a.moveY = (ux * Math.sin(yaw) + uz * Math.cos(yaw)) * k;
        a.moveX = (ux * -Math.cos(yaw) + uz * Math.sin(yaw)) * k;
      } else {
        a.moveX = a.moveY = 0;
        const p = game.player;
        const [ox, oz] = [this.opp.x, this.opp.z];
        p.heading = lerpAngle(p.heading, Math.atan2(ox - qx, oz - qz), Math.min(1, dt * 8));
      }
      a.sprint = d > 4;
      if (checkHit && R.t > 0.4) R.skip = true;
      a.fire = a.firePressed = a.aim = a.aimPressed = a.melee = a.reload = a.dealYes = a.enter = a.crouch = false;
      this.prevShoot = shootHeld;
      return;
    }
    // Checking it up: nobody moves.
    if (this.check) {
      this.clock += dt;
      a.moveX = a.moveY = 0;
      a.sprint = false;
      const C = this.check;
      // (it goes on its own after a beat: checked up and checked back)
      const auto = C.t > 0.55;
      if ((checkHit || auto) && C.stage === 'ready') {
        C.stage = 'toDef';
        this.checkPass('opp');
      } else if ((checkHit || auto) && C.stage === 'youHold') {
        C.stage = 'back';
        this.checkPass('opp');
      }
      this.prevShoot = shootHeld;
      return;
    }
    this.clock += dt;
    Y.stealT = Math.max(0, Y.stealT - dt);
    Y.blockT = Math.max(0, Y.blockT - dt);
    Y.jumpT = Math.max(0, Y.jumpT - dt);
    Y.beatT = Math.max(0, Y.beatT - dt);
    const [px, pz] = p.pos();
    const D = this.dirs(px, pz);
    const moving = Math.hypot(a.moveX, a.moveY) > 0.3;
    // Energy.
    if (Y.st < 0.12) sprint = false;
    if (sprint && moving) Y.st = Math.max(0, Y.st - dt * 0.06); // (your energy lasts ~50% longer than his)
    else Y.st = Math.min(1, Y.st + dt * (moving ? 0.04 : 0.08));
    // On the floor (ankles): nothing.
    if (Y.fallT > 0) {
      Y.fallT -= dt;
      a.moveX = a.moveY = 0;
      a.sprint = false;
      this.prevShoot = shootHeld;
      return;
    }
    // A dunk in progress (the glide up, the hang, the drop): it moves you, not the stick.
    if (Y.dunk) {
      this.updateDunk(dt);
      a.moveX = a.moveY = 0;
      a.sprint = false;
      if (this.shot) this.shooting(dt, a, shootHeld, null);
      this.prevShoot = shootHeld;
      return;
    }
    Y.intense = false;
    Y.handsUp = false;
    hp.boxed = false;
    // (how you've been moving lately: for telling a drive to the rim)
    Y.vx = (Y.vx || 0) + ((p.vx || 0) - (Y.vx || 0)) * Math.min(1, dt * 8);
    Y.vz = (Y.vz || 0) + ((p.vz || 0) - (Y.vz || 0)) * Math.min(1, dt * 8);
    this.approaching = false;
    // ---- Offense ----
    if (this.has === 'you' && b.mode === 'held') {
      if (this.shot) {
        this.shooting(dt, a, shootHeld, stick);
        if (this.approaching) sprint = true;
      } else {
        // A dribble move (Pro Stick) or a size-up.
        Y.stickIdle = Math.hypot(a.moveX, a.moveY) < 0.2;
        // Combos: a flick during a move goes in the queue and fires the moment it ends; a quick
        // crossover can be cut a little past halfway (so left-right is a double crossover), and a
        // hesitation by any move but another hesitation.
        if (stick) {
          const mv = Y.move;
          const cut = !mv || (mv.kind === 'hesi' && mv.t > 0.08) || (!mv.big && mv.kind === 'cross' && mv.t > mv.T * 0.55);
          if (cut) this.startMove(stick.kind, stick.side, sprint);
          else Y.queued = { kind: stick.kind, side: stick.side, big: sprint, t: 0.35 };
        }
        if (Y.queued && (Y.queued.t -= dt) <= 0) Y.queued = null;
        Y.sizeUp = !!a.bSizeUp || this.psHoldUp;
        if (Y.sizeUp && !Y.move) {
          Y.rhythm = Math.min(0.3, Y.rhythm + dt * 0.25);
          a.moveX = a.moveY = 0;
        } else if (this.clock - Y.lastMoveEnd > 1.5) Y.rhythm = Math.max(0, Y.rhythm - dt * 0.2);
        if (Y.move) {
          const big = Y.move.big;
          const quickCross = !big && Y.move.kind === 'cross';
          this.doMove(dt, a);
          sprint = big || quickCross; // (with R2 a move's a burst; a quick crossover's a quick shuffle)
          // (the next one in the combo, straight away)
          if (!Y.move && Y.queued) {
            const q = Y.queued;
            Y.queued = null;
            this.startMove(q.kind, q.side, q.big);
          }
        }
        // Facing up: hold L2 (right-click) and you stay square to the basket whichever way you
        // go: backing up is a low shuffle, sideways a side-step (slower, no sprint). Without it,
        // going away from the basket you just turn and go. (On a phone the back-pedal's automatic.)
        Y.backpedal = Y.squareUp = false;
        if (!Y.move && !Y.sizeUp && Math.hypot(a.moveX, a.moveY) > 0.3) {
          const yaw = game.camYaw;
          const wx = Math.sin(yaw) * a.moveY - Math.cos(yaw) * a.moveX;
          const wz = Math.cos(yaw) * a.moveY + Math.sin(yaw) * a.moveX;
          const away = (wx * D.ux + wz * D.uz) / Math.hypot(wx, wz) < -0.3;
          if (a.bIntense || (game.input.touchMode && away)) {
            Y.squareUp = true;
            Y.backpedal = away;
            const k = away ? 0.65 : 0.8;
            a.moveX *= k;
            a.moveY *= k;
            sprint = false;
          }
        }
        // Keep it in the outside hand, away from trouble.
        // (the steps into a layup or dunk are a run)
        if (!Y.move && !Y.sizeUp) this.protect(dt);
        // The shot (on the press).
        if (shootHeld && !this.prevShoot && !this.shot) this.startShot(a, sprint, moving, D);
        // △: off the backboard to yourself (an alley-oop) from 3 to 9.5 m out.
        else if (blockHit && !this.t33 && !this.shot && D.d > 3 && D.d < 9.5 && (this.solo || this.cleared)) this.tossOop();
      }
    } else {
      if (this.shot) this.shot = null;
      Y.move = null;
      Y.sizeUp = false;
    }
    // Coming down from a shot the stick can't turn you in the air; off a fadeaway you land and
    // back-pedal a step (still facing the basket) before you can turn and go.
    if (Y.fall) {
      a.moveX = a.moveY = 0;
      sprint = false;
    } else if (Y.settle > 0) {
      Y.settle -= dt;
      a.moveX *= 0.65;
      a.moveY *= 0.65;
      sprint = false;
    }
    // ---- Defense ----
    if (this.has === 'opp' || b.mode !== 'held') {
      const dO = dist(px, pz, opp.x, opp.z);
      if (intense && this.has === 'opp') {
        Y.intense = true;
        sprint = false;
        a.moveX *= 0.85;
        a.moveY *= 0.85;
        // GUARD's pull: in close, you're drawn to the spot between him and the basket and keep
        // pace with him (stronger with better defense), unless you push the other way to where
        // he's going, or he's just beaten you.
        if (dO < 3.6 && Y.beatT <= 0 && Y.fallT <= 0) {
          const yaw = game.camYaw;
          const sx = Math.sin(yaw) * a.moveY - Math.cos(yaw) * a.moveX;
          const sz = Math.cos(yaw) * a.moveY + Math.sin(yaw) * a.moveX;
          const sl = Math.hypot(sx, sz);
          const ov = Math.hypot(hp.vx || 0, hp.vz || 0);
          const against = sl > 0.3 && ov > 0.8 && (sx * hp.vx + sz * hp.vz) / (sl * ov) < -0.3;
          if (!against) {
            const dr = dist(opp.x, opp.z, this.rim.x, this.rim.z) || 1;
            const gap = Math.min(1.1, dr * 0.5);
            const ix = opp.x + ((this.rim.x - opp.x) / dr) * gap + (hp.vx || 0) * 0.12; // (a touch ahead of where he's going)
            const iz = opp.z + ((this.rim.z - opp.z) / dr) * gap + (hp.vz || 0) * 0.12;
            const ex = ix - px;
            const ez = iz - pz;
            const el = Math.hypot(ex, ez);
            const pull = (0.42 + 0.48 * defK(this.defense)) * Math.min(1, (3.6 - dO) / 0.8);
            const reach = Math.min(1, el / 0.45);
            let wx = sx * (1 - pull) + (el > 1e-3 ? (ex / el) * reach : 0) * pull;
            let wz = sz * (1 - pull) + (el > 1e-3 ? (ez / el) * reach : 0) * pull;
            const wl = Math.hypot(wx, wz);
            if (wl > 1) {
              wx /= wl;
              wz /= wl;
            }
            // (and keeping pace: a quicker slide while he's moving, the better your D the closer)
            const pace = ov > 2 ? 1 + 0.35 * defK(this.defense) : 1;
            a.moveY = (wx * Math.sin(yaw) + wz * Math.cos(yaw)) * pace;
            a.moveX = (wx * -Math.cos(yaw) + wz * Math.sin(yaw)) * pace;
            Y.magnet = pull;
          }
        }
      }
      // Hands up (right stick / I / HANDS held): contesting without leaving the floor.
      Y.handsUp = !!a.bHands && (this.has === 'opp' || (this.flight?.by === 'opp' && b.mode === 'flight'));
      // Box out: intense D while the shot's up or the ball's loose.
      hp.boxed = intense && b.mode !== 'held' && dO < 1.7;
      if (Y.boxed) {
        // (he's boxing you out: you can't get round him easily)
        a.moveX *= 0.55;
        a.moveY *= 0.55;
        sprint = false;
      }
      if (stealHit && this.has === 'opp' && Y.stealT <= 0) this.trySteal(dO);
      if (blockHit && Y.blockT <= 0) {
        Y.blockT = 0.9;
        Y.jumpT = 0.55;
        if (this.has === 'opp' && hp.state === 'shoot') this.tryBlock(dO);
      }
    }
    // Beaten off the dribble: a step slow.
    if (Y.beatT > 0) {
      a.moveX *= 0.35;
      a.moveY *= 0.35;
      sprint = false;
    }
    // Tired: slower.
    const k = 0.75 + 0.25 * Y.st;
    a.moveX *= k;
    a.moveY *= k;
    a.sprint = sprint;
    this.prevShoot = shootHeld;
  }

  // The right stick (controller): a quick flick is a move; held up, a size-up.
  // Keyboard and touch send their moves straight in (a.bMove).
  proStick(dt, a) {
    if (a.bMove) return a.bIntense && a.bMove.kind === 'cross' ? { kind: 'legs', side: a.bMove.side } : a.bMove;
    const ps = this.you.ps;
    const x = a.bStickX || 0;
    const y = a.bStickY || 0;
    const m = Math.hypot(x, y);
    this.psHoldUp = false;
    if (m > 0.7) {
      if (!ps.on) Object.assign(ps, { on: true, t: 0, x, y });
      else ps.t += dt;
      if (ps.t > 0.3 && ps.y < -0.6) this.psHoldUp = true;
      return null;
    }
    if (m < 0.3 && ps.on) {
      ps.on = false;
      if (ps.t > 0.3) return null;
      const ang = Math.atan2(ps.x, -ps.y); // 0 = up, + = right
      const s = Math.sign(ang) || 1;
      const A = Math.abs(ang);
      if (A < 0.5) return { kind: 'hesi', side: 0 };
      if (A < 1.1) return { kind: 'behind', side: s };
      if (A < 2.0) return { kind: a.bIntense ? 'legs' : 'cross', side: s }; // (L2 held: between the legs)
      if (A < 2.6) return { kind: 'spin', side: s };
      return { kind: 'step', side: 0 };
    }
    return null;
  }

  // big: R2 (sprint) held: the exaggerated, burst version. Without it a crossover is a quick
  // one right in front of you (a small step to the side, chainable), and a flick toward the hand
  // the ball's already in is a hesitation (a hitch and a dip; with R2 the full stop-and-go).
  startMove(kind, side, big = false) {
    const Y = this.you;
    if (!MOVES[kind] || this.shot) return;
    // (Y.hand: the hand the ball's in, 1 right, -1 left. The moves that switch hands take it to
    // the side you're going: a crossover to the right ends in your right hand.)
    const p = this.game.player;
    const rx = -Math.cos(p.heading);
    const rz = Math.sin(p.heading);
    const D = this.dirs(...p.pos());
    const switches = kind === 'cross' || kind === 'behind' || kind === 'spin' || kind === 'legs';
    if (switches && !side) {
      // (no way given: the other hand, whichever way that is on screen)
      side = Math.sign((rx * D.sx + rz * D.sz) * -Y.hand) || 1;
    }
    const chain = this.clock - Y.lastMoveEnd < 0.7;
    Y.combo = chain ? Math.min(3, Y.combo + 1) : 0;
    Y.swap = null;
    Y.chainKinds = chain ? Y.chainKinds || [Y.lastMove] : [];
    const from = Y.hand;
    let to = switches ? Math.sign((D.sx * side) * rx + (D.sz * side) * rz) || -Y.hand : Y.hand;
    // (a crossover flicked toward the hand that's already got it: a hesitation that way)
    if (kind === 'cross' && to === from) kind = 'hesi';
    if (kind === 'hesi') to = from;
    if (Y.move) {
      if (kind === 'hesi' && Y.move.kind === 'hesi') return; // (out of a hesitation into anything but another)
      Y.lastMove = Y.move.kind;
      Y.lastMoveEnd = this.clock;
      Y.move = null;
    }
    const M = MOVES[kind];
    const quick = !big && (kind === 'cross' || kind === 'hesi');
    const T = quick ? (kind === 'cross' ? 0.2 : 0.28) : kind === 'hesi' ? 0.36 : M.T;
    Y.move = { kind, side, t: 0, T: T * (1.15 - 0.15 * Y.st), from, to, big: !quick, h0: p.heading };
    if (chain) Y.chainKinds.push(kind);
    else Y.chainKinds = [kind];
    Y.st = Math.max(0, Y.st - 0.027);
    Y.hand = to;
    Y.sizeUp = false;
    this.react(kind, Y.combo, Y.rhythm, !quick);
    Y.rhythm = 0;
  }

  // His read on your move: beaten, on the floor, picked, or he stays with you.
  react(kind, combo, rhythm, big = true) {
    const game = this.game;
    const opp = this.opp;
    const hp = opp.hp;
    const [px, pz] = game.player.pos();
    const d = dist(px, pz, opp.x, opp.z);
    if (d > 3.5 || hp.fallT > 0) return;
    const M = MOVES[kind];
    const def = 1.45 - (hp.def ?? this.r) / 100; // (his defense: the same scale as yours in GUARD)
    if (kind === 'step') {
      if (Math.random() < 0.65 * def * 1.2) hp.lagT = 0.7; // (he doesn't close out in time)
      return;
    }
    // Into him, the risky ones can get picked.
    if (M.risk && d < 1.0 && Math.random() < M.risk * (this.r / 75) * (1.4 - this.handle / 100)) {
      this.knockLoose('you', opp.x, opp.z, `${opp.ballName} picked your pocket`);
      return;
    }
    const p = (M.beat * (big ? 1 : 0.6) + combo * 0.1 + rhythm) * def * handleEff(this.handle) * (0.6 + 0.4 * this.you.st) * (0.8 + 0.2 * (1 - hp.st)); // (the quick ones beat him less on their own, more in a chain)
    if (Math.random() < p) {
      const already = hp.beatT > 0;
      hp.beatT = 0.75;
      this.gainHandle(0.25);
      if ((combo >= 1 || rhythm >= 0.15 || already) && Math.random() < 0.3) {
        this.gainHandle(0.5);
        hp.fallT = 1.2;
        game.hud.toast(`ANKLE BREAKER! ${opp.ballName}'s on the floor`, '#7ee081');
        for (const q of this.g.players) if (q.hp.role === 'watch') q.hp.cheerT = 1.2;
      }
    }
  }

  // A move in progress: the burst (it steers you), the ball switching hands.
  doMove(dt, a) {
    const game = this.game;
    const Y = this.you;
    const mv = Y.move;
    mv.t += dt;
    const [px, pz] = game.player.pos();
    const D = this.dirs(px, pz);
    let wx = 0;
    let wz = 0;
    const s = mv.side;
    let mag = 1;
    if (!mv.big && mv.kind === 'cross') {
      // (quick crossover: just a little step to that side, right where you are)
      wx = D.sx * s;
      wz = D.sz * s;
      mag = 0.59 * handleDist(this.handle); // (~0.9 m at a 90 handle)
    } else if (!mv.big && mv.kind === 'hesi') {
      // (quick hesitation: a hitch on the spot)
    } else if (mv.kind === 'cross' || mv.kind === 'behind' || mv.kind === 'legs') {
      wx = D.sx * s * 0.85 + D.ux * 0.5;
      wz = D.sz * s * 0.85 + D.uz * 0.5;
    } else if (mv.kind === 'spin') {
      const k = mv.t / mv.T;
      wx = D.sx * s * (1 - k) + D.ux * (0.4 + k);
      wz = D.sz * s * (1 - k) + D.uz * (0.4 + k);
    } else if (mv.kind === 'hesi') {
      // (R2: a hop out to the ball's side, ~1.2 m at a 90 handle)
      wx = -Math.cos(mv.h0) * mv.from;
      wz = Math.sin(mv.h0) * mv.from;
      mag = (1.2 * handleDist(this.handle)) / (7.5 * mv.T);
    } else if (mv.kind === 'step') {
      wx = -D.ux;
      wz = -D.uz;
    }
    const L = Math.hypot(wx, wz);
    if (L > 0.01) {
      // (world direction -> stick, camera-relative)
      const fx = Math.sin(game.camYaw);
      const fz = Math.cos(game.camYaw);
      if (mv.kind !== 'hesi' && (mv.big || mv.kind !== 'cross')) mag = Math.min(1, handleDist(this.handle)); // (how far it carries: your handle)
      a.moveY = ((wx * fx + wz * fz) / L) * mag;
      a.moveX = ((wx * -fz + wz * fx) / L) * mag;
      a.bSprint = mv.big || mv.kind === 'cross';
    } else a.moveX = a.moveY = 0;
    if (mv.t >= mv.T) {
      Y.lastMoveEnd = this.clock;
      Y.lastMove = mv.kind;
      Y.move = null;
      // (after a crossover you square back up to the basket, unless you're steering somewhere;
      // a moment's hold on the facing first, so the last step doesn't twist you round)
      if (mv.kind === 'cross' || mv.kind === 'legs' || mv.kind === 'behind' || mv.kind === 'spin') Y.squareT = 0.4;
      if (LOCKED.has(mv.kind) || mv.kind === 'spin') Y.holdH = { h: mv.h0, t: 0.12 };
    }
  }

  // ---- Your shot ----
  startShot(a, sprint, moving, D) {
    const Y = this.you;
    const game = this.game;
    const p = game.player;
    // Driving at the rim: how fast you've actually been going its way (the last ~0.2 s).
    const toward = Y.vx * D.ux + Y.vz * D.uz > 2.2;
    // The left stick right now, on the court: pulled back away from the rim = a floater.
    const yaw = game.camYaw;
    const sx = Math.sin(yaw) * a.moveY - Math.cos(yaw) * a.moveX;
    const sz = Math.cos(yaw) * a.moveY + Math.sin(yaw) * a.moveX;
    const pullBack = Math.hypot(sx, sz) > 0.4 && (sx * D.ux + sz * D.uz) / Math.hypot(sx, sz) < -0.4;
    let type = 'jumper';
    if (toward && pullBack && D.d > 1.5 && D.d < 6.5) type = 'floater';
    else if (D.d <= 3.8 && sprint && toward) type = 'dunk';
    else if (D.d <= 5 && toward) type = 'layup';
    const stepback = Y.move?.kind === 'step' || (Y.lastMove === 'step' && this.clock - Y.lastMoveEnd < 0.5);
    Y.move = null;
    // A fadeaway: a jumper going away from the basket (drifting back, the stick pulled back, or
    // off a step-back).
    const away = Y.vx * D.ux + Y.vz * D.uz < -1.2;
    const fade = type === 'jumper' && (away || stepback || (pullBack && !toward));
    // Square up: a small turn happens on the way up; facing away (over ~70°) you pivot on your
    // foot first, which takes a moment (half a turn ~0.35 s), and the meter waits for it.
    const off = Math.abs(wrapAngle(Math.atan2(D.ux, D.uz) - p.heading));
    const pivot = off > 1.2;
    const turnT = pivot ? off / 9 : 0;
    this.heatShot('you', type);
    this.shot = { type, t: 0, T: SHOTS[type].T * (type === 'jumper' ? SHOT_SPEED : 1) + turnT, W: greenWindow(type, this.onFire('you') ? Math.min(D.d, FIRE_RANGE) : D.d) * (this.t3 ? 0.8 : 1), d0: D.d, pts: D.d > ARC ? 2 : 1, onRun: moving && p.speed > 3, sprint, stepback, euro: false, pivot, turnT };
    // (a jumper off your right hand; a layup or floater off the hand the ball's in)
    this.shot.hand = type === 'jumper' ? 1 : (this.ballSide ?? Y.hand ?? 1) >= 0 ? 1 : -1;
    // A layup's hand: the side you're holding the left stick (right of the rim: right hand),
    // the hand it's in if you're pushing straight at it.
    if (type === 'layup' && Math.hypot(sx, sz) > 0.3) {
      const side = (sx * -D.uz + sz * D.ux) / Math.hypot(sx, sz);
      if (Math.abs(side) > 0.2) this.shot.hand = side > 0 ? 1 : -1;
    }
    if (type === 'layup') Y.hand = this.ballSide = this.shot.hand;
    // Layups and dunks: the gather, then the steps (the gather doesn't count as one: two are
    // allowed), then up off the last one. A layup goes up off the foot opposite the shooting
    // hand. A dunk from close in is a jump stop (both feet), from 1-2 m one step, beyond that two.
    let how = '';
    if (type === 'layup' || type === 'dunk') {
      const steps = type === 'layup' ? 2 : D.d > 2.5 ? 2 : D.d > 1.2 ? 1 : 0;
      // (where you go up from: 1.5 m out for a layup, 1.6 m for a dunk, or right here)
      const out = type === 'layup' ? 1.5 : 1.6;
      // (at the speed you were already going: the steps keep your momentum; close in, you just
      // go up nearer the rim rather than slowing down)
      const sp = Math.max(4.5, Math.hypot(Y.vx, Y.vz));
      const T = steps ? clamp((D.d - out) / sp, 0.25, 0.7) : 0.15;
      const go = steps ? clamp(sp * T, 0, D.d - (type === 'layup' ? 0.9 : 0.7)) : 0;
      this.shot.approach = { T, steps, tx: px0(p) + D.ux * go, tz: pz0(p) + D.uz * go };
      how = steps ? ` (gather + ${steps} step${steps > 1 ? 's' : ''})` : ' (jump stop)';
      if (type === 'layup') this.shot.T = T + 0.3; // (then up: the top of the jump is the release)
      else this.shot.T = T + 0.55;
    }
    Y.jumpT = 0;
    Y.fall = null; // (the jump's timed to the shot: the top of it is the perfect release)
    this.shot.fade = fade;
    Y.st = Math.max(0, Y.st - 0.013);
    // He closes out.
    this.opp.hp.closeT = 1;
  }

  shooting(dt, a, held, stick) {
    const s = this.shot;
    s.t += dt;
    a.moveX = a.moveY = 0;
    // The gather and the steps: you carry on to where you go up from, at the pace that gets you
    // there in time. Then the dunk takes over from the takeoff.
    const A = s.approach;
    if (A && !this.you.dunk) {
      const p = this.game.player;
      const [px, pz] = p.pos();
      if (s.t < A.T) {
        const r = dist(px, pz, A.tx, A.tz);
        if (r > 0.05) {
          const v = Math.min(8.5, r / Math.max(0.04, A.T - s.t));
          const wx = (A.tx - px) / r;
          const wz = (A.tz - pz) / r;
          const yaw = this.game.camYaw;
          const fx = Math.sin(yaw);
          const fz = Math.cos(yaw);
          const len = Math.min(1, v / 7.5);
          a.moveY = (wx * fx + wz * fz) * len;
          a.moveX = (wx * -fz + wz * fx) * len;
          this.approaching = true;
        }
      } else if (s.type === 'dunk') {
        // Up: from here to the rim.
        this.startDunk(0);
        this.you.dunk.rise = s.T - s.t;
      } else if (s.type === 'layup' && s.t < s.T) {
        // In the air, still carrying in toward the rim (to about half a meter out).
        const fx = this.rim.x + this.rim.dx * 0.6;
        const fz = this.rim.z + this.rim.dz * 0.6;
        const r = dist(px, pz, fx, fz);
        if (r > 0.05) {
          const step = Math.min(r, (r / Math.max(0.05, s.T - s.t)) * dt);
          p.x += ((fx - px) / r) * step;
          p.z += ((fz - pz) / r) * step;
        }
      }
    }
    // Turning to the basket: pivoting on the floor first if he's facing away, then in the air.
    const p = this.game.player;
    const [px, pz] = p.pos();
    const want = Math.atan2(this.rim.x - px, this.rim.z - pz);
    const d = wrapAngle(want - p.heading);
    const rate = s.t < s.turnT ? 9 : 14;
    p.heading += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    // Fading: drifting back through the jump, quickest on the way up.
    if (s.fade) this.fadeDrift(p, px, pz, Math.min(1, Math.max(0, s.t - s.turnT - 0.03) / 0.6), dt);
    a.bSprint = false;
    // Euro step: a Pro Stick move during the layup gather.
    if (s.type === 'layup' && stick && !s.euro && s.t < 0.3) {
      s.euro = true;
    }
    if (s.type === 'dunk') {
      if (s.t >= s.T) this.resolveYou(0);
      return;
    }
    if (!held || s.t >= s.T + LATE) {
      // A quick tap on a jumper: a pump fake.
      if (s.type === 'jumper' && s.t < 0.12 && !s.stepback) return this.pumpFake();
      // (let go sometime during the last frame: count it from the middle of it)
      this.resolveYou(held ? s.t - s.T : s.t - dt / 2 - s.T);
    }
  }

  // (the backward drift of a fadeaway, easing off over the jump; k 0..1)
  fadeDrift(p, px, pz, k, dt) {
    if (k >= 1) return;
    const rx = this.rim.x - px;
    const rz = this.rim.z - pz;
    const L = Math.hypot(rx, rz) || 1;
    const v = 2.2 * (1 - k);
    const [nx, nz] = this.onCourt(px - (rx / L) * v * dt, pz - (rz / L) * v * dt);
    p.x = nx;
    p.z = nz;
  }

  // Your height in a jump shot: a quick gather (after any pivot), up to the top of the jump right
  // at the perfect release, then coming down if you're still holding it.
  shotHeight(s) {
    const H = s.type === 'jumper' ? 0.45 : 0.55;
    const g0 = s.approach ? s.approach.T : s.turnT + 0.08;
    if (s.t < g0) return 0;
    const up = s.T - g0;
    const k = (s.t - g0) / Math.max(0.05, up);
    if (k <= 1) return H * Math.sin((k * Math.PI) / 2);
    return H * Math.max(0, Math.cos(Math.min(1, (s.t - s.T) / 0.3) * (Math.PI / 2)));
  }

  // ---- Dunks ----
  // Gather and glide in to just in front of the rim, rise (0.55 s), throw it down, hang on the
  // rim a moment if it went in, drop. Styles: two-hand, one-hand, windmill, tomahawk.
  startDunk(t0) {
    const p = this.game.player;
    const [px, pz] = p.pos();
    const rim = this.rim;
    const [ax, az] = this.dunkSpot(px, pz);
    this.you.dunk = {
      x0: px, z0: pz, ax, az,
      style: pick(['two', 'two', 'one', 'one', 'windmill', 'tomahawk']), t: t0, rise: 0.55, hang: 0.35, drop: 0.28, hangs: false, hand: this.you.hand ?? 1,
    };
  }

  // Where a dunk finishes: just out from the rim on the side you came in from (in front of the
  // backboard, never behind it).
  dunkSpot(x, z) {
    const rim = this.rim;
    let ux = x - rim.x;
    let uz = z - rim.z;
    let l = Math.hypot(ux, uz) || 1;
    ux /= l;
    uz /= l;
    const f = ux * rim.dx + uz * rim.dz;
    if (f < 0.3) {
      ux += rim.dx * (0.3 - f) * 1.4;
      uz += rim.dz * (0.3 - f) * 1.4;
      l = Math.hypot(ux, uz) || 1;
      ux /= l;
      uz /= l;
    }
    return [rim.x + ux * 0.45, rim.z + uz * 0.45];
  }

  updateDunk(dt) {
    const Y = this.you;
    const D = Y.dunk;
    const p = this.game.player;
    D.t += dt;
    const k = Math.min(1, D.t / D.rise);
    const e = 1 - (1 - k) * (1 - k);
    p.x = D.x0 + (D.ax - D.x0) * e;
    p.z = D.z0 + (D.az - D.z0) * e;
    p.speed = 0;
    p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
    const end = D.rise + (D.hangs ? D.hang : 0) + D.drop;
    if (D.t >= end && !this.shot) Y.dunk = null;
  }

  dunkHeight() {
    const D = this.you.dunk;
    if (!D) return 0;
    const H = 0.95;
    if (D.t < D.rise) return H * Math.sin((D.t / D.rise) * Math.PI * 0.5);
    let t = D.t - D.rise;
    if (D.hangs) {
      if (t < D.hang) return H;
      t -= D.hang;
    }
    return H * Math.max(0, 1 - (t / D.drop) ** 2);
  }

  // ---- Alley-oops ----
  // One move: the toss (off the glass to yourself, or a lob from a teammate), the run, the leap
  // and the catch. The ball comes down to a spot about a meter out from the rim on the side your
  // run is taking you (left wing, right wing, down the middle). Get within reach and the gather,
  // steps and leap play on their own, timed to meet it; the meter shows in the air: SHOOT at the
  // top. In the window: catch and throw it down (two-hand or windmill down the middle, one-hand
  // or tomahawk from the side). A little off: you catch it but only lay it in. Way off (or no
  // press): it comes off your hands. His are the same (his timing set by his rating), and the
  // defender can go up and break one up.

  // Where it comes down: ~1.15 m from the rim, on the side your run's taking you to.
  oopSpot(sx, sz, vx, vz) {
    const rim = this.rim;
    const sp = Math.hypot(vx, vz);
    let ux = sx + (sp > 1.5 ? vx * 0.9 : 0) - rim.x;
    let uz = sz + (sp > 1.5 ? vz * 0.9 : 0) - rim.z;
    let l = Math.hypot(ux, uz) || 1;
    ux /= l;
    uz /= l;
    // (never behind the backboard: at least a little out in front of it)
    const f = ux * rim.dx + uz * rim.dz;
    if (f < 0.25) {
      ux += rim.dx * (0.25 - f) * 1.4;
      uz += rim.dz * (0.25 - f) * 1.4;
      l = Math.hypot(ux, uz) || 1;
      ux /= l;
      uz /= l;
    }
    return [rim.x + ux * 1.15, rim.z + uz * 1.15];
  }

  // The window for the catch (seconds, full width): tighter with somebody on you.
  oopWindow(cx, cz, defX, defZ) {
    let w = 0.16;
    if (defX != null && dist(cx, cz, defX, defZ) < 1.3) w *= 0.7;
    if (this.game.input.touchMode) w *= 1.4;
    return w;
  }

  // Up it goes. by: who it's for ('you' / 'opp'); from: 'glass' (tossed off the backboard by
  // the one it's for) or 'lob' (thrown up by somebody else from x, z).
  startOop(by, from, x, z, vx, vz) {
    const b = this.g.ball;
    const rim = this.rim;
    const [cx, cz] = by === 'you' ? this.oopSpot(...this.game.player.pos(), vx, vz) : this.oopSpot(x, z, vx, vz);
    const CY = rim.y + 0.17; // (caught at the top of the leap, just above the rim)
    b.mode = 'flight';
    b.holder = null;
    this.has = null;
    this.shot = null;
    const O = { by, cx, cz, cy: CY, leap: null, press: null, broke: false, cleared: this.cleared };
    if (from === 'glass') {
      // (to the square on that side, then off it and down to the spot)
      const lat = ((cx - rim.x) * -rim.dz + (cz - rim.z) * rim.dx) * 0.3;
      const gx = rim.x - rim.dx * 0.3 - rim.dz * lat;
      const gz = rim.z - rim.dz * 0.3 + rim.dx * lat;
      const T1 = 0.4 + dist(x, z, gx, gz) / 14;
      b.x = x + (gx - x) * 0.05;
      b.z = z + (gz - z) * 0.05;
      b.y = 2.0;
      this.H.launch(b, gx, rim.y + 0.45, gz, T1);
      b.kind = 'oop';
      O.tCatch = this.clock + T1 + 0.55;
    } else {
      const T = 0.65 + dist(x, z, cx, cz) / 14;
      b.y = 2.0;
      this.H.launch(b, cx, CY, cz, T);
      b.kind = 'oop2';
      O.tCatch = this.clock + T;
    }
    this.oop = O;
  }

  // △ with the ball, 3-9.5 m out: off the glass to yourself.
  tossOop() {
    const game = this.game;
    const p = game.player;
    const [px, pz] = p.pos();
    const Y = this.you;
    this.startOop('you', 'glass', px + Math.sin(p.heading) * 0.3, pz + Math.cos(p.heading) * 0.3, Y.vx || 0, Y.vz || 0);
    Y.armsT = 0.3;
    game.hud.toast('Off the glass!', '#ffd23f');
  }

  // (it hit the board: off it and down to the spot)
  oopBounce() {
    const b = this.g.ball;
    const O = this.oop;
    if (!O) {
      b.mode = 'loose';
      b.vx = this.rim.dx * 2;
      b.vz = this.rim.dz * 2;
      b.vy = -1;
      return;
    }
    this.H.launch(b, O.cx, O.cy, O.cz, Math.max(0.2, O.tCatch - this.clock));
    b.kind = 'oop2';
  }

  // Every frame while one's up: the leap (when you're in reach), the catch, a defender going up.
  oopStep(dt, shootHit, blockHit) {
    const O = this.oop;
    if (!O) return;
    const b = this.g.ball;
    const game = this.game;
    const Y = this.you;
    const rim = this.rim;
    const left = O.tCatch - this.clock;
    if (b.mode !== 'flight' || (b.kind !== 'oop' && b.kind !== 'oop2' && !O.leap)) {
      if (!O.leap) this.oop = null;
    }
    if (!this.oop) return;
    if (O.by === 'you') {
      const [px, pz] = game.player.pos();
      // The leap: within a couple of meters of the spot with up to ~0.55 s to go (from further
      // out you have to run in first; get there late and it comes down without you).
      if (!O.leap && left <= 0.55 && left > 0.16 && Y.fallT <= 0 && !Y.dunk && dist(px, pz, O.cx, O.cz) < OOP_REACH) {
        O.leap = { t0: this.clock, w: this.oopWindow(O.cx, O.cz, this.solo ? null : this.opp.x, this.solo ? null : this.opp.z) };
        Y.dunk = { x0: px, z0: pz, ax: O.cx, az: O.cz, style: 'reach', t: 0, rise: left, hang: 0.4, drop: 0.32, hangs: true, oop: true };
        Y.fall = null;
        Y.follow = null;
      }
      if (O.leap && shootHit && O.press == null) O.press = this.clock;
    } else if (O.by === 'opp') {
      // You going up to break up his: △ near the ball as it comes down to him.
      if (blockHit && !O.broke && b.kind === 'oop2' && left > 0.02) {
        const [px, pz] = game.player.pos();
        if (dist(px, pz, b.x, b.z) < 1.4 && b.y < 3.7) {
          O.broke = true;
          if (Math.random() < 0.5) return this.breakOop('you', px, pz);
        }
      }
    }
    // His contest on yours: running to the spot; up for it if he gets there first.
    if (O.by === 'you' && !this.solo && !O.broke && b.kind === 'oop2') {
      const hp = this.opp.hp;
      const d = dist(this.opp.x, this.opp.z, b.x, b.z);
      if (d < 1.2 && b.y < 3.6 && left > 0.05 && hp.fallT <= 0) {
        O.broke = true;
        hp.jumpT = 0.6;
        const [px, pz] = game.player.pos();
        const first = dist(this.opp.x, this.opp.z, O.cx, O.cz) < dist(px, pz, O.cx, O.cz);
        if (Math.random() < 0.4 * (this.r / 75) * (first ? 1.3 : 0.6)) return this.breakOop('opp', this.opp.x, this.opp.z);
      }
    }
    // The catch: when the ball gets there (pressed already), or a moment later if you haven't
    // pressed yet (it's in your hands while you go to throw it down).
    if (O.by === 'you' && O.leap) {
      const late = O.leap.w / 2 + 0.12;
      if (left <= 0 && (O.press != null || -left >= late)) this.catchYou(O.press == null ? null : O.press - O.tCatch);
    }
    void rim;
    void dt;
  }

  // Broken up: who ('you' / 'opp') got a hand on it, from x, z. Mostly swatted away; sometimes
  // they come down with it.
  breakOop(who, x, z) {
    const b = this.g.ball;
    const game = this.game;
    const O = this.oop;
    this.oop = null;
    const by = O?.by;
    markSwat(who === 'you' ? game.player.char : this.opp.char, game.time);
    if (by === 'you' && this.you.dunk?.oop) this.you.dunk = { ...this.you.dunk, t: this.you.dunk.rise, style: 'two', hangs: false };
    if (by === 'opp') Object.assign(this.opp.hp, { state: 'oopLand', t: 0, landH: this.opp.hp.jump || 0, oopDunk: false });
    if (Math.random() < 0.35) {
      game.hud.toast(who === 'you' ? 'Picked off the oop!' : `${this.opp.ballName} picked off the oop`, who === 'you' ? '#7ee081' : '#ff8080');
      this.give(who);
      this.cleared = false;
      this.lastShooter = by;
      return;
    }
    this.lastShooter = by;
    this.touch = who; // (off his hand: out of bounds is the other one's)
    this.swatted(b.x, b.z, who === 'you' ? 'Broke up the oop!' : `${this.opp.ballName} broke up the oop`, by, x, z);
  }

  // Your catch at the top: e = how early (-) or late (+) you pressed, null for no press.
  catchYou(e) {
    const game = this.game;
    const b = this.g.ball;
    const Y = this.you;
    const O = this.oop;
    this.oop = null;
    const [px, pz] = game.player.pos();
    const w = O.leap.w;
    const m = e == null ? 1 : Math.abs(e) - w / 2;
    this.cleared = O.cleared ?? this.cleared;
    if (m <= 0) {
      // Caught clean: throw it down (style by the angle you came in at).
      b.mode = 'held';
      b.holder = 'you';
      this.has = 'you';
      const ux = px - this.rim.x;
      const uz = pz - this.rim.z;
      const straight = (ux * this.rim.dx + uz * this.rim.dz) / (Math.hypot(ux, uz) || 1) > 0.9;
      this.startDunk(0.16);
      const D = Y.dunk;
      D.rise = 0.24;
      D.style = straight ? pick(['two', 'windmill', 'two']) : pick(['one', 'tomahawk', 'one']);
      this.shot = { type: 'dunk', t: 0, T: D.rise - D.t, W: 0, d0: dist(px, pz, this.rim.x, this.rim.z), pts: 1, oop: true, turnT: 0 };
      this.opp.hp.closeT = 1;
      return;
    }
    // Coming down from here.
    if (Y.dunk) Y.dunk = { ...Y.dunk, t: Y.dunk.rise, hangs: false, style: 'two' };
    if (m < 0.12) {
      // Caught it, but only laid it in (or off the rim).
      const make = Math.random() < 0.72;
      b.x = px + Math.sin(game.player.heading) * 0.3;
      b.z = pz + Math.cos(game.player.heading) * 0.3;
      b.y = this.rim.y + 0.25;
      this.has = 'you';
      this.launch(make, 'you', 1, 0.35);
      game.hud.toast(`${e < 0 ? 'Early' : 'Late'}: caught it, laid it ${make ? 'in' : 'off the rim'}`, make ? '#ffd23f' : '#ff8080');
      return;
    }
    // Off your hands.
    b.mode = 'loose';
    b.holder = null;
    b.vx = rand(-1.5, 1.5) + this.rim.dx;
    b.vz = rand(-1.5, 1.5) + this.rim.dz;
    b.vy = 1.5;
    this.has = null;
    this.lastShooter = 'you';
    game.hud.toast(e == null ? 'Never went up for it: off your hands' : `${e < 0 ? 'Way early' : 'Way late'}: off your hands`, '#ff8080');
  }

  // His catch at the top (his timing off by an amount set by his rating).
  catchHim() {
    const game = this.game;
    const b = this.g.ball;
    const p = this.opp;
    const hp = p.hp;
    const O = this.oop;
    this.oop = null;
    const [px, pz] = game.player.pos();
    const w = this.oopWindow(O.cx, O.cz, px, pz) / (game.input.touchMode ? 1.4 : 1);
    const u = 1 - Math.random();
    const e = ((150 - this.r) / 1000) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    const m = Math.abs(e) - w / 2;
    this.cleared = O.cleared ?? this.cleared;
    hp.state = 'oopLand';
    hp.t = 0;
    hp.landH = hp.jump || 0;
    p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
    if (m <= 0 || m < 0.12) {
      const dunk = m <= 0;
      const make = Math.random() < (dunk ? 0.9 : 0.72);
      b.mode = 'held';
      b.holder = p;
      this.has = 'opp';
      b.x = p.x + Math.sin(p.heading) * 0.35;
      b.z = p.z + Math.cos(p.heading) * 0.35;
      b.y = this.rim.y + (dunk ? 0.15 : 0.25);
      this.launch(make, 'opp', 1, dunk ? 0.14 : 0.35);
      hp.oopDunk = dunk;
      game.hud.toast(dunk ? (make ? `${p.ballName}: ALLEY-OOP SLAM` : `${p.ballName} rims out the oop`) : `${p.ballName} catches the oop and lays it ${make ? 'in' : 'off'}`, make ? '#ff8080' : '#7ee081');
      if (dunk) game.shakeCamera?.(make ? 0.07 : 0.04, 0.3);
      return;
    }
    b.mode = 'loose';
    b.holder = null;
    b.vx = rand(-1.5, 1.5) + this.rim.dx;
    b.vz = rand(-1.5, 1.5) + this.rim.dz;
    b.vy = 1.5;
    this.has = null;
    this.lastShooter = 'opp';
    game.hud.toast(`The oop went off ${p.ballName}'s hands`, '#7ee081');
  }

  // ---- Ball protection ----
  // Turned sideways to trouble (him if he's close, otherwise the basket side), a ballhandler
  // switches it to the outside hand, the one away from it.
  // How he switches depends on which way he turned: toward the trouble, behind the back (the
  // ball never crosses in front of it); away from it, a crossover in front or between the legs.
  protect(dt) {
    const Y = this.you;
    const p = this.game.player;
    const [px, pz] = p.pos();
    const near = !this.solo && dist(px, pz, this.opp.x, this.opp.z) < 4.5;
    const tx = near ? this.opp.x : this.rim.x;
    const tz = near ? this.opp.z : this.rim.z;
    if (Y.swap) {
      Y.swap.t += dt;
      if (Y.swap.t >= Y.swap.T) Y.swap = null;
      return;
    }
    if (this.clock < (Y.swapCd || 0)) return;
    const side = this.threatSide(px, pz, p.heading, tx, tz);
    if (Math.abs(side) > 0.6 && Math.sign(side) === Y.hand) {
      Y.swap = this.switchHands(Y.hand, px, pz, p.heading, tx, tz);
      Y.hand = -Y.hand;
      Y.swapCd = this.clock + 0.9;
    }
  }

  // (the trouble still out in front: he turned toward it, so round the back; behind him: he
  // turned away, so a crossover in front or between the legs is safe)
  switchHands(hand, x, z, h, tx, tz) {
    const ahead = (tx - x) * Math.sin(h) + (tz - z) * Math.cos(h) > 0;
    const kind = ahead ? 'behind' : Math.random() < 0.5 ? 'front' : 'legs';
    return { from: hand, to: -hand, t: 0, T: kind === 'behind' ? 0.32 : kind === 'legs' ? 0.3 : 0.25, kind };
  }

  protectHim(p, dt) {
    const hp = p.hp;
    hp.hand = hp.hand || 1;
    const [px, pz] = this.game.player.pos();
    const near = dist(px, pz, p.x, p.z) < 4.5;
    const tx = near ? px : this.rim.x;
    const tz = near ? pz : this.rim.z;
    if (hp.swap) {
      hp.swap.t += dt;
      if (hp.swap.t >= hp.swap.T) hp.swap = null;
      return;
    }
    if (this.clock < (hp.swapCd || 0)) return;
    const side = this.threatSide(p.x, p.z, p.heading, tx, tz);
    if (Math.abs(side) > 0.6 && Math.sign(side) === hp.hand) {
      hp.swap = this.switchHands(hp.hand, p.x, p.z, p.heading, tx, tz);
      hp.hand = -hp.hand;
      hp.swapCd = this.clock + 0.9;
    }
  }

  // Which side of a player (facing h) a point is on: +1 his right .. -1 his left.
  threatSide(x, z, h, tx, tz) {
    const vx = tx - x;
    const vz = tz - z;
    const L = Math.hypot(vx, vz) || 1;
    return (vx * -Math.cos(h) + vz * Math.sin(h)) / L;
  }

  pumpFake() {
    const game = this.game;
    const hp = this.opp.hp;
    this.shot = null;
    this.you.jumpT = 0;
    hp.closeT = 0;
    const [px, pz] = game.player.pos();
    if (dist(px, pz, this.opp.x, this.opp.z) < 2.6 && hp.fallT <= 0 && hp.beatT <= 0 && Math.random() < 0.6 - (this.r - 60) / 100) {
      hp.jumpT = 0.7;
      hp.beatT = 0.85;
      game.hud.toast(`${this.opp.ballName} bit on the pump fake`, '#7ee081');
    }
  }

  // The green window right now (it shrinks when he's on you, on the run, from deep, tired).
  windowNow() {
    const s = this.shot;
    const game = this.game;
    const [px, pz] = game.player.pos();
    const opp = this.opp;
    const hp = opp.hp;
    let lv = this.openness(px, pz, opp.x, opp.z, hp.beatT > 0.2 || hp.fallT > 0, (hp.jumpT || 0) > 0 || hp.handsUp);
    if (s.fade) lv = Math.max(0, lv - 1); // (fading away from his hand)
    let w = s.W * OPEN_WINDOW[lv];
    if (s.fade) w *= 0.9; // (harder going backward)
    if (s.type === 'jumper' && s.sprint) w *= 0.6;
    else if (s.type === 'jumper' && s.onRun) w *= 0.85;
    if (s.stepback) w *= 0.9;
    if (s.pivot) w *= 0.85; // (a turnaround's harder)
    if (this.you.st < 0.4) w *= 0.75;
    if (this.t33) w *= this.pressure33(); // (33: the bigger the pot, the tighter)
    if (game.input.touchMode) w *= 1.4;
    if (this.onFire('you')) w *= 1.2; // (on fire: 20% bigger)
    return { w, lv };
  }

  resolveYou(e) {
    const game = this.game;
    const s = this.shot;
    const opp = this.opp;
    const hp = opp.hp;
    const [px, pz] = game.player.pos();
    const { w, lv } = this.windowNow();
    this.shot = null;
    // His chase-down: trailing you on a layup or a dunk and up in time, he pins it on the glass.
    if ((s.type === 'layup' || s.type === 'dunk') && (hp.jumpT || 0) > 0 && hp.chase && dist(px, pz, opp.x, opp.z) < 2.6) {
      hp.chase = false;
      if (Math.random() < (s.type === 'dunk' ? 0.25 : 0.4) * (this.r / 75)) {
        if (this.you.dunk) this.you.dunk.hangs = false;
        game.shakeCamera?.(0.05, 0.25);
        return this.swatted(px, pz, `Chased down by ${opp.ballName}! Pinned on the glass`, 'you', opp.x, opp.z, true);
      }
    }
    let make;
    let grade = '';
    let green = false;
    if (s.type === 'dunk') {
      // At the rim: a contact dunk if he's there.
      const contact = lv >= 3;
      if (contact && Math.random() < 0.15 * (this.r / 75)) return this.swatted(px, pz, `${opp.ballName} STUFFED the dunk!`, 'you', opp.x, opp.z);
      make = Math.random() < (contact ? 0.6 : s.oop ? 0.88 : 0.95);
      const name = { two: 'Two-hand slam!', one: 'One-hand jam!', windmill: 'WINDMILL!', tomahawk: 'Tomahawk!' }[this.you.dunk?.style] || 'Slam!';
      grade = make ? (contact ? 'POSTERIZED HIM!' : s.oop ? `ALLEY-OOP! ${name}` : name) : 'Rimmed it out';
      game.shakeCamera?.(make ? 0.14 : 0.07, 0.4); // (the rim rattles)
      if (this.you.dunk) this.you.dunk.hangs = make; // (hang on the rim after a make)
    } else {
      const m = Math.abs(e) - w / 2;
      const fire = this.onFire('you');
      green = m <= 0 && (s.d0 <= 14 || fire || Math.random() < 0.5); // (from way out even a perfect one can miss, unless you're on fire)
      const when = e < 0 ? 'Early' : 'Late';
      grade = green ? 'EXCELLENT' : m < 0.06 ? `Slightly ${when}` : m < 0.16 ? when : `Very ${when}`;
      const tm = green ? 1 : m < 0.06 ? 0.7 : m < 0.16 ? 0.4 : 0.12;
      // His contest: a block on a heavy contest.
      const blockP = { jumper: 0.1, layup: 0.2, floater: 0.12 }[s.type] * (this.r / 75) * (s.euro ? 0.5 : 1);
      if (lv >= 2 && (hp.jumpT || 0) > 0 && Math.random() < blockP) return this.swatted(px, pz, `Blocked by ${opp.ballName}`, 'you', opp.x, opp.z);
      const base = s.type === 'layup' ? 0.82 : s.type === 'floater' ? 0.55 : this.base(fire ? Math.min(s.d0, FIRE_RANGE) : s.d0);
      make = green || Math.random() < base * tm * OPEN_MAKE[lv] * (0.7 + 0.3 * this.you.st);
    }
    // A foul on the shot: and-one if it goes, your ball again if not.
    this.foulOnShot = lv >= 3 && Math.random() < 0.08;
    if (s.type === 'dunk') game.hud.toast(this.solo ? grade : `${grade} · ${OPEN[lv]}`, make ? '#7ee081' : '#ff8080');
    else {
      // (the timing: a badge under your energy bar, not a message in the middle of the screen)
      const m = Math.abs(e) - w / 2;
      const when = e < 0 ? 'EARLY' : 'LATE';
      const sub = green ? 'PERFECT RELEASE' : this.solo ? `${Math.max(1, Math.round(m * 1000))} MS ${when}` : OPEN[lv].toUpperCase();
      this.badge(green ? 'ex' : m < 0.06 ? 'slight' : 'off', grade.toUpperCase(), sub, e < 0 ? 'early' : 'late');
    }
    if (s.type === 'dunk') {
      this.g.ball.y = Math.max(this.g.ball.y, this.rim.y + 0.15); // (from your hands, through the rim)
      this.launch(make, 'you', s.pts, 0.14);
    } else {
      this.launch(make, 'you', s.pts, 0, s.type);
      // Back down from wherever you let it go.
      const h = this.shotHeight(s);
      this.you.follow = { t: 0, kind: s.type, hand: s.hand ?? 1 };
      this.you.fall = { h0: h, t: 0, T: Math.max(0.12, Math.sqrt((2 * h) / 9.8)), fade: s.fade ? Math.min(1, Math.max(0, s.t - s.turnT - 0.03) / 0.6) : null };
    }
  }

  // A block: the ball knocked out of the shooter's hands, away from the blocker's hand (from
  // bx, bz). A chase-down pins it on the glass and it drops off the board.
  swatted(x, z, text, shooter, bx = null, bz = null, pinned = false) {
    const b = this.g.ball;
    this.shot = null;
    b.mode = 'loose';
    b.holder = null;
    if (pinned) {
      const rim = this.rim;
      b.x = rim.x - rim.dx * 0.3 + rand(-0.3, 0.3) * rim.dz;
      b.z = rim.z - rim.dz * 0.3 - rand(-0.3, 0.3) * rim.dx;
      b.y = rim.y + 0.45;
      b.vx = rim.dx * rand(1.2, 2.2);
      b.vz = rim.dz * rand(1.2, 2.2);
      b.vy = -0.5;
    } else {
      b.y = Math.max(b.y, 2);
      const fx = bx ?? x;
      const fz = bz ?? z;
      const l = dist(b.x, b.z, fx, fz) || 1;
      const v = rand(4, 6.5);
      b.vx = ((b.x - fx) / l) * v + rand(-1, 1);
      b.vz = ((b.z - fz) / l) * v + rand(-1, 1);
      b.vy = rand(1.5, 3);
    }
    if (shooter === 'you') this.you.noGrabT = 0.4;
    else this.opp.hp.noGrabT = 0.4;
    markSwat(shooter === 'you' ? this.opp.char : this.game.player.char, this.game.time); // (the blocker's hand slaps it)
    this.has = null;
    this.lastShooter = shooter; // (whoever gets it back: the other one's a defensive board)
    this.heatResult(shooter, false); // (blocked: the streak's over)
    this.touch = shooter === 'you' ? 'opp' : 'you'; // (off the blocker's hand)
    this.game.hud.toast(text, shooter === 'you' ? '#ff8080' : '#7ee081');
  }

  // A steal: poked out of the ballhandler's hands (who: 'you' or 'opp'), loose on the floor,
  // mostly toward the side the hand came from. Whoever gets to it first has it; the one who
  // lost it can't grab it straight back.
  knockLoose(who, fx, fz, text) {
    const b = this.g.ball;
    const [vx0, vz0] = who === 'you' ? this.game.player.pos() : [this.opp.x, this.opp.z];
    let ux = fx - vx0;
    let uz = fz - vz0;
    const l = Math.hypot(ux, uz) || 1;
    const a = Math.atan2(ux / l, uz / l) + rand(-1.1, 1.1);
    const v = rand(1.6, 3);
    this.shot = null;
    b.mode = 'loose';
    b.holder = null;
    b.y = Math.max(b.y, 0.5);
    b.vx = Math.sin(a) * v;
    b.vz = Math.cos(a) * v;
    b.vy = rand(0.8, 1.6);
    this.has = null;
    this.lastShooter = who; // (if the other one comes up with it, he takes it back)
    this.touch = who === 'you' ? 'opp' : 'you'; // (off the hand that poked it)
    // The poke goes through it; he's stripped, looking round after it.
    const game = this.game;
    const victim = who === 'you' ? game.player : this.opp;
    const h = victim.heading;
    markStripped(victim.char, game.time, Math.sin(a) * -Math.cos(h) + Math.cos(a) * Math.sin(h) >= 0 ? 1 : -1);
    reachHit(who === 'you' ? this.opp.char : game.player.char);
    if (who === 'you') this.you.noGrabT = 0.45;
    else this.opp.hp.noGrabT = 0.45;
    this.game.hud.toast(text, who === 'you' ? '#ff8080' : '#7ee081');
  }

  // The ball goes up from whoever's shooting.
  launch(make, by, pts, T, type = null) {
    const b = this.g.ball;
    const rim = this.rim;
    const shooter = by === 'you' ? this.game.player.pos() : [this.opp.x, this.opp.z];
    const h = by === 'you' ? this.game.player.heading : this.opp.heading;
    if (!T && !type) { // (a shot comes out of the shooter's hands, where it already is)
      b.x = shooter[0] + Math.sin(h) * 0.3;
      b.z = shooter[1] + Math.cos(h) * 0.3;
      b.y = 2.4;
    }
    const miss = make ? 0 : rand(0.22, 0.4);
    const a = rand(0, Math.PI * 2);
    const d = dist(b.x, b.z, rim.x, rim.z);
    const to = [rim.x + Math.cos(a) * miss, rim.y + 0.08, rim.z + Math.sin(a) * miss * 0.6];
    // A layup off the glass unless you're coming straight down the middle at it (within ~20°
    // of straight on): up to the square on the shooter's side, then down into (or off) the rim.
    const ox = shooter[0] - rim.x;
    const oz = shooter[1] - rim.z;
    const ol = Math.hypot(ox, oz) || 1;
    if (type === 'layup' && !T && (ox * rim.dx + oz * rim.dz) / ol < 0.94) {
      const lat = Math.sign(ox * -rim.dz + oz * rim.dx) || 1; // (which side of the rim you're on)
      const gx = rim.x - rim.dx * 0.3 - rim.dz * lat * 0.22;
      const gz = rim.z - rim.dz * 0.3 + rim.dx * lat * 0.22;
      this.H.launch(b, gx, rim.y + 0.42, gz, 0.32 + d * 0.04);
      b.kind = 'bank';
      b.bankTo = to;
    } else {
      this.H.launch(b, to[0], to[1], to[2], T || 0.75 + d * 0.06);
      b.kind = 'shot';
    }
    b.make = make;
    if (by === 'you' && !this.solo && !this.t33) this.opp.hp.boxWant = Math.random() < 0.35 + this.r / 250; // (will he box you out?)
    this.flight = { by, pts, counts: this.cleared, foul: this.foulOnShot, type: type || (T ? 'dunk' : null) };
    this.foulOnShot = false;
    this.has = null;
    if (this.t3) this.t3.release(b, make); // (the contest: it flies on its own; on to the next ball)
  }

  // ---- Your defense ----
  trySteal(d) {
    const game = this.game;
    const Y = this.you;
    const opp = this.opp;
    const hp = opp.hp;
    const b = this.g.ball;
    const [px, pz] = game.player.pos();
    Y.stealT = 0.7;
    Y.armsT = 0.35;
    markReach(game.player.char, game.time, this.sideOfBall(px, pz, game.player.heading), false, !!Y.intense); // (a poke from the stance holding L2, a lunge without)
    const again = this.clock - Y.lastSteal < 1.2;
    Y.lastSteal = this.clock;
    const dB = dist(px, pz, b.x, b.z);
    if (d > 1.6 || dB > 1.7) return;
    // From behind or reaching twice: a foul. Into a move: the best chance.
    const behind = ((px - opp.x) * Math.sin(opp.heading) + (pz - opp.z) * Math.cos(opp.heading)) < -0.3;
    const foulP = 0.1 + (again ? 0.2 : 0) + (behind ? 0.15 : 0);
    if (Math.random() < foulP) {
      this.foulBeat('you', 'opp', `Reach-in foul. ${opp.ballName}'s ball, check it up`);
      return;
    }
    const p = (0.08 + (hp.state === 'move' ? 0.25 : 0) + (dB < 1 ? 0.06 : 0)) * (1.3 - this.r / 100);
    if (Math.random() < p) {
      Y.armsT = 0.35;
      this.knockLoose('opp', px, pz, 'Poked it loose!');
      return;
    }
    Y.beatT = Math.max(Y.beatT, 0.35); // (gambled and missed: off balance)
    reachWhiff(game.player.char);
  }

  tryBlock(d) {
    const game = this.game;
    const opp = this.opp;
    const hp = opp.hp;
    const [px, pz] = game.player.pos();
    const front = ((px - opp.x) * (this.rim.x - opp.x) + (pz - opp.z) * (this.rim.z - opp.z)) > 0;
    // A chase-down: trailing him on a layup or a dunk, running, you get up from behind and pin it
    // on the glass (a longer reach, and clean more often than a block from behind).
    const chase = (hp.shot === 'layup' || hp.shot === 'dunk') && game.player.speed > 3.2 && this.trailing(px, pz, opp.x, opp.z);
    if (d > (chase ? 2.6 : 1.8)) return;
    const timing = Math.abs(hp.t - hp.rel) < (chase ? 0.25 : 0.2) ? 1 : 0.5;
    const base = { jumper: 0.35, layup: 0.45, floater: 0.4, dunk: 0.2 }[hp.shot] || 0.3;
    if (chase) {
      if (Math.random() < 0.06) {
        hp.fouled = true;
        game.hud.toast('Foul on the shot', '#ff8080');
        return;
      }
      if (hp.t <= hp.rel + 0.05 && Math.random() < (hp.shot === 'dunk' ? 0.35 : 0.55) * timing) {
        hp.state = 'read';
        hp.t = 0;
        hp.jump = 0;
        this.swatted(opp.x, opp.z, 'CHASE-DOWN BLOCK! Pinned on the glass', 'opp', px, pz, true);
        for (const q of this.g.players) if (q.hp.role === 'watch') q.hp.cheerT = 1.4;
        game.shakeCamera?.(0.05, 0.25);
      }
      return;
    }
    if (Math.random() < 0.08 + (front ? 0 : 0.25)) {
      hp.fouled = true; // (and-one if it goes in, his ball again if not)
      game.hud.toast('Foul on the shot', '#ff8080');
      return;
    }
    if (hp.t <= hp.rel && Math.random() < base * timing * (front ? 1 : 0.6)) {
      hp.state = 'read';
      hp.t = 0;
      this.swatted(opp.x, opp.z, 'Get that outta here! BLOCKED', 'opp', px, pz);
      for (const q of this.g.players) if (q.hp.role === 'watch') q.hp.cheerT = 1;
    }
  }

  // ---- The match, every frame (hoops.js hands the group over) ----
  step(dt) {
    const game = this.game;
    // Once a frame: shooting around, main.js steps this; in 33 and the contest, the court's group
    // does too (hoops.js: g.match). Twice ran everything (clocks, flights) at double speed.
    if (this.stepAt === game.time) return;
    this.stepAt = game.time;
    const b = this.g.ball;
    const H = this.H;
    const opp = this.opp;
    const hp = opp.hp;
    const [px, pz] = game.player.pos();
    if (opp.removed || opp.state !== 'play') return this.end('off');
    const P = H.site.pad;
    const off = px < P.x0 - 1 || px > P.x1 + 1 || pz < P.z0 - 1 || pz > P.z1 + 1;
    this.outT = off ? this.outT + dt : 0;
    if (this.outT > 2.5 || game.player.vehicle || game.stars > 0 || game.wastedT > 0 || game.bustedT > 0) return this.end(this.solo && !this.t33 ? 'done' : 'forfeit');
    if (this.t3) {
      this.t3.step(dt);
      if (!this.active) return;
    }
    // A reach-in foul's whistle: everything holds a beat, then the check-up.
    if (this.foul) {
      this.foul.t += dt;
      if (this.foul.t >= this.foul.T) {
        const f = this.foul;
        this.foul = null;
        this.checkup(f.off, f.why);
      }
      this.carry(dt);
      b.mesh.position.set(b.x, b.y, b.z);
      return;
    }
    if (this.t33) {
      this.cleared = true;
      this.step33(dt);
    } else if (this.solo) {
      this.cleared = true;
      this.npcBall(dt);
      this.soloCourt(dt, px, pz);
    }
    if (this.reset && !this.solo && !this.t33) {
      this.resetStep(dt);
      return;
    }
    // Checking it up: the defender holds it a moment and checks it back; he checks it to you.
    const C = this.check;
    if (C) {
      C.t += dt;
      if (C.stage === 'defHolds' && C.t > 0.5) {
        C.stage = 'back';
        this.checkPass('you');
      } else if (C.stage === 'wait' && C.t > 0.8) {
        C.stage = 'toYou';
        this.checkPass('you');
      }
    }
    for (const k of ['beatT', 'fallT', 'lagT', 'jumpT', 'closeT', 'stealT', 'noGrabT']) hp[k] = Math.max(0, (hp[k] || 0) - dt);
    this.you.noGrabT = Math.max(0, (this.you.noGrabT || 0) - dt);
    // His energy.
    if (hp.state === 'drive' || hp.state === 'move' || (this.has !== 'opp' && opp.speed > 3.5)) hp.st = Math.max(0, hp.st - dt * 0.07);
    else hp.st = Math.min(1, hp.st + dt * 0.06);
    // The ball.
    // Coming down off the glass: go up and get it.
    // An alley-oop up: the leap, the catch, somebody going up to break it up.
    this.oopStep(dt, this.oopHits?.shoot, this.oopHits?.block);
    this.oopHits = null;
    if (!this.active) return;
    if (b.mode === 'flight') {
      // (a pass goes to his hands, wherever he's moved to)
      if (b.kind === 'pass' && b.to && !b.to.removed) {
        b.p1[0] = b.to.x;
        b.p1[2] = b.to.z;
      }
      steerPass(b); // (into the catcher's hands as they come up for it)
      b.t += dt;
      const k = Math.min(1, b.t / b.T);
      b.x = b.p0[0] + (b.p1[0] - b.p0[0]) * k;
      b.z = b.p0[2] + (b.p1[2] - b.p0[2]) * k;
      const t = Math.min(b.t, b.T);
      b.y = b.p0[1] + b.vy0 * t - 0.5 * G * t * t + (b.yAdj || 0) * k;
      if (b.t >= b.T) {
        if (b.kind === 'check') this.checkArrive();
        else if (b.kind === 'pass') this.passArrive();
        else if (b.kind === 'back') this.backArrive();
        else if (b.kind === 'oop') this.oopBounce();
        else if (b.kind === 'bank') {
          // (off the glass, down into the rim)
          this.H.launch(b, b.bankTo[0], b.bankTo[1], b.bankTo[2], 0.2);
          b.kind = 'shot';
        }
        else if (b.kind === 'oop2') {
          const O = this.oop;
          if (O && O.by === 'opp' && hp.oopLeap) this.catchHim();
          else if (O && O.by === 'you' && O.leap) {
            // (in your hands at the top while you go to throw it down)
            b.mode = 'held';
            b.holder = 'you';
          } else {
            b.mode = 'loose';
            b.vx = rand(-0.5, 0.5);
            b.vz = rand(-0.5, 0.5);
            b.vy = -1;
            if (O && O.by === 'you') game.hud.toast("Didn't get there in time: run at it and go up within a couple of meters", '#ff8080');
            this.oop = null;
          }
        }
        else this.landed();
      }
      if (!this.active) return; // (that was the game-winner: the scoreboard's gone)
    } else if (b.mode === 'loose') {
      H.roll(b, dt);
      if (this.t33) {
        // (33: your rebound's yours to go and get: step33 hands it to you)
      } else if (!this.dead && this.isOut(b)) {
        // Out of bounds: dead, and it's the other one's ball off whoever touched it last (a
        // block off the shooter's hands: the shooter keeps it).
        const last = this.touch || this.lastShooter || 'opp';
        const who = last === 'you' ? 'opp' : 'you';
        this.dead = { who, t: 0.9 };
        this.has = null;
        this.game.hud.toast(`Out of bounds. ${who === 'you' ? 'Your' : `${opp.ballName}'s`} ball`, '#9fc3ff');
      } else if (this.dead) {
        this.dead.t -= dt;
        if (this.dead.t <= 0) {
          const who = this.dead.who;
          this.dead = null;
          this.startReset(who);
        }
      } else {
        // Rebounds: you reach further jumping for it (△), he's slower boxed out.
        const Y = this.you;
        const yourReach = Y.boxed ? 0.5 : Y.jumpT > 0 ? 1.4 : 0.95; // (boxed out by him: the same as him by you)
        const yourTop = Y.jumpT > 0 ? 2.8 : 1.5;
        const hisReach = hp.boxed ? 0.45 : (hp.jumpT || 0) > 0 ? 1.35 : 0.95;
        // (a loose ball: kept by the one who had it, play on; taken by the other, a turnover,
        // and the play resets with his ball)
        if (Y.fallT <= 0 && !(Y.noGrabT > 0) && dist(px, pz, b.x, b.z) < yourReach && b.y < yourTop) {
          const turnover = this.lastHas === 'opp';
          this.give('you');
          if (turnover) {
            this.gainDefense(0.6);
            this.game.hud.toast('Turnover! Your ball', '#7ee081');
            this.startReset('you');
          }
        } else if (hp.fallT <= 0 && !(hp.noGrabT > 0) && dist(opp.x, opp.z, b.x, b.z) < hisReach && b.y < 1.6) {
          const turnover = this.lastHas === 'you';
          this.give('opp');
          if (turnover) {
            this.game.hud.toast(`Turnover. ${opp.ballName}'s ball`, '#ff8080');
            this.startReset('opp');
          }
        }
      }
    }
    // His hands up: you going up for a shot with him in your face (the same as your hands up).
    hp.handsUp = !!this.shot && this.shot.type !== 'dunk' && hp.fallT <= 0 && !(hp.jumpT > 0) && dist(px, pz, opp.x, opp.z) < 2.0;
    // Nobody walks through anybody: the two of you are pushed apart.
    if (!this.check) {
      const dx = opp.x - px;
      const dz = opp.z - pz;
      const d = Math.hypot(dx, dz);
      const MIN = 0.62;
      if (d < MIN && d > 1e-4) {
        const push = (MIN - d) / 2;
        const p = game.player;
        if (!this.you.dunk) {
          p.x -= (dx / d) * push;
          p.z -= (dz / d) * push;
        }
        opp.x += (dx / d) * push * (this.you.dunk ? 2 : 1);
        opp.z += (dz / d) * push * (this.you.dunk ? 2 : 1);
      }
    }
    // His box-out on you: a shot of yours up (or the ball loose), him between you and the rim.
    {
      const Y = this.you;
      const dRimYou = dist(px, pz, this.rim.x, this.rim.z);
      const dRimHim = dist(opp.x, opp.z, this.rim.x, this.rim.z);
      Y.boxed = !this.solo && !this.t33 && !!hp.boxWant && b.mode !== 'held' && !this.dead && !this.check && hp.fallT <= 0 && !hp.boxed
        && dist(px, pz, opp.x, opp.z) < 1.7 && dRimHim < dRimYou;
      if (b.mode === 'held') hp.boxWant = false;
    }
    // Taking it back past the arc.
    const holder = this.has === 'you' ? [px, pz] : this.has === 'opp' ? [opp.x, opp.z] : null;
    if (holder && !this.cleared && dist(holder[0], holder[1], this.rim.x, this.rim.z) > ARC + 0.3) this.cleared = true;
    // His reach-ins on you.
    if (this.has === 'you' && b.mode === 'held' && !this.shot && hp.fallT <= 0 && hp.beatT <= 0) {
      hp.stealT2 = (hp.stealT2 ?? rand(2, 4)) - dt;
      if (hp.stealT2 <= 0 && dist(px, pz, opp.x, opp.z) < 1.25) {
        hp.stealT2 = rand(2.2, 4.5);
        hp.armsT = 0.35;
        markReach(opp.char, game.time, this.sideOfBall(opp.x, opp.z, opp.heading), false, true); // (he's always in his stance guarding you)
        const exposed = this.you.move && MOVES[this.you.move.kind].risk ? 0.15 : 0;
        const r = Math.random();
        if (r < 0.12) return this.foulBeat('opp', 'you', `Reach-in on ${opp.ballName}. Check it up`);
        else if (r < 0.12 + (0.06 + exposed) * (this.r / 75)) {
          this.knockLoose('you', opp.x, opp.z, `${opp.ballName} poked it away!`);
        }
      }
    }
    this.carry(dt);
    this.heatFx(dt);
    b.mesh.position.set(b.x, b.y, b.z);
    if (b.mode === 'flight') b.mesh.rotation.x += dt * 9; // (backspin in the air)
    else if (b.mode === 'loose') {
      // Rolling: turns with how fast it's going along the ground, and stops when it stops.
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0.05) {
        _axis.set(b.vz / sp, 0, -b.vx / sp);
        b.mesh.rotateOnWorldAxis(_axis, (sp / 0.12) * dt);
      }
    }
    this.hud();
  }

  // A shooter's ball: between his hands (one = 0) or on the shooting hand (1), from how his arms
  // are posed (as drawn last frame).
  shotBall(b, c, hand, one) {
    c.group.updateMatrixWorld(true);
    const h = c.group.rotation.y;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    // (on the shooting hand: sat on the palm, just above the wrist)
    const a = (hand >= 0 ? c.wristR : c.wristL).getWorldPosition(_v1);
    a.y += 0.17;
    a.x += fx * 0.05;
    a.z += fz * 0.05;
    if (one < 1) {
      // (between both hands, just in front of them)
      const l = c.wristL.localToWorld(_v2.set(0, -0.06, 0));
      const r = c.wristR.localToWorld(_v3.set(0, -0.06, 0));
      _v2.add(r).multiplyScalar(0.5);
      _v2.x += fx * 0.1;
      _v2.z += fz * 0.1;
      a.lerp(_v2, 1 - one);
    }
    b.x = a.x;
    b.y = a.y;
    b.z = a.z;
  }

  // The ball in somebody's hands.
  carry(dt) {
    const game = this.game;
    const b = this.g.ball;
    if (b.mode !== 'held') return;
    if (this.has === 'npc') {
      const q = b.holder;
      b.x = q.x + Math.sin(q.heading) * 0.35;
      b.z = q.z + Math.cos(q.heading) * 0.35;
      b.y = 1.2;
      return;
    }
    if (this.has === 'check') {
      // (held in both hands at the chest, face to face)
      const h = b.holder === 'you' ? this.game.player : this.opp;
      handsAt(h.char, _v1);
      b.x = _v1.x;
      b.y = _v1.y;
      b.z = _v1.z;
      return;
    }
    if (this.has === 'you') {
      const p = game.player;
      const [px, pz] = p.pos();
      const fx = Math.sin(p.heading);
      const fz = Math.cos(p.heading);
      const Y = this.you;
      this.dribble = (this.dribble || 0) + dt * (this.t33 ? DRIBBLE33 : Y.sizeUp ? 12 : 9); // (33: a slow, easy bounce)
      if (Y.dunk) {
        // (in the hands going up: where the dunk's arms have it)
        dunkBall(b, game.player.char, Y.dunkTwo ?? true, Y.dunk.hand ?? 1, _v1, _v2);
        return;
      }
      if (catching(game.player.char, game.time) || (this.t3 && !this.shot)) {
        handsAt(game.player.char, _v1); // (pulling a catch in, or off the rack in the contest: it's in both hands)
        b.x = _v1.x;
        b.y = _v1.y;
        b.z = _v1.z;
        return;
      }
      if (scooping(game.player.char, game.time) || grabbing(game.player.char, game.time)) {
        this.shotBall(b, game.player.char, 1, 0); // (scooped up: in both hands)
        return;
      }
      if (this.shot) {
        // (in the hands: both at the chest, then up on the shooting hand)
        this.shotBall(b, game.player.char, this.shot.hand ?? 1, this.shot.one || 0);
      } else {
        // (the hand it's in: a crossover takes it across in front)
        let side = Y.hand;
        let fwd = 0.4;
        let y = 0.18 + Math.abs(Math.sin(this.dribble)) * (Y.sizeUp ? 0.55 : 0.8);
        // (changing hands: in front, between the legs or behind the back)
        let path = null;
        if (Y.swap) path = [Y.swap.kind, Y.swap.from, Y.swap.to, Math.min(1, Y.swap.t / Y.swap.T)];
        else if (Y.move && Y.move.from !== Y.move.to) path = [HANDOFF[Y.move.kind] || 'front', Y.move.from, Y.move.to, Math.min(1, Y.move.t / (Y.move.T * 0.85))];
        this.legsK = this.behindK = 0;
        const key = Y.swap || Y.move;
        if (path && this.hoKey !== key) {
          this.hoKey = key; // (a new switch: from the height the ball's at now)
          this.hoY0 = b.y;
          this.hoDone = false;
        }
        if (path && path[3] >= 1) {
          // (it's in the new hand: back to the dribble from there)
          if (!this.hoDone) {
            this.hoDone = true;
            this.dribble = dribbleFrom(this.dribble, path[0] === 'spin' ? 0.78 : HO_TOP, Y.sizeUp ? 0.55 : 0.8);
            y = 0.18 + Math.abs(Math.sin(this.dribble)) * (Y.sizeUp ? 0.55 : 0.8);
          }
          side = path[2];
          path = null;
        } else if (!path && this.hoKey && !this.hoDone) {
          // (the move's over a touch before the ball got there: pick the dribble up from here)
          this.hoDone = true;
          this.dribble = dribbleFrom(this.dribble, b.y, Y.sizeUp ? 0.55 : 0.8);
          y = 0.18 + Math.abs(Math.sin(this.dribble)) * (Y.sizeUp ? 0.55 : 0.8);
        }
        if (path) {
          [side, fwd, y] = handoff(...path, this.hoY0);
          const m = Math.sin(Math.PI * path[3]);
          if (path[0] === 'legs') this.legsK = m;
          if (path[0] === 'behind') this.behindK = m;
        }
        this.ballSide = side;
        // (your right: (-fz, fx))
        b.x = px + fx * fwd - fz * 0.32 * side;
        b.z = pz + fz * fwd + fx * 0.32 * side;
        b.y = y;
      }
    } else if (this.has === 'opp') {
      const opp = this.opp;
      const hp = opp.hp;
      const fx = Math.sin(opp.heading);
      const fz = Math.cos(opp.heading);
      if (catching(opp.char, game.time)) {
        handsAt(opp.char, _v1);
        b.x = _v1.x;
        b.y = _v1.y;
        b.z = _v1.z;
      } else if (scooping(opp.char, game.time) || grabbing(opp.char, game.time)) this.shotBall(b, opp.char, 1, 0); // (scooped up: in both hands)
      else if (hp.state === 'shoot' && hp.appr && hp.t < hp.appr.T) {
        b.x = opp.x + fx * 0.32;
        b.z = opp.z + fz * 0.32;
        b.y = 1.2; // (gathered: at the chest)
      } else if (hp.state === 'shoot' && hp.shot !== 'dunk') {
        this.shotBall(b, opp.char, hp.sHand ?? 1, hp.one || 0); // (in his hands, the same as yours)
      } else if (hp.state === 'shoot' && hp.shot === 'dunk' && !(hp.appr && hp.t < hp.appr.T)) {
        dunkBall(b, opp.char, hp.dunkTwo ?? true, hp.sHand ?? 1, _v1, _v2); // (in his hands, the same as yours)
      } else if (hp.state === 'shoot') {
        const a0 = hp.appr ? hp.appr.T : 0;
        const up = Math.min(1, (hp.t - a0) / Math.max(0.1, hp.rel - a0));
        b.x = opp.x + fx * 0.3;
        b.z = opp.z + fz * 0.3;
        b.y = hp.shot === 'dunk' ? 1.7 + up * 1.4 + (hp.jump || 0) : 1.2 + up + (hp.jump || 0);
      } else {
        hp.dribble = (hp.dribble || 0) + dt * 9;
        hp.hand = hp.hand || 1;
        let side = hp.hand;
        let fwd = 0.4;
        let y = 0.18 + Math.abs(Math.sin(hp.dribble)) * 0.8;
        let path = null;
        if (hp.swap) path = [hp.swap.kind, hp.swap.from, hp.swap.to, Math.min(1, hp.swap.t / hp.swap.T)];
        else if (hp.state === 'move' && hp.mv && hp.mv.from !== hp.mv.to) path = [HANDOFF[hp.mv.kind] || 'front', hp.mv.from, hp.mv.to, Math.min(1, hp.t / (hp.mv.T * 0.85))];
        hp.legsK = hp.behindK = 0;
        const key = hp.swap || (hp.state === 'move' ? hp.mv : null);
        if (path && hp.hoKey !== key) {
          hp.hoKey = key; // (a new switch: from the height the ball's at now)
          hp.hoY0 = b.y;
          hp.hoDone = false;
        }
        if (path && path[3] >= 1) {
          if (!hp.hoDone) {
            hp.hoDone = true;
            hp.dribble = dribbleFrom(hp.dribble, path[0] === 'spin' ? 0.78 : HO_TOP, 0.8);
            y = 0.18 + Math.abs(Math.sin(hp.dribble)) * 0.8;
          }
          side = path[2];
          path = null;
        } else if (!path && hp.hoKey && !hp.hoDone) {
          hp.hoDone = true;
          hp.dribble = dribbleFrom(hp.dribble, b.y, 0.8);
          y = 0.18 + Math.abs(Math.sin(hp.dribble)) * 0.8;
        }
        if (path) {
          [side, fwd, y] = handoff(...path, hp.hoY0);
          const m = Math.sin(Math.PI * path[3]);
          if (path[0] === 'legs') hp.legsK = m;
          if (path[0] === 'behind') hp.behindK = m;
        }
        hp.ballSide = side;
        b.x = opp.x + fx * fwd - fz * 0.3 * side;
        b.z = opp.z + fz * fwd + fx * 0.3 * side;
        b.y = y;
      }
    }
  }

  hud() {
    const game = this.game;
    if (!this.active) return;
    document.body.classList.add('hooping'); // (the turf war line moves out of the way: style.css)
    this.tiredFx(this.t33 ? 1 : this.you.st);
    // (no minimap in a one-on-one or 33: just the game)
    const mm = document.getElementById('minimap');
    if (mm) mm.style.visibility = !this.solo || this.t33 || this.t3 ? 'hidden' : '';
    const K = this.keys();
    let meter = null;
    const O = this.oop;
    if (O && O.by === 'you' && O.leap) {
      // (the oop: the top of the leap is the catch)
      const t0 = O.leap.t0;
      const span = O.tCatch - t0 + O.leap.w / 2 + 0.12;
      meter = { v: (this.clock - t0) / span, lo: (O.tCatch - t0 - O.leap.w / 2) / span, hi: (O.tCatch - t0 + O.leap.w / 2) / span };
    } else if (this.shot && this.shot.type !== 'dunk') {
      const s = this.shot;
      const { w } = this.windowNow();
      const span = s.T + LATE;
      meter = { v: s.t / span, lo: (s.T - w / 2) / span, hi: (s.T + w / 2) / span };
    }
    let hint = '';
    const C = this.check;
    const ck = game.input.touchMode ? 'SHOOT' : game.input.mode === 'pad' ? '✕' : 'E';
    if (this.t3) {
      const V = this.t3.view();
      this.scoreboard = this.scoreboard || new Scoreboard();
      this.scoreboard.showContest({ ...V, game: this.gameNo });
      const K3 = this.keys();
      hint = V.phase === 'count' ? 'Get ready...' : V.phase === 'move' || V.phase === 'settle' ? 'Next rack...' : V.phase === 'shoot' ? (this.shot ? 'Let go in the green' : `${K3.shoot}: shoot, let go in the green`) : 'Time!';
      game.hud.sport?.('3-POINT CONTEST', null, hint, null);
      this.floatHud(meter);
      return;
    }
    if (this.t33) {
      const T = this.t33;
      const up = T.players[T.turn];
      const board = `33 · POT ${T.pot} · ` + T.players.map((P) => `${P.name.toUpperCase()} ${P.out ? 'OUT' : P.score}`).join(' · ');
      const Y = T.players.find((P) => P.who === 'you');
      const ok = game.input.touchMode ? 'SHOOT' : game.input.mode === 'pad' ? '✕' : 'E';
      if (T.phase === 'pick') hint = T.onRing ? `${ok} to take this spot` : 'Pick your spot: step onto a ring on the arc (left corner shoots first)';
      else if (T.phase === 'claims') hint = 'They pick theirs...';
      else if (Y.st === 'chase' || Y.st === 'air') hint = 'Going after your rebound...';
      else if (Y.st === 'return') hint = 'Back to your spot...';
      else if (up?.who === 'you') hint = this.shot ? 'Let go in the green' : T.inAir || T.wait > 0 || !T.players.every((P) => P.out || P.st === 'ready') ? 'Waiting on everybody to get back...' : `Your shot · pot ${T.pot}${this.pressure33() < 0.9 ? ' (pressure: tighter window)' : ''}: ${K.shoot}, let go in the green${Y.shotClock > 4 ? ` · ${Math.ceil(6 - Y.shotClock)}` : ''}`;
      else hint = `${up?.name || ''} shooting · pot ${T.pot}`;
      game.hud.sport?.(board, null, hint, null);
      this.scoreboard = this.scoreboard || new Scoreboard();
      this.scoreboard.show33({
        game: this.gameNo, pot: T.pot, turn: T.phase === 'play' ? T.turn : -1,
        players: T.players.map((P) => ({ name: P.name, score: P.score, out: P.out, color: P.color, you: P.who === 'you' })),
      });
      this.floatHud(meter);
      return;
    }
    if (this.solo) {
      const S = this.stats;
      const pct = S.att ? ` (${Math.round((S.made / S.att) * 100)}%)` : '';
      const put = `${game.input.label('interact')} put it down`;
      const pk = game.input.touchMode ? 'PASS' : game.input.mode === 'pad' ? '✕' : 'Q';
      if (this.pass) hint = `Passing to ${this.pass.target ? 'him' : 'nobody'}: ${game.input.mode === 'pad' ? 'flick the right stick' : 'move the camera'} to pick, let go to pass`;
      else if (this.has === 'npc') hint = 'He\'s got it...';
      else if (this.fetch) hint = 'He\'s getting it for you';
      else if (O && O.by === 'you') hint = O.leap ? `${K.shoot} at the top to catch it` : `Run at it: you go up when you're in reach · ${K.shoot} at the top`;
      else if (this.g.ball.mode === 'loose' && dist(...game.player.pos(), this.g.ball.x, this.g.ball.z) > 7) hint = `Go get it, grab another ball, or ${pk} get somebody to fetch it · ${put}`;
      else hint = this.has === 'you' ? (this.shot ? 'Let go in the green' : `${K.shoot} shoot · ${pk} pass (hold to pick who) · ${K.d} hold: face up · ${K.block} off the glass · moves: ${K.moves} · ${put}`) : `Go get it · ${put}`;
      game.hud.sport?.(`SHOOTAROUND · ${S.made}/${S.att}${pct} · streak ${S.streak} (best ${S.best}) · handle ${Math.floor(this.handle)}`, null, hint, null);
      this.floatHud(meter);
      return;
    }
    if (this.reset) hint = this.reset.fetch === 'you' ? `Get the ball and check it up to him · ${ck} skip` : `${this.opp.ballName} is getting the ball · ${ck} skip`;
    else if (C) hint = 'Checking it up...';
    else if (this.you.fallT > 0) hint = 'Ankles broken...';
    else if (this.has === 'you' && !this.cleared) hint = 'Take it back past the arc';
    else if (this.has === 'you') hint = this.shot ? 'Let go in the green' : `${K.shoot} shoot (tap: pump fake) · ${K.sprint} sprint · ${K.d} hold: face up · ${K.block} off the glass · moves: ${K.moves}`;
    else if (this.has === 'opp') hint = `${K.d} hold: guard (stay in front) · ${K.steal} steal · ${K.block} block`;
    else if (O && O.by === 'you') hint = O.leap ? `${K.shoot} at the top to catch it` : `Run at it: you go up when you're in reach · ${K.shoot} at the top`;
    else if (O && O.by === 'opp') hint = `${K.block} near the ball to break it up`;
    else if (!this.dead) hint = `Rebound! ${K.block} jump · ${K.d} box out`;
    game.hud.sport?.(this.board(), null, hint, null);
    // (the scoreboard up top: who's got it, the score, flipping over when somebody scores)
    this.scoreboard = this.scoreboard || new Scoreboard();
    this.scoreboard.show({
      game: this.gameNo, place: this.H.site.name || 'The Court', opp: this.opp.ballName, you: this.score.you, them: this.score.opp,
      poss: C ? C.off : this.reset ? this.reset.off : this.has === 'you' || this.has === 'opp' ? this.has : null, to: this.to, bet: this.bet,
      heat: { you: this.heat?.you.st, opp: this.heat?.opp.st },
    });
    this.floatHud(meter);
  }

  // Running on empty (a one-on-one, shooting around): below ~45% energy the colors drain out
  // and a red vignette closes in, more the lower you get (a slow pulse when you're nearly gone).
  // st: your energy 0-1 (1 clears it).
  tiredFx(st) {
    const k = clamp((0.45 - st) / 0.45, 0, 1);
    const cv = this.game.renderer?.domElement;
    if (cv) cv.style.filter = k > 0.01 ? `saturate(${(1 - 0.8 * k).toFixed(3)})` : '';
    let el = document.getElementById('tired');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tired';
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;background:radial-gradient(ellipse at center, rgba(120,0,0,0) 42%, rgba(150,0,0,.55) 78%, rgba(110,0,0,.9) 100%);opacity:0;transition:opacity .25s';
      document.body.appendChild(el);
    }
    const pulse = k > 0.7 ? 0.85 + 0.15 * Math.sin(this.clock * 5) : 1;
    el.style.opacity = (k * pulse).toFixed(3);
  }

  // The shot meter beside you (upright) and your energy under your feet, wherever you are on
  // screen.
  floatHud(meter) {
    const game = this.game;
    // (a perfect or a slightly early / late release: the meter holds where you let go and
    // plays its little animation)
    const PF = this.relFx;
    if (PF && game.time - PF.t0 < PF.T) meter = PF.m;
    else if (meter) this.lastMeter = meter;
    const p = game.player;
    const [px, pz] = p.pos();
    const cam = game.camera;
    const v = (this._v ||= new THREE.Vector3());
    const W = innerWidth;
    const H = innerHeight;
    const lift = this.you.dunk ? this.dunkHeight() : this.shot && this.shot.type !== 'dunk' ? this.shotHeight(this.shot) : 0;
    // (beside him: half a meter to his screen-right, chest high)
    const rx = -Math.cos(game.camYaw);
    const rz = Math.sin(game.camYaw);
    v.set(px + rx * 0.55, 1.2 + lift, pz + rz * 0.55).project(cam);
    if (v.z > 1) return game.hud.sportFloat(null);
    const at = { mx: ((v.x + 1) / 2) * W, my: ((1 - v.y) / 2) * H };
    v.set(px, 0.02, pz).project(cam);
    at.ex = ((v.x + 1) / 2) * W;
    at.ey = Math.min(H - 14, ((1 - v.y) / 2) * H + 34); // (well below his feet, but on screen)
    at.my = Math.max(52, Math.min(H - 52, at.my)); // (the meter: all of it on screen)
    game.hud.sportFloat(at, meter, this.you.st);
    // The timing badge sits under the energy bar; the green pulse on the floor at your feet.
    const B = this.badgeEl;
    if (B) {
      const bw = B.offsetWidth;
      const bh = B.offsetHeight;
      if (game.input.touchMode) {
        // (a phone: to his left at chest height, across from the meter on his right, so the
        // bottom of the screen and your thumbs stay clear)
        const cx = at.ex - (at.mx - at.ex) - bw / 2 - 6;
        B.style.left = `${Math.max(bw / 2 + 6, Math.min(W - bw / 2 - 6, cx))}px`;
        B.style.top = `${Math.max(8, Math.min(H - bh - 8, at.my - bh / 2))}px`;
      } else {
        B.style.left = `${Math.max(bw / 2 + 6, Math.min(W - bw / 2 - 6, at.ex))}px`;
        const below = at.ey + 14;
        B.style.top = `${Math.max(8, below + bh <= H - 6 ? below : at.ey - bh - 6)}px`; // (under the energy bar, or just over it when there's no room: always on screen)
      }
    }
    const P = this.pulse;
    if (P && P.visible) {
      const k = Math.min(1, (game.time - P.userData.t0) / 0.55);
      P.position.set(px, 0.04, pz);
      P.scale.setScalar(1 + k * 2.4);
      P.material.opacity = 0.75 * (1 - k);
      if (k >= 1) P.visible = false;
    }
  }

  // Your shot's timing, under the energy bar: tier 'ex' (mint, an edge flash, and a green pulse
  // at your feet), 'slight' (warm amber) or 'off' (muted coral). Pops in, holds, fades.
  badge(tier, title, sub, dir = null) {
    let el = this.badgeEl;
    if (!el) {
      el = this.badgeEl = document.createElement('div');
      el.id = 'shot-badge';
      document.body.appendChild(el);
    }
    el.className = '';
    el.innerHTML = `<div class="sb-t"><span class="sb-d">◇</span>${title}</div><div class="sb-s">${sub}</div>`;
    void el.offsetWidth; // (restart the animation)
    el.className = `show ${tier}`;
    // (the meter's own animation: a perfect release lights up, a slightly early / late one
    // nudges amber with an arrow toward the green)
    if (this.lastMeter && (tier === 'ex' || tier === 'slight')) this.relFx = { t0: this.game.time, T: tier === 'ex' ? 0.75 : 0.65, m: { ...this.lastMeter, fx: tier === 'ex' ? 'perfect' : `slight ${dir || 'early'}`, fxKey: this.game.time } };
    if (tier === 'ex') {
      if (!this.pulse) {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 40), new THREE.MeshBasicMaterial({ color: 0x5ef2b0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 3;
        this.game.scene.add(m);
        this.pulse = m;
      }
      this.pulse.visible = true;
      this.pulse.userData.t0 = this.game.time;
    }
  }

  landed() {
    const game = this.game;
    const b = this.g.ball;
    const s = this.flight;
    this.flight = null;
    this.lastShooter = s ? s.by : null;
    b.mode = 'loose';
    if (this.t33) {
      // (your shot: through the net or off the rim; then you go get it)
      this.bounce33(b, b.make);
      const Y = this.t33.players.find((P) => P.who === 'you');
      Y.st = 'chase';
      this.result33(Y, !!b.make);
      return;
    }
    if (this.solo) {
      const S = this.stats;
      const mine = b.kind === 'shot'; // (not his shot after your pass)
      if (mine) S.att += 1;
      if (b.make) {
        // (shooting around, only jumpers count toward a heat check: layups and dunks don't)
        const hot = mine && s?.type !== 'layup' && s?.type !== 'dunk';
        if (mine) {
          if (hot) this.heatResult('you', true);
          S.made += 1;
          S.streak += 1;
          S.best = Math.max(S.best, S.streak);
        }
        b.x = this.rim.x;
        b.z = this.rim.z;
        b.vx = b.vz = 0;
        b.vy = -1.5;
        game.sfx?.swish?.();
        if (mine && S.streak >= 3) game.hud.toast(`${S.streak} straight!`, '#7ee081');
      } else {
        if (mine) {
          S.streak = 0;
          if (s?.type !== 'layup' && s?.type !== 'dunk') this.heatResult('you', false);
        }
        const side = rand(-1, 1);
        const sp = rand(1.5, 3.2);
        const L = Math.hypot(side, 1);
        b.vx = ((this.rim.dx - this.rim.dz * side) / L) * sp;
        b.vz = ((this.rim.dz + this.rim.dx * side) / L) * sp;
        b.vy = rand(0.8, 2.6);
      }
      return;
    }
    const hp = this.opp.hp;
    const foul = s && (s.foul || (s.by === 'opp' && hp.fouled));
    hp.fouled = false;
    if (b.make) {
      b.x = this.rim.x;
      b.z = this.rim.z;
      b.vx = b.vz = 0;
      b.vy = -1.5;
      game.sfx?.swish?.();
      if (s && s.counts) {
        const pts = s.pts + (foul ? 1 : 0);
        this.score[s.by] += pts;
        const who = s.by === 'you' ? 'You' : this.opp.ballName;
        game.hud.toast(foul ? `AND ONE! ${who} +${pts}` : s.by === 'you' ? `Bucket! +${pts}` : `${who} scores${s.pts > 1 ? ' from deep' : ''}`, s.by === 'you' ? '#7ee081' : '#ff8080');
        for (const q of this.g.players) if (q.hp.role === 'watch') q.hp.cheerT = 0.9;
        this.heatResult(s.by, true);
      } else if (s) game.hud.toast("Doesn't count: take it back first", '#ffd23f');
      if (this.score.you >= this.to || this.score.opp >= this.to) return this.end(this.score.you >= this.to ? 'win' : 'lose');
      this.dead = { who: s ? s.by : 'you', t: 0.9 }; // (make it, take it: the scorer's ball again)
      this.has = null;
      return;
    }
    // Fouled on a miss: the shooter's ball again.
    if (foul) {
      this.dead = { who: s.by, t: 0.9 };
      this.has = null;
      game.hud.toast(`Foul. ${s.by === 'you' ? 'Your' : `${this.opp.ballName}'s`} ball`, '#9fc3ff');
      b.vx = b.vz = 0;
      b.vy = 1;
      if (s) this.heatResult(s.by, false);
      return;
    }
    if (s) this.heatResult(s.by, false);
    const side = rand(-1, 1);
    const sp = rand(1.5, 3.2);
    const L = Math.hypot(side, 1);
    b.vx = ((this.rim.dx - this.rim.dz * side) / L) * sp;
    b.vz = ((this.rim.dz + this.rim.dx * side) / L) * sp;
    b.vy = rand(0.8, 2.6);
    // A miss resets the play: no live rebound, it's the other one's ball (the shooter goes and
    // gets it and checks it up to him).
    if (s && (s.by === 'you' || s.by === 'opp')) {
      if (s.by === 'opp') this.gainDefense(0.35); // (a stop)
      this.dead = { who: s.by === 'you' ? 'opp' : 'you', t: 0.7 };
      this.has = null;
      game.hud.toast(`Miss. ${s.by === 'you' ? `${this.opp.ballName}'s` : 'Your'} ball`, '#9fc3ff');
    }
  }

  // ---- His game (hoops.js asks for his moves while the match is on) ----
  drive(p, dt) {
    if (this.t33) return this.drive33(p, dt);
    if (this.foul) return { speed: 0 }; // (the whistle: he holds where he is)
    if (this.reset && p === this.opp && !this.solo) return this.resetDrive(p, dt);
    const game = this.game;
    const [px, pz] = game.player.pos();
    const rim = this.rim;
    const b = this.g.ball;
    const hp = p.hp;
    hp.jump = (hp.jumpT || 0) > 0 ? Math.sin(Math.min(1, hp.jumpT / 0.6) * Math.PI) * 0.5 : 0;
    const face = (x, z) => {
      p.heading = lerpAngle(p.heading, Math.atan2(x - p.x, z - p.z), Math.min(1, dt * 8));
    };
    if (this.fetch && p === this.fetch.q) return this.fetchDrive(p, dt);
    if (p === this.opp && dt > 0) {
      // (how he's actually moving: for the back-pedal)
      hp.vx = (p.x - (hp.lx ?? p.x)) / dt;
      hp.vz = (p.z - (hp.lz ?? p.z)) / dt;
      hp.lx = p.x;
      hp.lz = p.z;
    }
    if (p !== this.opp) {
      // Watching from the side.
      hp.cheerT = Math.max(0, (hp.cheerT || 0) - dt);
      if (dist(p.x, p.z, ...hp.spot) > 0.4) return { tx: hp.spot[0], tz: hp.spot[1], speed: 1.6 };
      face(b.x, b.z);
      return { speed: 0 };
    }
    // Checking it up: stand there, face to face.
    if (this.check) {
      face(px, pz);
      return { speed: 0 };
    }
    // On the floor.
    if (hp.fallT > 0) return { speed: 0 };
    const tired = 0.7 + 0.3 * hp.st;
    const dk = defK(hp.def ?? this.r);
    const slow = hp.beatT > 0 ? 0.3 + 0.25 * dk : 1; // (beaten: a step slow, less so with good D)
    // A dead ball after a basket: back to the top if it's his, back on D if not.
    if (this.dead) {
      const [tx, tz] = this.dead.who === 'opp' ? this.topOfKey() : [rim.x + rim.dx * 3, rim.z + rim.dz * 3];
      if (dist(p.x, p.z, tx, tz) > 0.4) return { tx, tz, speed: 2.4 };
      face(px, pz);
      return { speed: 0 };
    }
    // Just let a shot go: he finishes the jump (the follow-through, the fade, hanging on the
    // rim after a dunk) before he goes anywhere.
    if (hp.state === 'shoot' && this.has !== 'opp' && hp.t <= hp.rel + 0.6) return this.offense(p, dt, face, tired);
    // His own alley-oop: the run, the leap, coming down.
    if (hp.state === 'oop' || hp.state === 'oopLand') return this.offense(p, dt, face, tired);
    // Yours: to the spot it's coming down to, to go up and break it up (once it's off the glass).
    if (this.oop && this.oop.by === 'you' && !this.solo) {
      const O = this.oop;
      if (this.g.ball.kind === 'oop2' && hp.fallT <= 0 && hp.beatT <= 0) {
        face(O.cx, O.cz);
        return { tx: O.cx, tz: O.cz, speed: 4.2 * tired };
      }
      face(px, pz);
      return { speed: 0 };
    }
    // Loose ball or a shot coming down: go get it (unless you've boxed him out).
    if (b.mode === 'loose' || (b.mode === 'flight' && b.T - b.t < 0.35)) {
      if (dist(p.x, p.z, b.x, b.z) < 2 && b.y > 1.2 && Math.random() < dt * 4 && !hp.jumpT) hp.jumpT = 0.6;
      return { tx: b.x + b.vx * 0.3, tz: b.z + b.vz * 0.3, speed: (hp.boxed ? 1.6 : this.you.boxed ? 1.8 : 3.9) * tired };
    }
    if (this.has === 'opp') return this.faceUp(p, hp, this.offense(p, dt, face, tired));
    // Defending you: between you and the basket.
    if (this.has === 'you' || b.mode === 'flight') {
      const d = dist(px, pz, rim.x, rim.z) || 1;
      // (closing out on a shot; sagging off a long way out; caught behind a step-back)
      let gap = d > ARC + 2 ? 2.2 : 1.4;
      if (hp.lagT > 0) gap = 3.2;
      if (hp.closeT > 0 && this.shot) {
        gap = 0.9;
        // Up for the contest as you release.
        const s = this.shot;
        if (!hp.jumpT && hp.beatT <= 0 && s.type !== 'dunk' && s.t > s.T - 0.2 && dist(p.x, p.z, px, pz) < 2.2 && Math.random() < 0.4 + this.r / 200) hp.jumpT = 0.6;
      }
      // Beaten on a drive: he runs you down from behind and goes up for the chase-down.
      const s = this.shot;
      const behind = this.trailing(p.x, p.z, px, pz);
      if (s && (s.type === 'layup' || s.type === 'dunk') && behind && hp.fallT <= 0) {
        if (!hp.jumpT && s.t > s.T - 0.3 && Math.random() < 0.2 + this.r / 400) {
          hp.jumpT = 0.6;
          hp.chase = true;
        }
        face(px, pz);
        return { tx: px, tz: pz, speed: 6 * tired };
      }
      const k = Math.min(gap, d * 0.5);
      const tx = px + ((rim.x - px) / d) * k;
      const tz = pz + ((rim.z - pz) / d) * k;
      face(px, pz);
      if (dist(p.x, p.z, tx, tz) > 0.25) return { tx, tz, speed: 4.2 * tired * slow * (0.92 + 0.2 * dk) }; // (his slide: quicker with better D)
      return { speed: 0 };
    }
    face(b.x, b.z);
    return { speed: 0 };
  }

  // His possession: walk it up, read you, make a move, drive, shoot.
  offense(p, dt, face, tired) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const rim = this.rim;
    const hp = p.hp;
    const Y = this.you;
    hp.t += dt;
    hp.holdT = (hp.holdT || 0) + dt;
    if (hp.state === 'oop' || hp.state === 'oopLand') return this.himOop(p, hp, dt, face, tired);
    if (hp.state !== 'move' && hp.state !== 'shoot') this.protectHim(p, dt);
    const dR = dist(p.x, p.z, rim.x, rim.z);
    const dY = dist(p.x, p.z, px, pz);
    // Are you between him and the basket?
    const between = dY < 2.6 && ((px - p.x) * (rim.x - p.x) + (pz - p.z) * (rim.z - p.z)) / ((dY || 1) * (dR || 1)) > 0.5 && Y.fallT <= 0 && Y.beatT <= 0;
    const plan = hp.plan || (hp.plan = { spot: null });
    if (hp.state === 'walk') {
      if (!this.cleared && !plan.spot) plan.spot = this.onCourt(rim.x + rim.dx * 8.2, rim.z + rim.dz * 8.2);
      if (plan.spot && dist(p.x, p.z, ...plan.spot) > 0.5 && hp.t < 5) return { tx: plan.spot[0], tz: plan.spot[1], speed: 3 * tired };
      if (!this.cleared) {
        plan.spot = this.onCourt(rim.x + rim.dx * 8.5, rim.z + rim.dz * 8.5);
        hp.t = 0;
        return { speed: 0 };
      }
      plan.spot = null;
      hp.state = 'read';
      hp.t = 0;
      hp.next = rand(0.3, 0.8);
    }
    if (hp.state === 'read') {
      face(rim.x, rim.z);
      if (hp.t < hp.next) return { speed: 0 };
      hp.t = 0;
      hp.next = rand(0.35, 0.8);
      const shooter = hp.style === 'shooter' ? 1.4 : hp.style === 'slasher' ? 0.6 : 1;
      if (!between && dR < 11) return this.goDrive(hp);
      if (dY > 2.4 && dR < 8.6 && Math.random() < 0.55 * shooter) return this.goShoot(p, hp, 'jumper');
      if (dY <= 2.6) return this.goMove(p, hp);
      if (hp.holdT > 7 || Math.random() < 0.3) return dR < 8.6 ? this.goShoot(p, hp, 'jumper') : this.goDrive(hp);
      // Walk him down a step or two.
      const [tx, tz] = this.onCourt(p.x + (rim.x - p.x) * 0.25, p.z + (rim.z - p.z) * 0.25);
      hp.state = 'jab';
      hp.to = [tx, tz];
      return { speed: 0 };
    }
    if (hp.state === 'jab') {
      if (dist(p.x, p.z, ...hp.to) > 0.4 && hp.t < 1.5) return { tx: hp.to[0], tz: hp.to[1], speed: 2.4 * tired };
      hp.state = 'read';
      hp.t = 0;
      return { speed: 0 };
    }
    if (hp.state === 'move') {
      const mv = hp.mv;
      const ux = (rim.x - p.x) / (dR || 1);
      const uz = (rim.z - p.z) / (dR || 1);
      let tx = p.x;
      let tz = p.z;
      const dk = handleDist(hp.handle || this.r); // (how far it carries: his handle)
      let quick = 0;
      if (mv.kind === 'step') {
        tx -= ux * 3;
        tz -= uz * 3;
      } else if (mv.kind === 'hesi' && !mv.big) {
        quick = -1; // (a hitch on the spot)
      } else if (mv.kind === 'hesi') {
        // (a hop out to the ball's side)
        tx += -Math.cos(mv.h0) * mv.from * 2;
        tz += Math.sin(mv.h0) * mv.from * 2;
        quick = 2;
      } else if (mv.kind === 'cross' && !mv.big) {
        tx += -uz * mv.side * 2;
        tz += ux * mv.side * 2;
        quick = 1; // (a little step to that side)
      } else {
        tx += (-uz * mv.side * 0.85 + ux * 0.5) * 3;
        tz += (ux * mv.side * 0.85 + uz * 0.5) * 3;
      }
      if (hp.t >= mv.T) {
        hp.lastMoveEnd = this.clock;
        if (mv.kind === 'step') return this.goShoot(p, hp, 'jumper', true);
        if (mv.beat) return this.goDrive(hp);
        // (out of a hesitation he goes straight into something else)
        if (mv.kind === 'hesi' && Math.random() < 0.6) return this.goMove(p, hp, true);
        // (a quick crossover often goes straight back the other way: a double crossover)
        if (mv.kind === 'cross' && !mv.big && Math.random() < 0.45) return this.goMove(p, hp, true, 'cross');
        hp.state = 'read';
        hp.t = 0;
        // (the quick ones come in bunches)
        hp.next = !mv.big && Math.random() < 0.5 ? 0.05 : rand(0.15, 0.4);
        return { speed: 0 };
      }
      if (quick === -1) return { speed: 0 };
      if (quick === 1) {
        [tx, tz] = this.onCourt(tx, tz);
        return { tx, tz, speed: 4.5 * dk };
      }
      if (quick === 2) {
        const k = Math.min(1, hp.t / mv.T);
        hp.jump = 0.18 * Math.sin(Math.PI * k);
        [tx, tz] = this.onCourt(tx, tz);
        return { tx, tz, speed: ((1.2 * dk) / mv.T) * tired };
      }
      [tx, tz] = this.onCourt(tx, tz);
      if (mv.kind === 'step') {
        // A push off and a little hop back: quick out, settling as he lands.
        const k = Math.min(1, hp.t / mv.T);
        hp.jump = 0.14 * Math.sin(Math.PI * k);
        return { tx, tz, speed: 7.5 * (1 - 0.75 * k) * tired * dk };
      }
      return { tx, tz, speed: 7.5 * tired * dk }; // (the same burst speed as yours)
    }
    if (hp.state === 'drive') {
      // Off the glass to himself (the athletic ones, now and then), 4.5-8.5 m out.
      if (hp.wantOop && this.cleared && dR > 4.5 && dR < 8.5) {
        hp.wantOop = false;
        this.startOop('opp', 'glass', p.x + Math.sin(p.heading) * 0.3, p.z + Math.cos(p.heading) * 0.3, hp.vx || 0, hp.vz || 0);
        hp.state = 'oop';
        hp.t = 0;
        hp.oopLeap = null;
        hp.armsT = 0.3;
        game.hud.toast(`${p.ballName} throws it off the glass...`, '#ffd23f');
        return { speed: 0 };
      }
      // Close enough to finish: a layup from 5 m, a dunk from 3.8 m (he makes up his mind at 5).
      if (dR <= 5) {
        if (hp.wantDunk == null) {
          const clear = dY > 1.3 || Y.beatT > 0 || Y.fallT > 0;
          hp.wantDunk = this.r > 70 && clear && Math.random() < 0.5;
        }
        if (!hp.wantDunk) return this.goShoot(p, hp, 'layup');
        if (dR <= 3.8) return this.goShoot(p, hp, 'dunk');
      }
      // Cut off: you're square in front of him in intense D.
      const front = ((px - p.x) * (rim.x - p.x) + (pz - p.z) * (rim.z - p.z)) > 0;
      if (Y.intense && dY < 1.0 && front && Y.beatT <= 0 && !hp.cutOnce) {
        hp.cutOnce = true; // (once a drive: after that he goes around or pulls up)
        hp.st = Math.max(0, hp.st - 0.03);
        if (Math.random() < 0.15) {
          const b = this.g.ball;
          b.mode = 'loose';
          b.holder = null;
          b.vx = rand(-2, 2);
          b.vz = rand(-2, 2);
          b.vy = 1;
          this.has = null;
          this.lastShooter = 'opp';
          game.hud.toast('Cut him off: he lost it!', '#7ee081');
        } else game.hud.toast('Cut off', '#9fc3ff');
        // Next he goes to a move or pulls up.
        if (this.has === 'opp') {
          if (Math.random() < 0.5) return this.goMove(p, hp);
          if (dR < 8.6) return this.goShoot(p, hp, 'jumper');
        }
        hp.state = 'read';
        hp.t = 0;
        hp.next = rand(0.3, 0.6);
        return { speed: 0 };
      }
      if (hp.t > 3) {
        hp.state = 'read';
        hp.t = 0;
        return { speed: 0 };
      }
      return { tx: rim.x + rim.dx * 0.8, tz: rim.z + rim.dz * 0.8, speed: 5 * tired };
    }
    if (hp.state === 'shoot' && hp.shot === 'dunk') {
      // Up to the rim, through it, hang a moment, down.
      face(rim.x, rim.z);
      const a0 = hp.appr ? hp.appr.T : 0;
      if (hp.t < a0) {
        // (the gather and steps to the takeoff)
        hp.jump = 0;
        const r = dist(p.x, p.z, hp.appr.tx, hp.appr.tz);
        return r > 0.05 ? { tx: hp.appr.tx, tz: hp.appr.tz, speed: Math.min(8, r / Math.max(0.04, a0 - hp.t)) } : { speed: 0 };
      }
      const t = hp.t - a0;
      const R = hp.rel - a0;
      hp.jump = t < R ? 0.95 * Math.sin((Math.min(1, t / R) * Math.PI) / 2) : t < R + 0.3 ? 0.95 : 0.95 * Math.max(0, 1 - ((t - R - 0.3) / 0.25) ** 2);
      const b = this.g.ball;
      if (t >= R && b.mode === 'held' && this.has === 'opp') this.resolveHim(p, hp);
      if (t > R + 0.6) {
        hp.state = 'read';
        hp.t = 0;
        hp.jump = 0;
      }
      hp.dunkAt ??= this.dunkSpot(p.x, p.z); // (finishing from the side he came in on)
      const [ax, az] = hp.dunkAt;
      if (t < R && dist(p.x, p.z, ax, az) > 0.1) return { tx: ax, tz: az, speed: Math.min(7, dist(p.x, p.z, ax, az) / Math.max(0.05, R - t)) };
      return { speed: 0 };
    }
    if (hp.state === 'shoot' && hp.appr && hp.t < hp.appr.T) {
      // (the gather and steps into his layup)
      face(rim.x, rim.z);
      hp.jump = 0;
      const r = dist(p.x, p.z, hp.appr.tx, hp.appr.tz);
      return r > 0.05 ? { tx: hp.appr.tx, tz: hp.appr.tz, speed: Math.min(8, r / Math.max(0.04, hp.appr.T - hp.t)) } : { speed: 0 };
    }
    if (hp.state === 'shoot' && hp.shot === 'layup' && hp.appr && hp.t < hp.rel) {
      // (in the air, still carrying in toward the rim)
      face(rim.x, rim.z);
      const st = hp.rel - 0.25;
      hp.jump = hp.t < st ? 0 : 0.5 * Math.sin(((hp.t - st) / 0.25) * (Math.PI / 2));
      const fx = rim.x + rim.dx * 0.6;
      const fz = rim.z + rim.dz * 0.6;
      const r = dist(p.x, p.z, fx, fz);
      return r > 0.05 ? { tx: fx, tz: fz, speed: Math.min(8, r / Math.max(0.05, hp.rel - hp.t)) } : { speed: 0 };
    }
    if (hp.state === 'shoot') {
      face(rim.x, rim.z);
      // (his jump's timed to the shot too: the top of it at the release)
      const H = hp.shot === 'jumper' ? 0.45 : 0.5;
      const st = hp.rel - 0.25;
      hp.jump = hp.t < st ? 0 : hp.t < hp.rel ? H * Math.sin(((hp.t - st) / 0.25) * (Math.PI / 2)) : H * Math.max(0, Math.cos(Math.min(1, (hp.t - hp.rel) / 0.3) * (Math.PI / 2)));
      const b = this.g.ball;
      if (hp.t >= hp.rel && b.mode === 'held' && this.has === 'opp') this.resolveHim(p, hp);
      if (hp.t > hp.rel + 0.45) {
        hp.state = 'read';
        hp.t = 0;
        if (hp.fade) hp.settleUntil = this.clock + 0.35; // (a back-pedal step before he turns)
        hp.fade = false;
        p.char.group.rotation.x = 0;
      }
      if (hp.fade && hp.shot === 'jumper' && hp.t > st - 0.05 && hp.t < hp.rel + 0.3) {
        // (drifting back through the jump: quickest on the way up, easing off coming down)
        const k = Math.min(1, (hp.t - (st - 0.05)) / 0.6);
        const ux = (rim.x - p.x) / (dR || 1);
        const uz = (rim.z - p.z) / (dR || 1);
        const [tx, tz] = this.onCourt(p.x - ux * 2, p.z - uz * 2);
        return { tx, tz, speed: 2.2 * (1 - k) };
      }
      return { speed: 0 };
    }
    hp.state = 'read';
    return { speed: 0 };
  }

  // His face-up (your L2): with you close (or backing it out), he stays square to the basket
  // whichever way he goes: backing up at 65%, sideways at 80%. Driving or walking to a spot
  // with nobody near, he just turns and goes.
  faceUp(p, hp, r) {
    hp.faceUp = false;
    if (!r || r.tx == null || !['walk', 'jab', 'read'].includes(hp.state)) return r;
    const rim = this.rim;
    const mx = r.tx - p.x;
    const mz = r.tz - p.z;
    const ml = Math.hypot(mx, mz);
    if (ml < 0.05) return r;
    const ux = rim.x - p.x;
    const uz = rim.z - p.z;
    const c = (mx * ux + mz * uz) / (ml * (Math.hypot(ux, uz) || 1));
    const [qx, qz] = this.game.player.pos();
    const away = c < -0.3;
    if (!away && dist(p.x, p.z, qx, qz) >= 3.5) return r;
    if (c > 0.7) return r; // (straight at the basket: he's facing it anyway)
    hp.faceUp = true;
    return { ...r, speed: r.speed * (away ? 0.65 : 0.8) };
  }

  // His alley-oop: run to the spot, leap to meet it (timed so the top is the catch), come down.
  himOop(p, hp, dt, face, tired) {
    const rim = this.rim;
    const O = this.oop;
    if (hp.state === 'oopLand') {
      // (down from the top: hanging a moment after a slam)
      hp.landH ??= hp.jump || 0;
      const t = Math.max(0, hp.t - (hp.oopDunk ? 0.25 : 0));
      hp.jump = hp.landH * Math.max(0, 1 - (t / 0.32) ** 2);
      face(rim.x, rim.z);
      if (hp.t > (hp.oopDunk ? 0.7 : 0.45)) {
        hp.state = 'read';
        hp.t = 0;
        hp.jump = 0;
        hp.landH = null;
        hp.oopLeap = null;
        hp.oopDunk = false;
      }
      return { speed: 0 };
    }
    if (!O || O.by !== 'opp') {
      hp.state = 'read';
      hp.t = 0;
      hp.jump = 0;
      hp.oopLeap = null;
      return { speed: 0 };
    }
    const left = O.tCatch - this.clock;
    const r = dist(p.x, p.z, O.cx, O.cz);
    if (!hp.oopLeap && left <= 0.55 && left > 0.16 && r < OOP_REACH) hp.oopLeap = { t0: this.clock, T: left }; // (the same reach as yours)
    if (hp.oopLeap) {
      const L = hp.oopLeap;
      hp.jump = 0.95 * Math.sin((Math.min(1, (this.clock - L.t0) / L.T) * Math.PI) / 2);
      face(rim.x, rim.z);
      return r > 0.05 ? { tx: O.cx, tz: O.cz, speed: Math.min(8, r / Math.max(0.05, left)) } : { speed: 0 };
    }
    hp.jump = 0;
    face(O.cx, O.cz);
    return { tx: O.cx, tz: O.cz, speed: Math.min(6.4, r / Math.max(0.25, left - 0.45)) * Math.max(0.8, tired) }; // (a sprint at most: from too far he doesn't get there)
  }

  goDrive(hp) {
    hp.state = 'drive';
    hp.wantDunk = null;
    hp.wantOop = this.r > 72 && Math.random() < 0.15; // (an alley-oop to himself on this one)
    hp.cutOnce = false;
    hp.t = 0;
    return { speed: 0 };
  }

  goMove(p, hp, noHesi = false, force = null) {
    const game = this.game;
    let kind = force || pick(hp.style === 'shooter' ? ['step', 'step', 'hesi', 'cross', 'cross'] : ['cross', 'cross', 'behind', 'spin', 'hesi', 'step', 'legs']);
    // (like yours: a crossover toward the hand that's got it is a hesitation; the crossover and
    // hesitation are quick little ones or, like you holding R2, the big burst versions)
    if (kind === 'cross' && Math.random() < 0.2 && !noHesi && !force) kind = 'hesi';
    if (kind === 'hesi' && noHesi) kind = 'cross';
    const big = force === 'cross' ? false : kind !== 'cross' && kind !== 'hesi' ? true : Math.random() < (hp.style === 'slasher' ? 0.6 : hp.style === 'shooter' ? 0.3 : 0.45);
    const chain = this.clock - (hp.lastMoveEnd ?? -9) < 0.8;
    hp.combo = chain ? Math.min(3, hp.combo + 1) : 0;
    hp.state = 'move';
    hp.t = 0;
    const M = MOVES[kind];
    hp.hand = hp.hand || 1;
    const switches = kind === 'cross' || kind === 'behind' || kind === 'spin' || kind === 'legs';
    // (the moves that switch hands go toward the new hand's side: right hand, his right)
    const to = switches ? -hp.hand : hp.hand;
    const ux = (this.rim.x - p.x) || 1e-6;
    const uz = this.rim.z - p.z;
    const ul = Math.hypot(ux, uz) || 1;
    // (offense() moves him along (-uz, ux) * side: match it to his right hand when to = 1)
    const rx = -Math.cos(p.heading);
    const rz = Math.sin(p.heading);
    const sideFor = Math.sign(((-uz / ul) * rx + (ux / ul) * rz) * to) || 1;
    const T = big ? (kind === 'hesi' ? 0.36 : M.T) : kind === 'cross' ? 0.2 : 0.28;
    hp.mv = { kind, side: switches ? sideFor : Math.random() < 0.5 ? -1 : 1, T, beat: false, from: hp.hand, to, big, h0: p.heading };
    hp.hand = to;
    hp.st = Math.max(0, hp.st - 0.04);
    if (kind === 'step') return { speed: 0 };
    // Does it beat you? Less if you're in intense D, more if you're tired.
    const Y = this.you;
    const pr = (M.beat * (big ? 1 : 0.6) + hp.combo * 0.1) * handleEff(hp.handle || this.r) * (Y.intense ? 1.45 - this.defense / 100 : 1) * (1.2 - 0.4 * Y.st); // (GUARD: your defense, the same scale as his)
    if (Math.random() < pr) {
      hp.mv.beat = true;
      Y.beatT = 0.7;
      if (hp.combo >= 1 && Math.random() < 0.25) {
        Y.fallT = 1.1;
        game.hud.toast(`${p.ballName} broke your ankles`, '#ff8080');
        for (const q of this.g.players) if (q.hp.role === 'watch') q.hp.cheerT = 1.2;
      }
    }
    return { speed: 0 };
  }

  goShoot(p, hp, type, stepback = false) {
    this.heatShot('opp', type);
    hp.state = 'shoot';
    hp.shot = type;
    hp.dunkAt = null;
    hp.dStyle = pick(['two', 'two', 'one', 'one', 'windmill', 'tomahawk']); // (if it's a dunk)
    // A fadeaway: always off a step-back, sometimes when you're right on him.
    const [qx, qz] = this.game.player.pos();
    hp.fade = type === 'jumper' && (stepback || (dist(p.x, p.z, qx, qz) < 1.6 && Math.random() < 0.4));
    hp.t = 0;
    hp.rel = type === 'jumper' ? 0.32 * SHOT_SPEED : type === 'dunk' ? 0.5 : 0.28; // (his jumper quicker, the same as yours)
    // Layups and dunks: the same footwork as yours. The gather, two steps (a dunk from 1-2 m:
    // one; inside 1 m: a jump stop), up off the last one. The release comes after that.
    hp.appr = null;
    let how = '';
    if (type === 'layup' || type === 'dunk') {
      const rim = this.rim;
      const dR = dist(p.x, p.z, rim.x, rim.z) || 1;
      const steps = type === 'layup' ? 2 : dR > 2.5 ? 2 : dR > 1.2 ? 1 : 0;
      const sp = Math.max(4.5, p.speed || 0);
      const T = steps ? clamp((dR - (type === 'layup' ? 1.5 : 1.6)) / sp, 0.25, 0.7) : 0.15; // (keeping his speed)
      const go = steps ? clamp(sp * T, 0, dR - (type === 'layup' ? 0.9 : 0.7)) : 0;
      hp.appr = { T, tx: p.x + ((rim.x - p.x) / dR) * go, tz: p.z + ((rim.z - p.z) / dR) * go };
      hp.rel = T + (type === 'layup' ? 0.3 : 0.5);
      how = steps ? ` (gather + ${steps} step${steps > 1 ? 's' : ''})` : ' (jump stop)';
    }
    // (squaring up first: a pivot if he's facing away)
    const off = Math.abs(wrapAngle(Math.atan2(this.rim.x - p.x, this.rim.z - p.z) - p.heading));
    hp.rel += Math.max(0, off - 0.4) / 9;
    hp.stepback = stepback;
    hp.jumpT = 0;
    // (his jumper off his strong hand, a few are lefties; a layup or floater off the ball's hand)
    hp.lefty ??= Math.random() < 0.12;
    hp.sHand = type === 'jumper' ? (hp.lefty ? -1 : 1) : (hp.ballSide ?? hp.hand ?? 1) >= 0 ? 1 : -1;
    // (his layup's hand: the side he's heading to, like your stick)
    const hv = Math.hypot(hp.vx || 0, hp.vz || 0);
    if (type === 'layup' && hv > 1) {
      const rl = dist(p.x, p.z, this.rim.x, this.rim.z) || 1;
      const side = ((hp.vx || 0) * -((this.rim.z - p.z) / rl) + (hp.vz || 0) * ((this.rim.x - p.x) / rl)) / hv;
      if (Math.abs(side) > 0.2) hp.sHand = side > 0 ? 1 : -1;
    }
    hp.one = 0;
    return { speed: 0 };
  }

  // His shot goes up.
  resolveHim(p, hp) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    const Y = this.you;
    p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z); // (square to the rim at the release)
    let lv = this.openness(p.x, p.z, px, pz, Y.beatT > 0.2 || Y.fallT > 0, Y.jumpT > 0 || Y.handsUp);
    const d = dist(p.x, p.z, this.rim.x, this.rim.z);
    const r = this.r;
    let make;
    if (hp.shot === 'dunk') make = Math.random() < (lv >= 3 ? 0.6 : 0.95);
    else {
      // The same green windows as yours. His timing's off by a random amount that depends on
      // his rating (typically ~90 ms at 60 OVR, ~60 ms at 90), and it's green when that lands
      // inside the window for this shot, shrunk the same ways yours is.
      if (hp.fade) lv = Math.max(0, lv - 1); // (fading away from your hand)
      const fire = this.onFire('opp');
      const dR = fire ? Math.min(d, FIRE_RANGE) : d; // (on fire: no range)
      let w = greenWindow(hp.shot, dR) * OPEN_WINDOW[lv] * (fire ? 1.2 : 1);
      if (hp.stepback) w *= 0.9;
      if (hp.fade) w *= 0.9; // (harder to shoot going backward)
      if (hp.st < 0.4) w *= 0.75;
      const u = 1 - Math.random();
      const e = ((150 - r) / 1000) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
      const m = Math.abs(e) - w / 2;
      const green = m <= 0 && (d <= 14 || fire || Math.random() < 0.5);
      const tm = green ? 1 : m < 0.06 ? 0.7 : m < 0.16 ? 0.4 : 0.12;
      const base = hp.shot === 'layup' ? 0.82 : hp.shot === 'floater' ? 0.55 : this.base(dR);
      make = green || Math.random() < base * tm * OPEN_MAKE[lv] * (0.7 + 0.3 * hp.st);
    }
    const pts = d > ARC ? 2 : 1;
    if (hp.shot === 'dunk') {
      const b = this.g.ball;
      b.y = Math.max(b.y, this.rim.y + 0.15);
      this.launch(make, 'opp', pts, 0.14);
      game.hud.toast(make ? `${p.ballName} throws it down` : `${p.ballName} rims out the dunk`, make ? '#ff8080' : '#7ee081');
      game.shakeCamera?.(make ? 0.07 : 0.04, 0.3);
    } else this.launch(make, 'opp', pts, 0, hp.shot);
  }

  pose(p) {
    if (this.t33) return this.pose33(p);
    passReset(p.char, this.game.time); // (a pass or catch that just ended lets go of the arms first)
    let y = this.poseRaw(p);
    if (p === this.opp && this.has === 'check' && this.g.ball.holder === p) holdPose(p.char); // (the same as you)
    if (p === this.opp && !this.check) {
      const drop = reachPose(p.char, this.game.time, p.heading); // (his reach-in, the same as yours)
      if (drop != null) y += drop;
      const hp = p.hp;
      {
        // (rebounding, the same as you: ready while it's up, boxing you out, coming down with it)
        const busy = hp.state === 'shoot' || hp.state === 'oop' || hp.state === 'oopLand' || (hp.jumpT || 0) > 0 || hp.fallT > 0 || this.has === 'opp';
        if (!busy && this.you.boxed) {
          const [qx, qz] = this.game.player.pos();
          p.heading = Math.atan2(p.x - qx, p.z - qz); // (his back into you)
          p.char.group.rotation.y = p.heading;
          y += boxOutPose(p.char, this.clock * 7, Math.hypot(hp.vx || 0, hp.vz || 0) > 0.4);
        } else if (!busy && this.has === null && this.g.ball.mode === 'flight' && this.flight && dist(p.x, p.z, this.rim.x, this.rim.z) < REB_READY) readyPose(p.char); // (only in close, the same as you)
        const gd = grabPose(p.char, this.game.time);
        if (gd != null) y += gd;
      }
      for (const f of [strippedPose, scoopPose]) {
        const d = f(p.char, this.game.time, p.heading); // (stripped or scooping, the same as you)
        if (d != null) y += d;
      }
      foulPose(p.char, this.game.time);
      if ((hp.jumpT || 0) > (hp.jPrev ?? 0) + 1e-6) markJump(p.char, this.game.time, hp.jumpT, this.jumpKind('opp'), this.sideOfBall(p.x, p.z, p.heading));
      hp.jPrev = hp.jumpT || 0;
      if (hp.state !== 'shoot' && hp.state !== 'oop' && hp.state !== 'oopLand') {
        const jd = jumpPose(p.char, this.game.time); // (his block or rebound jump, the same as yours)
        if (jd != null) y += jd;
      }
    }
    if (this.check && p === this.opp) {
      // (checking it up: square to you)
      const [px, pz] = this.game.player.pos();
      p.heading = Math.atan2(px - p.x, pz - p.z);
      p.char.group.rotation.y = p.heading;
    }
    passPose(p.char, this.game.time, p.hp?.state === 'shoot'); // (a pass or a catch going on; his shot wins)
    if (p !== this.opp) return y;
    // (his joints, height and facing eased the same way as yours)
    const c = p.char;
    const s = c.group.userData.sm || (c.group.userData.sm = {});
    const dt = Math.min(0.1, Math.max(0.001, this.clock - (s.t ?? this.clock - 1 / 60)));
    s.t = this.clock;
    smoothJoints(c, dt);
    const yy = s.yo != null ? s.yo + (y - s.yo) * Math.min(1, dt * 30) : y;
    s.yo = yy;
    if (s.h != null) p.heading = s.h + wrapAngle(p.heading - s.h) * Math.min(1, dt * 25);
    s.h = p.heading;
    return yy;
  }

  poseRaw(p) {
    const hp = p.hp;
    const c = p.char;
    restPose(c); // (the back and head straight: the poses below bend them)
    c.legL.rotation.z = c.legR.rotation.z = 0;
    c.armL.rotation.z = c.armR.rotation.z = 0;
    c.armL.rotation.y = c.armR.rotation.y = 0; // (no twist left over from a pass or a hold)
    c.group.rotation.z = 0;
    if (this.fetch && p === this.fetch.q) {
      if (this.g.ball.holder === p) c.armL.rotation.x = c.armR.rotation.x = -1.2;
      return 0.04;
    }
    if (this.reset && p === this.opp) {
      // (resetting the play: walking, dribbling it if he's got it)
      if (this.g.ball.holder === p) dribbleArm(c, 1, this.game.time * 7, 0);
      return 0.04;
    }
    // His back-pedal: moving backward from what he's facing (the basket with the ball, you on
    // D), he keeps facing it and shuffles back, low, like you do.
    if (p === this.opp && hp.fallT <= 0 && !this.check && !this.dead && hp.state !== 'shoot' && hp.state !== 'move' && !(hp.jumpT > 0)) {
      const sp = Math.hypot(hp.vx || 0, hp.vz || 0);
      const [qx, qz] = this.game.player.pos();
      const look = this.has === 'opp' ? [this.rim.x, this.rim.z] : this.has === 'you' ? [qx, qz] : null;
      if (look && this.has === 'opp' && hp.faceUp) {
        // (his face-up side-step: square to the basket; his walk does the legs)
        p.heading = Math.atan2(look[0] - p.x, look[1] - p.z);
        c.group.rotation.y = p.heading;
      }
      if (look && sp > 0.5) {
        const fx = look[0] - p.x;
        const fz = look[1] - p.z;
        const fl = Math.hypot(fx, fz) || 1;
        if ((hp.vx * fx + hp.vz * fz) / (sp * fl) < -0.3) {
          p.heading = Math.atan2(fx, fz);
          c.group.rotation.y = p.heading;
          const drop = this.shuffleLegs(c, this.clock * (4 + sp * 2.2));
          if (this.has === 'opp') {
            dribbleArm(c, hp.ballSide ?? 1, hp.dribble || 0, 0);
            (hp.ballSide < 0 ? c.armR : c.armL).rotation.x = -0.6; // (the other arm out)
          } else this.defenseArms(c, false, !!hp.handsUp); // (on D: hands low, or up contesting)
          return 0.06 + drop;
        }
      }
    }
    if (p === this.opp && (hp.state === 'oop' || hp.state === 'oopLand')) {
      // (his oop: running at it, then up reaching with both hands, then coming down)
      if (hp.oopLeap || hp.state === 'oopLand') {
        const k = hp.state === 'oopLand' ? 0.6 : 1;
        c.armL.rotation.x = c.armR.rotation.x = -2.9 * k;
        c.elbowL.rotation.x = c.elbowR.rotation.x = -0.25;
        c.armL.rotation.z = 0.15;
        c.armR.rotation.z = -0.15;
        bendLeg(c.legR, c.kneeR, 0.9, 1.3); // (a knee driving up)
        bendLeg(c.legL, c.kneeL, 0.1, 0.3);
      }
      return 0.06 + (hp.jump || 0);
    }
    if (p === this.opp && hp.fallT > 0) {
      // On the floor: sat down hard.
      const y = crouchPose(c, 1);
      c.armL.rotation.x = c.armR.rotation.x = 0.6;
      return y - 0.35;
    }
    if (p === this.opp && this.clock < (hp.settleUntil || 0)) {
      // (landed from his fadeaway: a back-pedal step, still facing the basket)
      p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
      c.group.rotation.y = p.heading;
      const sp = Math.hypot(hp.vx || 0, hp.vz || 0);
      if (sp > 0.3) return 0.06 + this.shuffleLegs(c, this.clock * (4 + sp * 2.2));
    }
    const fading = hp.state === 'shoot' && hp.fade && hp.shot === 'jumper';
    if (p === this.opp && this.has !== 'you' && ((hp.state === 'move' && hp.mv?.kind === 'step') || fading)) {
      // (his step-back or fadeaway: turning smoothly to face the basket while he goes back)
      // (held on the basket: the walk would otherwise turn him to where he's going, backward)
      p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
      c.group.rotation.y = p.heading;
      // (leaning back on the fade, most at the top of the jump)
      if (fading) c.group.rotation.x = -0.25 * Math.min(1, (hp.jump || 0) / 0.45);
    }
    // His shot form (the same as yours), through the follow-through after it's gone.
    const dunking = hp.shot === 'dunk' && !(hp.appr && hp.t < hp.appr.T);
    if (p === this.opp && hp.state === 'shoot' && !dunking && (this.has === 'opp' || hp.t >= hp.rel)) {
      const A = hp.appr;
      const g0 = hp.rel - 0.25; // (off the floor)
      const f = hp.t >= hp.rel ? hp.t - hp.rel : -1;
      const air = (hp.jump || 0) > 0.02;
      const r = shotForm(c, {
        kind: hp.shot === 'dunk' ? 'layup' : hp.shot,
        hand: hp.sHand ?? 1,
        g: hp.t / (A ? 0.15 : 0.14),
        u: hp.t <= g0 ? 0 : Math.min(1, (hp.t - g0) / 0.25),
        f,
        air,
        land: f > 0.25 && !air ? f - 0.3 : -1,
        legs: !(A && hp.t < A.T),
      });
      hp.one = r.one;
      return 0.06 + (hp.jump || 0) + r.y;
    }
    // His dunk: the same whole-body dunk as yours (dunkpose.js), up through landing.
    if (p === this.opp && hp.state === 'shoot' && hp.shot === 'dunk' && !(hp.appr && hp.t < hp.appr.T)) {
      const a0 = hp.appr ? hp.appr.T : 0;
      const P = dunkPhase(hp.t - a0, hp.rel - a0, 0.3, 0.25);
      const r = dunkPose(c, hp.dStyle || 'two', P.ph, P.k, hp.sHand ?? 1);
      hp.dunkTwo = r.two;
      p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
      c.group.rotation.y = p.heading;
      return 0.06 + (hp.jump || 0) + r.y;
    }
    if (p === this.opp && this.has === 'opp') {
      if (hp.state === 'shoot' && hp.appr && hp.t < hp.appr.T) c.armL.rotation.x = c.armR.rotation.x = -1.3; // (gathered)
      else if (hp.state === 'shoot' && hp.shot === 'dunk') c.armL.rotation.x = c.armR.rotation.x = -1.6 - Math.min(1, (hp.t - (hp.appr?.T || 0)) / (hp.rel - (hp.appr?.T || 0))) * 1.5;
      else if (hp.state === 'shoot') c.armL.rotation.x = c.armR.rotation.x = -1.4 - Math.min(1, hp.t / Math.max(0.1, hp.rel)) * 1.5;
      else {
        dribbleArm(c, hp.ballSide ?? hp.hand ?? 1, hp.dribble || 0, hp.behindK); // (the hand with the ball)
        // The stance and the moves' footwork (the same as yours).
        const mv = hp.state === 'move' ? { ...hp.mv, t: hp.t, ai: true } : null; // (ai: his hop height is in hp.jump)
        if (mv && LOCKED.has(mv.kind)) {
          p.heading = mv.h0;
          c.group.rotation.y = p.heading;
        } else if (mv?.kind === 'spin') {
          p.heading = spinHeading(mv, Math.min(1, mv.t / mv.T));
          c.group.rotation.y = p.heading;
        }
        const sp = Math.hypot(hp.vx || 0, hp.vz || 0);
        return 0.06 + (hp.jump || 0) + this.dribblePose(c, p.heading, mv, sp, hp.ballSide ?? hp.hand ?? 1, false);
      }
    } else if (p === this.opp) {
      // On D: his stance and slides (the same as yours); up for a contest or a rebound.
      if (!hp.jumpT && this.has === 'you') {
        const [qx, qz] = this.game.player.pos();
        p.heading = Math.atan2(qx - p.x, qz - p.z); // (always facing you: slides, not runs)
        c.group.rotation.y = p.heading;
        // (his slide steps go by how far he's moved, the same as yours)
        const spd = Math.hypot(hp.vx || 0, hp.vz || 0);
        hp.defPh = (hp.defPh || 0) + Math.min(0.1, Math.max(0, this.clock - (hp.defT ?? this.clock))) * spd * (Math.PI / 0.42);
        hp.defT = this.clock;
        return 0.06 + this.defensePose(c, p.heading, hp.vx || 0, hp.vz || 0, hp.defPh, hp.armsT > 0, !!hp.handsUp);
      }
      c.armL.rotation.x = c.armR.rotation.x = hp.jumpT > 0 ? -2.8 : hp.armsT > 0 ? -1.6 : -1.0;
    } else if (hp.cheerT > 0) c.armR.rotation.x = -2.9;
    return 0.06 + (hp.jump || 0);
  }

  // Dribbling, yours and his: the stance and the moves' footwork. Moves the legs, arms and lean
  // on c and returns the height change (the caller adds it).
  //   Standing with it: knees bent, low, the off arm out in front guarding the ball.
  //   A crossover (and between the legs, behind the back): no turning; a side shuffle out to
  //   the new hand's side, the lead leg reaching, the trail leg following, leaning into it (one
  //   step on a quick one, two on a big one).
  //   A hesitation: a hard step out to the ball's side, the lead leg wide and bent, the weight
  //   over it and leaning that way (on a big one, then the burst).
  dribblePose(c, h, mv, speed, ballSide, sizeUp) {
    // (bent over the ball, the chest turned a little to shield it, the head up to see the floor;
    // lower sizing him up, more forward driving)
    bendSpine(c, sizeUp ? 0.32 : speed > 0.6 ? 0.22 + 0.08 * Math.min(1, speed / 5) : 0.2, -ballSide * 0.15, 0);
    c.neck.rotation.set(-0.22, ballSide * 0.06, 0);
    const right = ballSide >= 0;
    const free = right ? c.armL : c.armR;
    free.rotation.x = -0.8; // (the off arm up in front, bent, guarding the ball)
    free.rotation.z = right ? 0.2 : -0.2;
    (right ? c.elbowL : c.elbowR).rotation.x = -0.75;
    (right ? c.wristL : c.wristR).rotation.x = 0;
    // (the body's right: (-cos h, sin h))
    const rx = -Math.cos(h);
    const rz = Math.sin(h);
    if (mv && mv.kind === 'spin') {
      // (pivoting round: low, the ball tucked at the hip, the free elbow out wide)
      const k = Math.min(1, mv.t / mv.T);
      const ball = (mv.from || 1) + ((mv.to || 1) - (mv.from || 1)) * k >= 0 ? c.armR : c.armL;
      const elbow = ball === c.armR ? c.armL : c.armR;
      ball.rotation.x = -0.35;
      elbow.rotation.x = -1.1;
      elbow.rotation.z = ball === c.armR ? 0.7 : -0.7;
      (ball === c.armR ? c.elbowL : c.elbowR).rotation.x = -1.4; // (the free elbow out wide)
      (ball === c.armR ? c.elbowR : c.elbowL).rotation.x = -0.9; // (the ball tucked at the hip)
      bendSpine(c, 0.3, -(mv.to || 1) * 0.5 * Math.sin(Math.PI * k), 0); // (the chest leading the turn)
      c.neck.rotation.set(-0.2, -(mv.to || 1) * 0.35 * Math.sin(Math.PI * k), 0);
      const dl = bendLeg(c.legL, c.kneeL, 0.55, 1.0);
      const dr = bendLeg(c.legR, c.kneeR, 0.45 + 0.25 * Math.sin(Math.PI * 2 * k), 0.8);
      c.legL.rotation.z = 0.15;
      c.legR.rotation.z = -0.15 - 0.2 * Math.sin(Math.PI * k);
      return -Math.min(dl, dr);
    }
    if (mv && SHUFFLES.has(mv.kind)) {
      const k = Math.min(1, mv.t / mv.T);
      const side = mv.to || 1;
      const ph = k * Math.PI * (mv.big ? 2 : 1);
      const spread = 0.1 + 0.32 * Math.abs(Math.sin(ph)) + (mv.kind === 'legs' ? 0.15 : 0);
      const dl = bendLeg(c.legL, c.kneeL, 0.5, 0.9);
      const dr = bendLeg(c.legR, c.kneeR, 0.5, 0.9);
      c.legL.rotation.z = spread;
      c.legR.rotation.z = -spread;
      c.group.rotation.z = side * 0.08 * Math.sin(Math.PI * k);
      // (dipping the shoulder and leaning into the new side, head level)
      const m = Math.sin(Math.PI * k);
      bendSpine(c, 0.26 + 0.06 * m, -side * 0.12 * m, side * 0.22 * m);
      c.neck.rotation.set(-0.22, 0, -side * 0.15 * m);
      return -Math.min(dl, dr);
    }
    if (mv && mv.kind === 'hesi' && mv.big) {
      // (the hop out: knees tucked a little, off the floor, leaning out)
      const k = Math.min(1, mv.t / mv.T);
      const dl = bendLeg(c.legL, c.kneeL, 0.45, 0.85);
      const dr = bendLeg(c.legR, c.kneeR, 0.45, 0.85);
      c.legL.rotation.z = 0.18;
      c.legR.rotation.z = -0.18;
      c.group.rotation.z = (mv.from || 1) * 0.1 * Math.sin(Math.PI * k);
      bendSpine(c, 0.12, 0, (mv.from || 1) * 0.15 * Math.sin(Math.PI * k));
      return -Math.min(dl, dr) + (mv.ai ? 0 : 0.18 * Math.sin(Math.PI * k));
    }
    if (mv && mv.kind === 'hesi') {
      const k = Math.min(1, mv.t / mv.T);
      const side = mv.from || 1;
      // (the step out, held a moment; on a big one it's over before the burst)
      const s = Math.sin(Math.PI * Math.min(1, k * (mv.big ? 1.7 : 1)));
      const lead = side > 0 ? [c.legR, c.kneeR] : [c.legL, c.kneeL];
      const trail = side > 0 ? [c.legL, c.kneeL] : [c.legR, c.kneeR];
      const dl = bendLeg(lead[0], lead[1], 0.35 + 0.35 * s, 0.6 + 0.7 * s);
      const dt2 = bendLeg(trail[0], trail[1], 0.3, 0.55);
      lead[0].rotation.z = -side * 0.5 * s;
      c.group.rotation.z = side * 0.1 * s;
      // (the head and shoulders pop up selling the shot, then sink over the lead leg)
      bendSpine(c, 0.2 - 0.18 * s + 0.12 * s * s, -side * 0.12 * s, side * 0.16 * s);
      c.neck.rotation.set(-0.22 - 0.15 * s, 0, 0);
      c.group.position.x += rx * side * 0.3 * s;
      c.group.position.z += rz * side * 0.3 * s;
      return -Math.min(dl, dt2);
    }
    if (mv && mv.kind === 'step') {
      // (the step-back: rocking back off the front foot, then settling)
      const k = Math.min(1, mv.t / mv.T);
      bendSpine(c, 0.24 - 0.38 * Math.sin(Math.PI * k), 0, 0);
      c.neck.rotation.set(-0.22 + 0.15 * Math.sin(Math.PI * k), 0, 0);
    }
    if (speed < 0.6 || sizeUp) return crouchPose(c, sizeUp ? 0.38 : 0.28); // (the stance)
    return 0;
  }

  // Defense, yours and his: a wide base, knees bent deep, one hand up to bother the shot and one
  // low and out to poke at the ball. Sliding sideways the feet push apart and come back together
  // (they never cross), low, leaning a little into the slide; backing up it's the backward
  // shuffle. (h: his facing; vx, vz: how he's moving; ph: the step phase; swipe: reaching in.)
  // The defensive stance (yours and his): low and wide, both hands low and out (both up
  // contesting when hands is on). Sliding, it steps: the lead foot lifts and reaches out to the
  // side, the trail foot pushes and closes in (never crossing), the hips bobbing with each step;
  // ph is the step phase, advanced by how far you've actually moved (so the feet don't skate).
  defensePose(c, h, vx, vz, ph, swipe, hands = false) {
    this.defenseArms(c, swipe, hands);
    // (bent at the waist over a flat back, chest up, eyes on him; tall with the hands up)
    bendSpine(c, hands ? 0.06 : 0.34, 0, 0);
    c.neck.rotation.set(hands ? -0.2 : -0.38, 0, 0);
    const sp = Math.hypot(vx, vz);
    const fwd = sp > 0 ? (vx * Math.sin(h) + vz * Math.cos(h)) / sp : 0;
    const lat = sp > 0 ? (vx * -Math.cos(h) + vz * Math.sin(h)) / sp : 0;
    if (sp > 0.4 && Math.abs(lat) <= 0.45) return this.shuffleLegs(c, ph) + 0.02 * Math.sin(ph * 2); // (closing out or backing up: short choppy steps, never a glide)
    void fwd;
    if (sp > 0.4 && Math.abs(lat) > 0.45) {
      const T = Math.PI * 2;
      const u = (((ph % T) + T) % T) / T;
      const reach = u < 0.5 ? Math.sin((u / 0.5) * Math.PI * 0.5) : Math.cos(((u - 0.5) / 0.5) * Math.PI * 0.5); // (the lead foot out, then back under)
      const liftLead = u < 0.5 ? Math.sin((u / 0.5) * Math.PI) : 0;
      const liftTrail = u >= 0.5 ? Math.sin(((u - 0.5) / 0.5) * Math.PI) : 0;
      const right = lat > 0; // (moving to his right: the right foot leads)
      const [LL, LK, TL, TK] = right ? [c.legR, c.kneeR, c.legL, c.kneeL] : [c.legL, c.kneeL, c.legR, c.kneeR];
      const dl = bendLeg(LL, LK, 0.62 + 0.3 * liftLead, 1.1 + 0.6 * liftLead);
      const dt2 = bendLeg(TL, TK, 0.62 + 0.22 * liftTrail, 1.1 + 0.45 * liftTrail);
      const leadOut = 0.2 + 0.36 * reach;
      const trailOut = 0.2 - 0.1 * liftTrail;
      LL.rotation.z = right ? -leadOut : leadOut;
      TL.rotation.z = right ? trailOut : -trailOut;
      c.group.rotation.z = (right ? 1 : -1) * 0.06 * (1 - reach);
      return -Math.min(dl, dt2) + 0.025 * Math.sin(u * Math.PI * 4); // (a little bob with each step)
    }
    // (set: wide and low)
    const dl = bendLeg(c.legL, c.kneeL, 0.75, 1.3);
    const dr = bendLeg(c.legR, c.kneeR, 0.75, 1.3);
    c.legL.rotation.z = 0.22;
    c.legR.rotation.z = -0.22;
    return -Math.min(dl, dr);
  }

  // Both hands low and out, ready (or both up high, contesting).
  defenseArms(c, swipe, hands = false) {
    if (hands) {
      c.armL.rotation.x = c.armR.rotation.x = -2.75;
      c.armL.rotation.z = 0.18;
      c.armR.rotation.z = -0.18;
      c.elbowL.rotation.x = c.elbowR.rotation.x = -0.15;
      c.wristL.rotation.x = c.wristR.rotation.x = -0.2;
      return;
    }
    c.armR.rotation.x = -0.85;
    c.armR.rotation.z = -0.5;
    c.armL.rotation.x = swipe ? -1.6 : -0.85; // (the low hands, out to the ball)
    c.armL.rotation.z = 0.5;
    c.elbowR.rotation.x = -0.5;
    c.elbowL.rotation.x = swipe ? -0.1 : -0.5;
    c.wristL.rotation.x = c.wristR.rotation.x = 0;
  }

  // The backward shuffle's legs (knees bent, short steps reaching back) at step phase ph;
  // returns the height change.
  shuffleLegs(c, ph) {
    const sw = Math.sin(ph);
    const dl = bendLeg(c.legL, c.kneeL, 0.45 - 0.4 * sw, 0.8 + 0.35 * Math.max(0, Math.cos(ph)));
    const dr = bendLeg(c.legR, c.kneeR, 0.45 + 0.4 * sw, 0.8 + 0.35 * Math.max(0, -Math.cos(ph)));
    return -Math.min(dl, dr);
  }

  // Your arms and stance (main.js, after you move).
  late(dt) {
    passReset(this.game.player.char, this.game.time); // (a pass or catch that just ended lets go of the arms first)
    this.lateRaw(dt);
    // (checking it up with the ball: held in both hands)
    if (this.has === 'check' && this.g.ball.holder === 'you') holdPose(this.game.player.char);
    if (this.t3 && this.has === 'you' && !this.shot) holdPose(this.game.player.char); // (the contest: ball off the rack, set to shoot)
    if (this.t3?.grab) this.game.player.char.group.position.y += this.t3.pose(this.game.player); // (reaching to the rack)
    // (a reach-in going on: the lunge and swipe over the stance)
    if (!this.check && !this.t33) {
      const p = this.game.player;
      const drop = reachPose(p.char, this.game.time, p.heading);
      if (drop != null) p.char.group.position.y += drop;
      // (rebounding: ready while it's up, boxing him out, coming down with it)
      {
        const Y = this.you;
        const b = this.g.ball;
        const busy = Y.dunk || this.shot || Y.fall || Y.jumpT > 0 || Y.fallT > 0 || Y.settle > 0 || this.has === 'you';
        if (!busy && this.opp.hp?.boxed && !this.solo) {
          p.heading = Math.atan2(p.x - this.opp.x, p.z - this.opp.z); // (your back into him)
          p.char.group.rotation.y = p.heading;
          Y.boxPh = (Y.boxPh || 0) + dt * 7;
          p.char.group.position.y += boxOutPose(p.char, Y.boxPh, Math.hypot(p.vx || 0, p.vz || 0) > 0.4);
        } else if (!busy && this.has === null && b.mode === 'flight' && this.flight && dist(p.x, p.z, this.rim.x, this.rim.z) < REB_READY) readyPose(p.char); // (only in close, where the rebound is)
        const gd = grabPose(p.char, this.game.time);
        if (gd != null) p.char.group.position.y += gd;
      }
      // (stripped, or scooping a loose ball up)
      for (const f of [strippedPose, scoopPose]) {
        const d = f(p.char, this.game.time, p.heading);
        if (d != null) p.char.group.position.y += d;
      }
      foulPose(p.char, this.game.time); // (a reach-in foul: owning it, or asking for the call)
      // (a block or a rebound jump: the whole body, the same as his)
      const Y = this.you;
      const [px, pz] = p.pos();
      if (Y.jumpT > (Y.jPrev ?? 0) + 1e-6) markJump(p.char, this.game.time, 0.55, this.jumpKind('you'), this.sideOfBall(px, pz, p.heading));
      Y.jPrev = Y.jumpT;
      if (!Y.dunk && !this.shot && !Y.fall) {
        const jd = jumpPose(p.char, this.game.time);
        if (jd != null) p.char.group.position.y += jd;
      }
    }
    // (checking it up: square to him, whatever the stick or the camera's doing)
    if (this.check && !this.t33 && this.opp) {
      const p = this.game.player;
      const [px, pz] = p.pos();
      p.heading = Math.atan2(this.opp.x - px, this.opp.z - pz);
      p.char.group.rotation.y = p.heading;
    }
    passPose(this.game.player.char, this.game.time, !!(this.shot || this.you.dunk)); // (a pass or a catch going on; your shot wins)
    // (easing every joint toward this frame's pose, and the height and facing too)
    const c = this.game.player.char;
    const s = smoothJoints(c, dt);
    const g = c.group;
    if (s.y != null) g.position.y = s.y + (g.position.y - s.y) * Math.min(1, dt * 30);
    if (s.ry != null) g.rotation.y = s.ry + wrapAngle(g.rotation.y - s.ry) * Math.min(1, dt * 25);
    s.y = g.position.y;
    s.ry = g.rotation.y;
  }

  // Your shot form this frame (arms and legs; the jump height's added below).
  formYou(c) {
    const s = this.shot;
    const A = s.approach;
    const g0 = A ? A.T : s.turnT + 0.08; // (off the floor)
    const g = A ? s.t / 0.15 : (s.t - s.turnT) / 0.14;
    const u = s.t <= g0 ? 0 : Math.min(1, (s.t - g0) / Math.max(0.05, s.T - g0));
    const kind = s.type === 'dunk' ? 'layup' : s.type;
    const r = shotForm(c, { kind, hand: s.hand ?? 1, g, u, air: this.shotHeight(s) > 0.02, legs: !(A && s.t < A.T) });
    s.one = r.one;
    return r;
  }

  lateRaw(dt) {
    const game = this.game;
    const p = game.player;
    const c = p.char;
    const Y = this.you;
    p.showWeapon('fists');
    restPose(c); // (the back and head straight: the poses below bend them)
    c.legL.rotation.z = c.legR.rotation.z = 0;
    c.armL.rotation.z = c.armR.rotation.z = 0;
    c.armL.rotation.y = c.armR.rotation.y = 0; // (no twist left over from a pass or a hold)
    c.group.rotation.z = 0;
    c.group.rotation.x = 0;
    Y.armsT = Math.max(0, (Y.armsT || 0) - dt);
    if (Y.fallT > 0) {
      const y = crouchPose(c, 1);
      c.armL.rotation.x = c.armR.rotation.x = 0.6;
      c.group.position.y += y - 0.35;
      return;
    }
    if (this.reset) {
      // (resetting the play: walking, dribbling it if you've got it)
      if (this.g.ball.holder === 'you') dribbleArm(c, 1, game.time * 7, 0);
      return;
    }
    // A dunk: up, the arms (by style), hanging on the rim, down.
    if (Y.dunk) {
      const D = Y.dunk;
      const P = dunkPhase(D.t, D.rise, D.hangs ? D.hang : 0, D.drop);
      const r = dunkPose(c, D.style, P.ph, P.k, D.hand ?? 1);
      Y.dunkTwo = r.two;
      c.group.rotation.y = p.heading;
      c.group.position.y += this.dunkHeight() + r.y;
      return;
    }
    if (Y.holdH && Y.holdH.t > 0) {
      Y.holdH.t -= dt;
      if (Y.stickIdle && this.has === 'you') {
        p.heading = Y.holdH.h;
        c.group.rotation.y = p.heading;
      }
    }
    // Squaring back up after a crossover (the left stick left alone).
    if (Y.squareT > 0) {
      Y.squareT -= dt;
      if (Y.stickIdle && !Y.move && !this.shot && this.has === 'you') {
        p.heading = lerpAngle(p.heading, Math.atan2(this.rim.x - p.x, this.rim.z - p.z), Math.min(1, dt * 12));
        c.group.rotation.y = p.heading;
      }
    }
    // A step-back or a back-pedal: going back, still facing the basket.
    if ((Y.move?.kind === 'step' || (Y.squareUp && !this.shot)) && this.has === 'you') {
      p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
      c.group.rotation.y = p.heading;
    }
    // In the air after a shot, and the back-pedal step after a fadeaway: facing the basket.
    if (Y.fall || Y.settle > 0) {
      p.heading = Math.atan2(this.rim.x - p.x, this.rim.z - p.z);
      c.group.rotation.y = p.heading;
      if (!Y.fall && p.speed > 0.3) {
        Y.bpPhase = (Y.bpPhase || 0) + dt * (4 + p.speed * 2.2);
        c.group.position.y += this.shuffleLegs(c, Y.bpPhase);
      }
    }
    // Intense D (L2): your back to the basket, square to the play, low. Retreating toward the
    // rim it's the backward shuffle.
    // Without it you just run to get back, but standing on him you're still in your stance.
    if (this.has === 'opp' && Y.fallT <= 0 && !(Y.jumpT > 0)) {
      if (Y.intense) {
        p.heading = Math.atan2(p.x - this.rim.x, p.z - this.rim.z);
        c.group.rotation.y = p.heading;
      }
      const sp = Math.hypot(p.vx || 0, p.vz || 0);
      if (Y.intense || sp < 0.6 || Y.handsUp) {
        Y.defPh = (Y.defPh || 0) + dt * sp * (Math.PI / 0.42); // (steps by distance: no skating)
        c.group.position.y += this.defensePose(c, p.heading, p.vx || 0, p.vz || 0, Y.defPh, Y.armsT > 0, !!Y.handsUp);
      } else if (Y.handsUp) this.defenseArms(c, false, true);
    }
    if (this.has === 'you' && this.g.ball.mode === 'held') {
      if (this.shot) {
        Y.form = this.formYou(c);
        c.group.rotation.y = p.heading; // (squaring up to the basket)
      } else {
        Y.follow = null;
        dribbleArm(c, this.ballSide ?? Y.hand, this.dribble || 0, this.behindK);
        // Back-pedaling: a low shuffle backward, short steps, each foot reaching back.
        if (Y.backpedal && p.speed > 0.3) {
          Y.bpPhase = (Y.bpPhase || 0) + dt * (4 + p.speed * 2.2);
          c.group.position.y += this.shuffleLegs(c, Y.bpPhase);
          const free = (this.ballSide ?? Y.hand) < 0 ? c.armR : c.armL; // (the other arm out, for balance)
          free.rotation.x = -0.6;
        } else {
          // The stance and the moves' footwork (the same for him).
          if (Y.move && LOCKED.has(Y.move.kind)) {
            p.heading = Y.move.h0; // (no turning: you shuffle out, facing the same way)
            c.group.rotation.y = p.heading;
          } else if (Y.move?.kind === 'spin') {
            p.heading = spinHeading(Y.move, Math.min(1, Y.move.t / Y.move.T));
            c.group.rotation.y = p.heading;
          }
          c.group.position.y += this.dribblePose(c, p.heading, Y.move, p.speed, this.ballSide ?? Y.hand, Y.sizeUp);
        }
      }
    } else if (Y.jumpT > 0) c.armL.rotation.x = c.armR.rotation.x = -2.8;
    else if (Y.follow) {
      // After the release: the follow-through, coming down, landing soft.
      const F = Y.follow;
      F.t += dt;
      if (!Y.fall) F.land = (F.land ?? -dt) + dt;
      const r = shotForm(c, { kind: F.kind, hand: F.hand, g: 1, u: 1, f: F.t, air: !!Y.fall, land: F.land ?? -1 });
      c.group.position.y += r.y;
      if (F.t > 0.45) Y.follow = null;
    } else if (Y.armsT > 0) c.armR.rotation.x = -1.6;
    // Off the floor: the shot's own jump, coming down after it, or a block / rebound jump.
    if (this.shot && this.shot.approach && this.shot.t < this.shot.approach.T && this.has === 'you') {
      // (gathered: ball at the chest, two hands, on the run; the arms are set above)
    } else if (this.shot && this.shot.type !== 'dunk' && this.has === 'you') {
      const s = this.shot;
      const h = this.shotHeight(s);
      c.group.position.y += h > 0 ? h : Y.form?.y || 0; // (the gather: a dip, then up)
      if (s.fade) c.group.rotation.x = -0.25 * Math.min(1, h / 0.45); // (leaning back on the fade)
      c.group.rotation.y = p.heading;
    } else if (Y.fall) {
      Y.fall.t += dt;
      const k = Math.min(1, Y.fall.t / Y.fall.T);
      c.group.position.y += Y.fall.h0 * (1 - k * k);
      if (Y.fall.fade != null) {
        // (still drifting back and leaning as you come down)
        const fk = Math.min(1, Y.fall.fade + Y.fall.t / 0.6);
        const [qx, qz] = p.pos();
        this.fadeDrift(p, qx, qz, fk, dt);
        c.group.rotation.x = -0.25 * (1 - k);
      }
      if (k >= 1) {
        if (Y.fall.fade != null) Y.settle = 0.35;
        Y.fall = null;
      }
    } else if (Y.jumpT > 0) c.group.position.y += Math.sin((Y.jumpT / 0.55) * Math.PI) * 0.5;
  }

  // ---- Over ----
  end(how) {
    const game = this.game;
    this.tiredFx(1); // (colors back)
    const mm = document.getElementById('minimap');
    if (mm) mm.style.visibility = ''; // (the minimap back)
    this.scoreboard?.hide();
    if (this.badgeEl) this.badgeEl.className = '';
    if (this.pulse) this.pulse.visible = false;
    this.foul = null;
    this.game.camFocus = null;
    this.camF = null;
    this.fx?.clear();
    document.body.classList.remove('hooping');
    this.heat = null;
    this.reset = null;
    if (this.t3) {
      // The contest's over (or walked away from): the racks and balls go, his group gets its court back.
      this.t3.clear();
      for (const b of [...this.t3.flying.map((F) => F.b)]) game.scene.remove(b.mesh);
      if (how !== 'contest') game.hud.toast('Contest called off', '#9fc3ff');
      this.t3 = null;
      this.solo = false;
      this.active = false;
      this.again = game.time + 0.6;
      this.shot = null;
      this.flight = null;
      this.has = null;
      const g = this.realG;
      if (g) {
        g.match = null;
        for (const q of g.players) if (!q.removed) this.H.toWait(q);
      }
      this.g = g || this.g;
      game.hud.sport?.(null);
      return;
    }
    if (this.t33) {
      // 33's over: the pot (everyone's buy-in) to the winner, back to shooting around.
      const T = this.t33;
      const n = T.players.length;
      if (how === 'win') {
        game.cash += T.bet * n;
        game.cred += 8;
        game.hud.toast(`Last man standing!${T.bet ? ` +$${T.bet * (n - 1)}` : ''} · +8 cred`, '#7ee081');
      } else if (how === 'lose') {
        const left = T.players.filter((P) => !P.out && P.who !== 'you');
        if (left.length === 1) game.hud.toast(`${left[0].name} wins 33${T.bet ? ` · -$${T.bet}` : ''}`, '#ff8080');
        else game.hud.toast(`You're out of 33${T.bet ? ` · -$${T.bet}` : ''}. ${left.map((P) => P.name).join(' and ')} play on`, '#ff8080');
      } else if (how === 'forfeit') game.hud.toast(`You walked out of 33${T.bet ? ` · -$${T.bet}` : ''}`, '#ff8080');
      else if (how === 'off') {
        game.cash += T.bet;
        game.hud.toast('33 called off', '#9fc3ff');
      }
      for (const P of T.players) if (P.ball && P.ball.mode !== 'gone') game.scene.remove(P.ball.mesh);
      for (const R of this.rings33 || []) {
        game.scene.remove(R.mesh);
        game.scene.remove(R.burst);
      }
      for (const L of this.labels33 || []) game.scene.remove(L.s);
      this.rings33 = null;
      this.labels33 = null;
      this.t33 = null;
      this.solo = false;
      const g = this.g;
      this.active = false;
      this.again = game.time + 0.6;
      this.shot = null;
      this.flight = null;
      if (g) {
        g.match = null;
        for (const q of g.players) {
          if (q.hp) q.hp.s33 = null;
          if (!q.removed) this.H.toWait(q);
        }
        // (one of them comes over: the winner if it wasn't you, or one of the ones you beat)
        if (how === 'win' || how === 'lose') {
          const others = T.players.filter((P) => P.who !== 'you' && !P.who.removed);
          const winner = others.find((P) => !P.out);
          const who = how === 'lose' && winner ? winner.who : others.length ? pick(others).who : null;
          game.postGame?.start({ H: this.H, g, who, youWon: how === 'win', bet: T.bet, margin: 10 });
        }
        const b = g.ball;
        if (b.mode === 'held' && b.holder === 'you') {
          b.mode = 'loose';
          b.holder = null;
          b.vx = b.vz = 0;
          b.vy = 0;
        }
      }
      game.hud.sport?.(null);
      game.save();
      return;
    }

    const name = this.opp?.ballName || 'He';
    const bet = this.bet;
    if (how === 'win') {
      const cred = this.r >= 82 ? 12 : 8;
      game.cash += bet * 2;
      game.cred += cred;
      game.hud.toast(`You beat ${name} ${this.score.you}-${this.score.opp}${bet ? ` · +$${bet}` : ''} · +${cred} cred`, '#7ee081');
    } else if (how === 'lose') {
      game.hud.toast(`${name} wins ${this.score.opp}-${this.score.you}${bet ? ` · -$${bet}` : ''}`, '#ff8080');
    } else if (how === 'done') {
      const S = this.stats;
      game.hud.toast(S.att ? `Shot ${S.made}/${S.att} (${Math.round((S.made / S.att) * 100)}%) · best streak ${S.best}` : 'Put the ball down', '#9fc3ff');
    } else if (how === 'forfeit') {
      game.hud.toast(`You walked off: ${name} takes it${bet ? ` · -$${bet}` : ''}`, '#ff8080');
    } else {
      game.cash += bet; // (called off: money back)
      game.hud.toast('Game called off', '#9fc3ff');
    }
    this.active = false;
    this.again = game.time + 0.6; // (the press that ended it doesn't start another)
    this.shot = null;
    this.dead = null;
    this.check = null;
    this.flight = null;
    const g = this.g;
    if (this.passMark) this.passMark.visible = false;
    this.pass = null;
    if (this.solo) {
      this.solo = false;
      this.releaseFetch();
      // Every ball stays on the court where it is (yours put down in front of you).
      const P = this.H.site.pad;
      const onPad = (x, z) => [clamp(x, P.x0 + 0.4, P.x1 - 0.4), clamp(z, P.z0 + 0.4, P.z1 - 0.4)];
      const leave = (b, x, z) => {
        const [lx, lz] = onPad(x, z);
        b.mesh.position.set(lx, 0.18, lz);
        b.mesh.visible = true;
        this.spares.push({ H: this.H, mesh: b.mesh, home: [lx, lz] });
      };
      const b = g.ball;
      if (b.mode === 'held' && b.holder === 'you') {
        const [px, pz] = game.player.pos();
        leave(b, px + Math.sin(game.player.heading) * 0.6, pz + Math.cos(game.player.heading) * 0.6);
      } else leave(b, b.x, b.z);
      for (const st of this.strays || []) leave(st.b, st.b.x, st.b.z);
      this.strays = [];
      game.hud.sport?.(null);
      return;
    }
    if (g) {
      g.match = null;
      // Back to shooting around.
      if (g.ball.mode === 'held' && g.ball.holder === 'you') g.ball.mode = 'loose';
      for (const q of g.players) if (!q.removed) this.H.toWait(q);
      if (g.ball.mode === 'held' && g.ball.holder === this.opp) this.H.giveBall(g, this.opp);
      // (he comes over: a dap, a hug... or he's heated)
      if (how === 'win' || how === 'lose') game.postGame?.start({ H: this.H, g, who: this.opp, youWon: how === 'win', bet: this.bet, margin: Math.abs(this.score.you - this.score.opp) });
    }
    game.hud.sport?.(null);
    game.save();
  }
}
