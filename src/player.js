import * as THREE from 'three';
const _c = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const GETUP = 1.0; // seconds to get back up after a tumble
import { CFG } from './config.js';
import { makeCharacter, animateWalk, setDown, crouchPose, lam, straightArms } from './character.js';
import { pushCircle } from './collision.js';
import { clamp, lerp, lerpAngle } from './util.js';

export class Player {
  constructor(game, x, z) {
    this.game = game;
    this.char = makeCharacter({ shirt: 0x1e7d32, pants: 0x1b1b1b, skin: 0x8d5524, bandana: 0x1e7d32 });
    game.scene.add(this.char.group);
    // Guns held in the right hand.
    this.guns = {
      pistol: new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.32), lam(0x1a1a1a)),
      smg: new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.6), lam(0x2a2a2a)),
      rifle: new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.95), lam(0x2b2f26)),
      shotgun: new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 0.9), lam(0x4a3420)),
    };
    // A matching set for the left hand (used when peeking out of cover to the left).
    this.gunsL = {};
    for (const [k, g] of Object.entries(this.guns)) {
      g.position.set(0, -0.04, 0); // (in the hand: off the wrist)
      g.rotation.x = Math.PI / 2;
      g.visible = false;
      this.char.wristR.add(g);
      const l = g.clone();
      this.gunsL[k] = l;
      this.char.wristL.add(l);
    }
    this.gunHand = 'R';
    this.weaponId = null;
    this.x = x;
    this.z = z;
    this.heading = Math.PI;
    this.speed = 0;
    this.moveX = 0;
    this.moveZ = 1;
    this.vx = 0;
    this.vz = 0;
    this.phase = 0;
    this.punchT = 0;
    this.vehicle = null;
    this.crouched = false; // crouch toggle
    this.lowProfile = false; // crouched right now (not popped up to aim)
    this.cover = null; // pressed up against a wall, crate or car
    this.poseY = 0;
  }

  // Cover surfaces near (x, z) as boxes in their own frame: center, rotation (c, s), half sizes.
  coverFrames() {
    const game = this.game;
    const out = [];
    const near = (b) => Math.abs((b.minX + b.maxX) / 2 - this.x) < 60 && Math.abs((b.minZ + b.maxZ) / 2 - this.z) < 60;
    // (rotated boxes: frame x axis = (c, -s), z axis = (s, c), as for vehicles)
    const frame = (b) => (b.ob
      ? { ox: b.ob.cx, oz: b.ob.cz, c: b.ob.c, s: -b.ob.s, hx: b.ob.hx, hz: b.ob.hz }
      : { ox: (b.minX + b.maxX) / 2, oz: (b.minZ + b.maxZ) / 2, c: 1, s: 0, hx: (b.maxX - b.minX) / 2, hz: (b.maxZ - b.minZ) / 2 });
    for (const b of game.city.los) {
      if (near(b)) out.push({ ref: b, low: false, frame: () => frame(b) });
    }
    for (const b of game.city.crates) {
      // (crate tops are heights above sea level: low cover if under 1.8 m off the ground)
      if (near(b)) out.push({ ref: b, low: b.h - game.city.groundY(b.x, b.z) < 1.8, frame: () => frame(b) });
    }
    for (const v of game.vehicles) {
      if (v.removed || Math.abs(v.x - this.x) > 8 || Math.abs(v.z - this.z) > 8) continue;
      out.push({ ref: v, low: v.type.h < 1.5, vehicle: true,
        frame: () => ({ ox: v.x, oz: v.z, c: Math.cos(v.heading), s: Math.sin(v.heading), hx: v.type.w / 2, hz: v.type.l / 2 }) });
    }
    return out;
  }

  // Take cover: snap to the nearest wall, crate or car within reach (preferring the one you're facing).
  tryCover(camYaw, a) {
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    let dx = fx * a.moveY - fz * a.moveX;
    let dz = fz * a.moveY + fx * a.moveX;
    if (Math.hypot(dx, dz) < 0.2) [dx, dz] = [Math.sin(this.heading), Math.cos(this.heading)];
    let best = null;
    let bestScore = Infinity;
    for (const cand of this.coverFrames()) {
      const f = cand.frame();
      const ex = this.x - f.ox, ez = this.z - f.oz;
      const lx = ex * f.c - ez * f.s;
      const lz = ex * f.s + ez * f.c;
      const cx = clamp(lx, -f.hx, f.hx), cz = clamp(lz, -f.hz, f.hz);
      const d = Math.hypot(lx - cx, lz - cz);
      if (d > 1.8 || d < 1e-4) continue;
      // Which face: the side you're out past the most.
      const ox = Math.abs(lx) - f.hx, oz = Math.abs(lz) - f.hz;
      const axis = ox > oz ? 'x' : 'z';
      const sign = axis === 'x' ? Math.sign(lx) : Math.sign(lz);
      const [nx, nz] = this.toWorld(f, axis === 'x' ? sign : 0, axis === 'z' ? sign : 0);
      const facing = -(dx * nx + dz * nz) / (Math.hypot(dx, dz) || 1);
      const score = d - facing * 0.9;
      if (score < bestScore) {
        bestScore = score;
        best = { ...cand, axis, sign };
      }
    }
    if (!best) return false;
    this.cover = { ...best, side: 1, pushAway: 0, lean: 0, snap: 0 };
    this.crouched = false;
    const [tx, tz] = this.coverTangent();
    // Face along the wall the way you were already looking.
    this.cover.side = tx * Math.sin(this.heading) + tz * Math.cos(this.heading) >= 0 ? 1 : -1;
    return true;
  }

  leaveCover() {
    this.cover = null;
  }

  // A local direction (in the cover's frame) to a world direction.
  toWorld(f, lx, lz) {
    return [lx * f.c + lz * f.s, -lx * f.s + lz * f.c];
  }

  coverTangent() {
    const f = this.cover.frame();
    return this.cover.axis === 'x' ? this.toWorld(f, 0, 1) : this.toWorld(f, 1, 0);
  }

  // In cover: you stay against the surface, sliding along it with the stick. At an edge,
  // aiming leans you out around it (or pops you up over low cover). Push away or press
  // cover again to leave.
  updateCover(dt, a, camYaw, faceYaw) {
    const cv = this.cover;
    const v = cv.vehicle ? cv.ref : null;
    if (v && (v.removed || Math.abs(v.speed) > 1.5)) {
      this.cover = null;
      return false;
    }
    const f = cv.frame();
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const mx = fx * a.moveY - fz * a.moveX;
    const mz = fz * a.moveY + fx * a.moveX;
    const [nx, nz] = this.toWorld(f, cv.axis === 'x' ? cv.sign : 0, cv.axis === 'z' ? cv.sign : 0);
    const [tx, tz] = this.coverTangent();
    // Pushing away from the wall for a moment steps out of cover.
    const away = mx * nx + mz * nz;
    cv.pushAway = away > 0.6 ? cv.pushAway + dt : 0;
    if (cv.pushAway > 0.25 || a.sprint && Math.hypot(a.moveX, a.moveY) > 0.3 && away > 0.2) {
      this.cover = null;
      return false;
    }
    // Where you are along the face, in the cover's own frame.
    const ex = this.x - f.ox, ez = this.z - f.oz;
    let along = cv.axis === 'x' ? ex * f.s + ez * f.c : ex * f.c - ez * f.s;
    const half = cv.axis === 'x' ? f.hz : f.hx;
    const depth = (cv.axis === 'x' ? f.hx : f.hz) + 0.45;
    const slide = mx * tx + mz * tz;
    const combat = faceYaw !== null;
    const speed = Math.abs(slide) > 0.25 && !combat ? 2.2 * Math.sign(slide) * Math.min(1, Math.abs(slide)) : 0;
    if (speed) cv.side = Math.sign(speed);
    const lim = Math.max(0, half - 0.3);
    along = clamp(along + speed * dt, -lim, lim);
    const atEdge = Math.abs(along) >= lim - 0.05 ? Math.sign(along) || cv.side : 0;
    cv.atEdge = atEdge;
    // Lean out past the corner while aiming at an edge of a wall.
    const leanTo = combat && atEdge && !cv.low ? 1 : 0;
    cv.lean = lerp(cv.lean, leanTo, Math.min(1, dt * 10));
    const alongOut = along + atEdge * cv.lean * 0.75;
    const out = depth + cv.lean * 0.15;
    const lx = cv.axis === 'x' ? cv.sign * out : alongOut;
    const lz = cv.axis === 'x' ? alongOut : cv.sign * out;
    const [wx, wz] = this.toWorld(f, lx, lz);
    const gx = f.ox + wx, gz = f.oz + wz;
    // Slide in to the wall quickly when first taking cover.
    cv.snap = Math.min(1, cv.snap + dt * 6);
    const k = cv.snap >= 1 ? 1 : Math.min(1, dt * 14);
    const ox = this.x, oz = this.z;
    this.x = lerp(this.x, gx, k);
    this.z = lerp(this.z, gz, k);
    const r = pushCircle(this.x, this.z, 0.38, this.boxes());
    if (Math.hypot(r.x - this.x, r.z - this.z) > 0.6) {
      this.cover = null;
      return false;
    }
    this.x = r.x;
    this.z = r.z;
    this.vx = (this.x - ox) / Math.max(dt, 1e-4);
    this.vz = (this.z - oz) / Math.max(dt, 1e-4);
    this.speed = Math.abs(speed);
    // Gun hand: whichever side you'd peek out on, as seen from the camera. Peeking around a
    // corner to your left puts the gun in your left hand (and the camera over that shoulder).
    const peek = cv.atEdge || cv.side;
    const crx = -Math.cos(camYaw), crz = Math.sin(camYaw);
    const sideDot = (tx * crx + tz * crz) * peek;
    if (sideDot > 0.2) this.setHand('R');
    else if (sideDot < -0.2) this.setHand('L');
    // Facing: along the wall (shoulder to it), or at the target when aiming.
    const alongYaw = Math.atan2(tx * cv.side, tz * cv.side);
    this.heading = lerpAngle(this.heading, combat ? faceYaw : alongYaw, Math.min(1, dt * (combat ? 20 : 10)));
    // Pose: knees bent against a wall; squatting behind low cover (popping up to aim).
    this.phase += dt * this.speed * 3;
    animateWalk(this.char, this.phase, 0);
    const shuffle = Math.sin(this.phase) * Math.min(1, this.speed);
    const low = cv.low && !(combat && this.game.aimingNow);
    this.poseY = crouchPose(this.char, low ? 1 : 0.3 * (1 - cv.lean), shuffle);
    // Hands up near the chest, ready.
    this.char.armL.rotation.x = -0.5;
    this.char.armR.rotation.x = -0.6;
    return true;
  }

  pos() {
    return this.vehicle ? [this.vehicle.x, this.vehicle.z] : [this.x, this.z];
  }

  velocity() {
    if (this.vehicle) {
      const [fx, fz] = this.vehicle.forward();
      return [fx * this.vehicle.speed, fz * this.vehicle.speed];
    }
    return [this.vx, this.vz];
  }

  // World position of the end of the barrel of the gun in the player's hand.
  muzzle(id) {
    const g = (this.gunHand === 'L' ? this.gunsL : this.guns)[id];
    if (!g) return null;
    this.char.group.updateMatrixWorld(true);
    const len = g.geometry.parameters.depth;
    return g.localToWorld(new THREE.Vector3(0, 0, len / 2 + 0.02));
  }

  showWeapon(id) {
    this.weaponId = id;
    const left = this.gunHand === 'L';
    for (const [k, g] of Object.entries(this.guns)) g.visible = k === id && !left;
    for (const [k, g] of Object.entries(this.gunsL)) g.visible = k === id && left;
  }

  setHand(hand) {
    if (hand === this.gunHand) return;
    this.gunHand = hand;
    this.showWeapon(this.weaponId);
  }

  // a: actions from Input. faceYaw: set when aiming or shooting, so the player faces the crosshair.
  updateOnFoot(dt, a, camYaw, faceYaw) {
    const game = this.game;
    this.poseY = 0;
    if (this.cover && this.updateCover(dt, a, camYaw, faceYaw)) {
      this.armPose(dt, faceYaw);
      this.sync();
      return;
    }
    this.setHand('R');
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -fz, rz = fx;
    let mx = fx * a.moveY + rx * a.moveX;
    let mz = fz * a.moveY + rz * a.moveX;
    const len = Math.hypot(mx, mz);
    const combat = faceYaw !== null;
    let target = 0;
    if (len > 0.05) {
      mx /= len;
      mz /= len;
      this.moveX = mx;
      this.moveZ = mz;
      const base = this.lowProfile ? 2.3 : combat ? CFG.WALK_SPEED * 0.8 : a.sprint ? CFG.SPRINT_SPEED : CFG.WALK_SPEED;
      target = base * Math.min(1, len);
    }
    if (combat) this.heading = lerpAngle(this.heading, faceYaw, Math.min(1, dt * 20));
    else if (len > 0.05) this.heading = lerpAngle(this.heading, Math.atan2(mx, mz), Math.min(1, dt * 12));
    this.speed = lerp(this.speed, target, Math.min(1, dt * 10));
    const ox = this.x, oz = this.z;
    this.x += this.moveX * this.speed * dt;
    this.z += this.moveZ * this.speed * dt;

    const r = pushCircle(this.x, this.z, 0.4, this.boxes());
    this.x = r.x;
    this.z = r.z;
    // Don't walk through cars.
    for (const v of game.vehicles) {
      if (Math.abs(v.x - this.x) > 5 || Math.abs(v.z - this.z) > 5) continue;
      for (const [cx, cz] of v.circles()) {
        const dx = this.x - cx, dz = this.z - cz;
        const d = Math.hypot(dx, dz);
        const min = v.radius + 0.4;
        if (d < min && d > 1e-6) {
          this.x = cx + (dx / d) * min;
          this.z = cz + (dz / d) * min;
        }
      }
    }
    this.vx = (this.x - ox) / Math.max(dt, 1e-4);
    this.vz = (this.z - oz) / Math.max(dt, 1e-4);

    this.phase += dt * this.speed * 2.6;
    animateWalk(this.char, this.phase, Math.min(1, this.speed / 2));
    if (this.lowProfile) {
      // Crouched: bent at the knees, shuffling.
      const s = Math.sin(this.phase) * Math.min(1, this.speed / 1.5);
      this.poseY = crouchPose(this.char, 1, s);
    }
    this.armPose(dt, faceYaw);
    this.sync();
  }

  armPose(dt, faceYaw) {
    const game = this.game;
    const combat = faceYaw !== null;
    if (this.punchT > 0) {
      this.punchT -= dt;
      // (a jab: the elbow cocked, then the arm snaps out straight)
      const k = Math.sin((this.punchT / 0.3) * Math.PI);
      this.char.armR.rotation.x = -1.6 * k;
      this.char.elbowR.rotation.x = -1.5 * (1 - k);
    } else if (combat && game.arsenal.current().id !== 'fists') {
      // Gun arm straight out, the other hand supporting.
      const left = this.gunHand === 'L';
      this.char.armR.rotation.x = left ? -1.2 : -1.5;
      this.char.armL.rotation.x = left ? -1.5 : -1.2;
      // (the gun arm locked straight down the sights, the support arm bent in to it)
      straightArms(this.char);
      (left ? this.char.elbowR : this.char.elbowL).rotation.x = -0.45;
    }
  }

  setDown(down) {
    setDown(this.char, down);
    this.sync();
  }

  // Up on the highway (walking on it, after getting out of a car there): its rails and height.
  boxes() {
    const hw = this.game.highway;
    return this.high && hw ? hw.boxesFor(this.gy()) : this.game.city.colliders;
  }

  gy() {
    const hw = this.game.highway;
    if (!(this.high && hw)) return this.game.city.groundY(this.x, this.z);
    this.hy = hw.heightAt(this.x, this.z, this.hy ?? 8) ?? 0;
    return this.hy;
  }

  sync() {
    const y = this.gy();
    const down = this.char.group.rotation.x !== 0;
    this.char.group.position.set(this.x, down ? y + 0.2 : y + (this.vehicle ? 0 : this.poseY), this.z);
    this.char.group.rotation.y = this.heading;
  }

  enter(vehicle) {
    this.vehicle = vehicle;
    vehicle.driver = 'player';
    vehicle.playerUsed = true;
    this.crouched = false;
    this.lowProfile = false;
    this.cover = null;
    this.poseY = 0;
    vehicle.openDoor(-1, 0.9);
    this.char.group.visible = false;
    this.game.crew?.playerEntered(vehicle);
  }

  // Bail out of a moving car (over 30 mph): dive out the driver's door, hit the ground with
  // the car's speed, and tumble until friction stops you. The car rolls on without you.
  bail() {
    const v = this.vehicle;
    if (!v) return;
    const game = this.game;
    const [fx, fz] = v.forward();
    const rx = -fz, rz = fx; // the car's right
    const lat = v.lat || 0;
    // Your velocity is the car's (forward + any sideways slide), plus a push out the door.
    const vx = fx * v.speed + rx * lat;
    const vz = fz * v.speed + rz * lat;
    const mph = Math.hypot(vx, vz) * 2.237;
    this.x = v.x - rx * 1.7;
    this.z = v.z - rz * 1.7;
    this.high = !!v.high;
    this.hy = v.y;
    const r = pushCircle(this.x, this.z, 0.4, this.boxes());
    this.x = r.x;
    this.z = r.z;
    v.driver = null;
    v.runaway = true;
    v.openDoor(-1, 1.6);
    this.vehicle = null;
    this.char.group.visible = true;
    this.cover = null;
    this.crouched = false;
    this.lowProfile = false;
    // Hitting the ground knocks off some speed (and hurts).
    const keep = 0.72;
    this.rollVx = vx * keep - rx * 2.5;
    this.rollVz = vz * keep - rz * 2.5;
    // A short dive through the air first: out the door head-first, face down, arms out.
    this.diving = true;
    this.diveY = 0.8; // about seat height
    this.diveVy = 0.4; // a small hop out the door: ~0.35 s in the air
    this.rolling = true;
    this.rollAngle = Math.PI / 2; // face down
    this.getUpT = 0;
    this.speed = 0;
    this.bailDmg = Math.min(70, 6 + Math.max(0, mph - 30) * 0.9);
    game.crew?.playerBailed?.(v);
  }

  // Tumbling along the ground after bailing out, then getting back up.
  updateRolling(dt) {
    const game = this.game;
    const c = this.char;
    if (this.diving) {
      // In the air: carried by the car's speed, falling to the road.
      this.x += this.rollVx * dt;
      this.z += this.rollVz * dt;
      this.diveVy -= 9.8 * dt;
      this.diveY += this.diveVy * dt;
      const r = pushCircle(this.x, this.z, 0.4, this.boxes());
      this.x = r.x;
      this.z = r.z;
      this.rollHeading = Math.atan2(this.rollVx, this.rollVz) || this.heading;
      this.pose(this.rollHeading, -Math.PI / 2, Math.PI / 2, this.diveY, true);
      if (this.diveY <= 0.28) {
        // Landing: the impact hurts, then the tumble.
        this.diving = false;
        game.hurtPlayer(this.bailDmg || 10);
      }
      return;
    }
    if (this.rolling) {
      let sp = Math.hypot(this.rollVx, this.rollVz);
      // Tumbling and sliding on asphalt slows a body at roughly 0.95 g.
      const nsp = Math.max(0, sp - 9.3 * dt);
      if (sp > 0) {
        this.rollVx *= nsp / sp;
        this.rollVz *= nsp / sp;
      }
      sp = nsp;
      this.x += this.rollVx * dt;
      this.z += this.rollVz * dt;
      // Walls: thump into them, bounce off a little, and get hurt if it's hard.
      const r = pushCircle(this.x, this.z, 0.4, this.boxes());
      if (r.hit) {
        const vn = this.rollVx * r.nx + this.rollVz * r.nz;
        if (vn < 0) {
          if (-vn > 3) game.hurtPlayer((-vn - 3) * 4);
          this.rollVx -= 1.25 * vn * r.nx;
          this.rollVz -= 1.25 * vn * r.nz;
        }
        this.x = r.x;
        this.z = r.z;
      }
      // Log-roll: body sideways across the direction of travel, spinning about its length.
      // Part rolling, part sliding: about one full roll every 3.5 m. As it slows, the roll
      // carries on just far enough to finish face down.
      const TWO_PI = Math.PI * 2;
      const toFaceDown = (((Math.PI / 2 - this.rollAngle) % TWO_PI) + TWO_PI) % TWO_PI;
      let spin = (sp / 0.55) * dt;
      if (sp < 2.5) spin = Math.min(toFaceDown, Math.max(spin, 2.5 * dt));
      this.rollAngle += spin;
      this.rollHeading = Math.atan2(this.rollVx, this.rollVz) || this.rollHeading || this.heading;
      this.pose(this.rollHeading, -Math.PI / 2, this.rollAngle, 0.28);
      this.vx = this.rollVx;
      this.vz = this.rollVz;
      const settled = (((Math.PI / 2 - this.rollAngle) % TWO_PI) + TWO_PI) % TWO_PI < 0.03;
      if (sp < 0.5 && (settled || sp < 0.05)) {
        this.rolling = false;
        this.getUpT = GETUP;
        this.rollVx = this.rollVz = 0;
        // Face down with the head toward where you dove (left of the car's travel). Switch to
        // standing-frame coordinates: feet behind the body's middle.
        this.upHeading = (this.rollHeading || this.heading) + Math.PI / 2;
        const r = pushCircle(this.x - Math.sin(this.upHeading) * 0.95, this.z - Math.cos(this.upHeading) * 0.95, 0.4, this.boxes());
        this.x = r.x;
        this.z = r.z;
      }
      return;
    }
    // Getting up: push up off the ground, pivoting on the feet, knees bending through the
    // middle of the move, until standing.
    this.getUpT -= dt;
    const e = Math.max(0, this.getUpT / GETUP); // 1 lying -> 0 standing
    const lean = (Math.PI / 2) * e * e * (3 - 2 * e);
    const bend = Math.sin(Math.PI * (1 - e)) * 0.55;
    const drop = crouchPose(c, bend);
    c.armL.rotation.x = c.armR.rotation.x = -0.4 - 1.1 * e; // hands planted, then down
    c.group.rotation.set(lean, this.upHeading, 0, 'YXZ');
    const gy = this.gy();
    c.group.position.set(this.x, gy + 0.12 * Math.sin(lean) + drop * Math.cos(lean), this.z);
    if (this.getUpT <= 0) {
      this.getUpT = 0;
      this.heading = this.upHeading;
      c.group.rotation.set(0, this.heading, 0, 'YXZ');
      animateWalk(c, 0, 0);
      this.vx = this.vz = 0;
      this.sync();
    }
  }

  // Place the body by its middle (not its feet) for tumbling poses. side = -90 degrees lays
  // the body across the direction of travel with the head to the left (out the driver's
  // door); spin rolls it about its length.
  pose(yaw, side, spin, radius, diving = false) {
    const g = this.char.group;
    _e.set(spin, yaw, side, 'YXZ');
    g.rotation.copy(_e);
    animateWalk(this.char, 0, 0);
    // Arms stretched out past the head in the dive; tucked in while rolling.
    this.char.armL.rotation.x = this.char.armR.rotation.x = diving ? -2.9 : -0.4;
    _c.set(0, 0.95, 0).applyEuler(_e);
    const center = this.gy() + Math.max(radius, 0.95 * Math.cos(side));
    g.position.set(this.x - _c.x, center - _c.y, this.z - _c.z);
  }

  // Cancel any tumble (e.g. after respawning).
  stopRolling() {
    this.rolling = false;
    this.diving = false;
    this.getUpT = 0;
    this.exitStop = false;
    this.char.group.rotation.set(0, this.heading, 0);
  }

  get busy() {
    return this.rolling || this.getUpT > 0;
  }

  exit() {
    const v = this.vehicle;
    if (!v) return;
    const [fx, fz] = v.forward();
    // Get out on the driver's (left) side.
    this.x = v.x + fz * 1.9;
    this.z = v.z - fx * 1.9;
    this.heading = v.heading;
    this.high = !!v.high;
    this.hy = v.y;
    v.driver = null;
    v.openDoor(-1, 0.9);
    this.vehicle = null;
    this.speed = 0;
    this.char.group.visible = true;
    const r = pushCircle(this.x, this.z, 0.4, this.boxes());
    this.x = r.x;
    this.z = r.z;
    this.sync();
    this.game.crew?.playerExited();
  }
}
