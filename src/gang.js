import { GANG_NAME, CREW_NAME } from './config.js';
import { aimPose, lowReady, flinchPose, fallFace, markFlinch, kneelPose } from './combatpose.js';
import * as THREE from 'three';
import { makeCharacter, setDown, crouchPose, SKIN_TONES, lam, straightArms } from './character.js';
import { pushCircle, segmentBlocked } from './collision.js';
import { dist, pick, rand, lerpAngle, clamp } from './util.js';
import { navStep, escapePoint } from './nav.js';

// "Heart" decides how a gang member fights:
//   low heart  -> runs when the shooting starts
//   mid heart  -> finds cover, crouches, pops up to shoot
//   high heart -> reckless: charges and shoots out in the open
export function heartLabel(heart) {
  if (heart < 0.25) return 'Scary';
  if (heart < 0.7) return 'Solid';
  return 'Reckless';
}

function behaviorFor(heart) {
  if (heart < 0.25) return 'flee';
  if (heart < 0.7) return 'cover';
  return 'rush';
}

// Find a spot near `self` that hides it from `threat`: building corners (with a peek spot
// to shoot from) or low cover like crates and parked cars (crouch to hide, stand to shoot).
export function findCover(game, self, threat) {
  let best = null;
  let bestScore = Infinity;
  const { city } = game;
  const consider = (spot) => {
    const travel = dist(self.x, self.z, spot.x, spot.z);
    if (travel > 24) return;
    const td = dist(spot.x, spot.z, threat.x, threat.z);
    if (td < 7) return;
    // Spot must be clear ground with room to stand.
    const r = pushCircle(spot.x, spot.z, 0.65, city.colliders);
    if (Math.hypot(r.x - spot.x, r.z - spot.z) > 0.05) return;
    // Skip spots this fighter recently failed to reach.
    if (self.badCover && self.badCover.some((b) => b.until > game.time && dist(b.x, b.z, spot.x, spot.z) < 1.5)) return;
    const score = travel + Math.abs(td - 16) * 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = spot;
    }
  };

  for (const b of city.los) {
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    if (dist(cx, cz, self.x, self.z) > 45) continue;
    // The box's own axes (rotated buildings too).
    const ux = b.ob ? b.ob.c : 1;
    const uz = b.ob ? b.ob.s : 0;
    const vx = -uz;
    const vz = ux;
    const hx = b.ob ? b.ob.hx : (b.maxX - b.minX) / 2;
    const hz = b.ob ? b.ob.hz : (b.maxZ - b.minZ) / 2;
    const ox = b.ob ? b.ob.cx : cx;
    const oz = b.ob ? b.ob.cz : cz;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      // Just off the corner, diagonally out.
      const ex = sx * (hx + 0.9);
      const ez = sz * (hz + 0.9);
      const x = ox + ux * ex + vx * ez;
      const z = oz + uz * ex + vz * ez;
      // Hidden: the line from the threat passes through this building.
      if (!segmentBlocked(threat.x, threat.z, x - (ux * sx + vx * sz) * 0.6, z - (uz * sx + vz * sz) * 0.6, [b])) continue;
      // Peek: step out along one wall until the threat is visible.
      for (const [px, pz] of [[x + ux * sx * 1.8, z + uz * sx * 1.8], [x + vx * sz * 1.8, z + vz * sz * 1.8]]) {
        if (!segmentBlocked(threat.x, threat.z, px, pz, city.los)) {
          consider({ x, z, peekX: px, peekZ: pz, low: false });
          break;
        }
      }
    }
  }
  const low = (ax, az, gap) => {
    const d = dist(ax, az, threat.x, threat.z) || 1;
    const ux = (ax - threat.x) / d;
    const uz = (az - threat.z) / d;
    const x = ax + ux * gap;
    const z = az + uz * gap;
    // Pop up by leaning out to one side of the crate or car.
    const side = Math.random() < 0.5 ? 1 : -1;
    consider({ x, z, peekX: x - uz * side * 1.1, peekZ: z + ux * side * 1.1, low: true, ax, az });
  };
  for (const c of city.crates) low(c.x, c.z, 1.25);
  for (const v of game.vehicles) {
    if (v.removed || v.exploded || v.wrecked || v.driver !== null || Math.abs(v.speed) > 0.5) continue;
    low(v.x, v.z, 2.3);
  }
  return best;
}

// What gang members carry. Pistols are common; shotguns hit hard up close; rifles reach far.
export const GANG_GUNS = {
  pistol: { id: 'pistol', dmg: 7, range: 42, rate: 1.35, acc: 1.0, size: [0.08, 0.14, 0.32], color: 0x1a1a1a, ammo: 12 },
  smg: { id: 'smg', dmg: 6, range: 45, rate: 0.8, acc: 0.9, size: [0.1, 0.18, 0.6], color: 0x2a2a2a, ammo: 30 },
  shotgun: { id: 'shotgun', dmg: 16, range: 20, rate: 2.2, acc: 1.25, size: [0.11, 0.15, 0.9], color: 0x4a3420, ammo: 6 },
  rifle: { id: 'rifle', dmg: 9, range: 65, rate: 1.0, acc: 1.15, size: [0.1, 0.2, 0.95], color: 0x2b2f26, ammo: 30 },
};
function pickGun() {
  const r = Math.random();
  return r < 0.35 ? GANG_GUNS.pistol : r < 0.65 ? GANG_GUNS.smg : r < 0.85 ? GANG_GUNS.shotgun : GANG_GUNS.rifle;
}

// Shared body and combat behavior for rival gang members and your crew.
export class GangFighter {
  constructor(game, x, z, look) {
    this.game = game;
    this.char = makeCharacter(look);
    game.scene.add(this.char.group);
    this.x = x;
    this.z = z;
    this.homeX = x;
    this.homeZ = z;
    this.heading = rand(-Math.PI, Math.PI);
    this.state = 'idle';
    this.health = 100;
    this.baseHeart = Math.random();
    this.heart = this.baseHeart;
    this.behavior = null;
    this.crouched = false;
    this.cover = null;
    this.coverT = 0;
    this.peeking = false;
    this.peekShots = 0;
    this.fireT = rand(0.4, 1);
    this.fleeT = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.recheckT = 0;
    this.t = 0;
    this.phase = Math.random() * 6;
    this.removed = false;
    this.speedNow = 0;
    // Their gun, in the right hand.
    this.setWeapon(pickGun());
  }

  get standing() {
    return this.state !== 'down' && this.state !== 'dead' && this.state !== 'inCar';
  }

  get alive() {
    return this.state !== 'dead';
  }

  get heartLabel() {
    return heartLabel(this.baseHeart);
  }

  get mode() {
    if (!this.alive) return 'down';
    if (this.state === 'fight') {
      return { flee: 'running', cover: this.cover ? 'in cover' : 'finding cover', rush: 'charging', hide: 'hiding', leave: 'leaving' }[this.behavior];
    }
    return this.state;
  }

  // Swap the gun they carry (and the one in their hand).
  setWeapon(g) {
    this.weapon = g;
    if (this.gunMesh) this.gunMesh.parent?.remove(this.gunMesh);
    const [w, h, l] = g.size;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), lam(g.color));
    gun.position.set(0, -0.04, 0);
    gun.rotation.x = Math.PI / 2;
    this.char.wristR.add(gun);
    this.gunMesh = gun;
  }

  takeHit(dmg, fromX, fromZ) {
    if (!this.alive || this.state === 'inCar') return false;
    this.health -= dmg * (this.dmgK || 1); // crew vests
    this.onHurt();
    if (this.health <= 0) {
      this.health = 0;
      this.state = 'dead';
      this.t = 45;
      this.crouched = false;
      setDown(this.char, true, fallFace(this.x, this.z, this.heading, fromX, fromZ));
      this.place();
      this.onDeath();
      return true;
    }
    markFlinch(this.char, this.game.time, 'shot'); // (hit, still up: the jolt)
    // Getting shot rattles you (less so if you're fearless).
    this.shaken(0.05);
    return false;
  }

  knockDown() {
    if (!this.standing) return;
    this.state = 'down';
    this.t = 3;
    this.crouched = false;
    setDown(this.char, true);
    this.onHurt();
  }

  // Lower nerve; may flip into running away.
  shaken(amount) {
    this.heart = clamp(this.heart - amount * (1 - this.baseHeart * 0.75), 0, 1);
    if (this.behavior && this.behavior !== 'flee' && this.heart < 0.25) {
      this.behavior = 'flee';
      this.cover = null;
      this.fleeGoal = null;
      this.fleeT = rand(7, 11);
    }
  }

  // Heard shots (main.js gunshot): on alert for a while - gun up, looking that way, the
  // jumpy ones crouched.
  hear(x, z, secs = 12) {
    if (!this.standing) return;
    const fresh = !(this.alertUntil > this.game.time);
    this.alertUntil = this.game.time + secs;
    this.alertAt = [x, z];
    if (fresh) this.alertCrouch = this.heart < 0.5 && Math.random() < 0.7;
  }

  // On alert and not fighting: stand (or crouch) your ground facing the sound. Returns true
  // if that's what this frame was.
  alertIdle(dt) {
    if (!(this.alertUntil > this.game.time) || !this.alertAt) {
      if (this.alertCrouch) this.crouched = this.alertCrouch = false; // (stand back up)
      return false;
    }
    const [ax, az] = this.alertAt;
    this.move(dt, this.x, this.z, 0, Math.atan2(ax - this.x, az - this.z));
    this.char.armR.rotation.x = -1.4;
    straightArms(this.char, 'R');
    this.crouched = !!this.alertCrouch;
    return true;
  }

  onHurt() {}
  onDeath() {}
  giveUp() {
    this.behavior = 'leave';
  }

  // Police in the fight make everyone more likely to run.
  startFight(copFight = false) {
    if (this.state !== 'fight') {
      this.state = 'fight';
      this.copShaken = copFight;
      this.behavior = behaviorFor(this.heart - (copFight ? 0.3 : 0));
      this.cover = null;
      this.fleeGoal = null;
      this.fleeT = rand(7, 11);
    } else if (copFight && !this.copShaken) {
      // Cops showed up in the middle of the fight.
      this.copShaken = true;
      this.shaken(0.3);
    }
  }

  endFight() {
    this.copShaken = false;
    this.state = 'idle';
    this.behavior = null;
    this.cover = null;
    this.crouched = false;
  }

  // One frame of fighting `target` ({x, z, ref}).
  fight(dt, target, acc = 1) {
    const game = this.game;
    const tx = target.x;
    const tz = target.z;
    const d = dist(this.x, this.z, tx, tz);
    const los = !segmentBlocked(this.x, this.z, tx, tz, game.city.los);
    let goX = this.x;
    let goZ = this.z;
    let speed = 0;
    let face = Math.atan2(tx - this.x, tz - this.z);
    let canShoot = false;
    let rate = [0.4, 0.9];
    this.crouched = false;

    if (this.behavior === 'flee') {
      // Run to street corners away from the danger, not straight into walls.
      if (!this.fleeGoal || dist(this.x, this.z, this.fleeGoal[0], this.fleeGoal[1]) < 2.5 || this.navFails >= 2) {
        this.navFails = 0;
        this.fleeGoal = escapePoint(game, this, tx, tz);
      }
      this.fleeT -= dt;
      const safe = d > 45 || !los;
      // Nerve comes back once out of danger.
      if (safe) this.heart = Math.min(this.baseHeart + 0.12, this.heart + dt * 0.06);
      [goX, goZ] = this.fleeGoal;
      speed = 6.4;
      face = null;
      if (this.fleeT <= 0 && safe) {
        if (this.heart >= 0.3) {
          // Got their nerve back: return to the fight, carefully.
          this.behavior = 'cover';
          this.cover = null;
          this.recheckT = 0;
          this.fleeGoal = null;
        } else {
          // Too scared to come back.
          this.giveUp();
        }
      } else if (los && d < 25 && Math.random() < dt * 0.4) {
        // A wild shot over the shoulder.
        canShoot = true;
        acc *= 0.4;
        rate = [0, 0];
      }
    } else if (this.behavior === 'leave') {
      // Clearing out of the area at a jog.
      if (!this.leaveGoal || dist(this.x, this.z, this.leaveGoal[0], this.leaveGoal[1]) < 2.5 || this.navFails >= 2) {
        this.navFails = 0;
        this.leaveGoal = escapePoint(game, this, tx, tz);
      }
      [goX, goZ] = this.leaveGoal;
      speed = 3.6;
      face = null;
    } else if (this.behavior === 'hide') {
      // Too scared to fight: get behind something solid and stay down.
      if (d < 18 && los) {
        this.behavior = 'flee';
        this.fleeT = rand(4, 6);
        this.fleeGoal = null;
      } else {
        this.heart = Math.min(this.baseHeart + 0.12, this.heart + dt * 0.03);
        this.recheckT -= dt;
        if (this.recheckT <= 0) {
          this.recheckT = 1.5;
          if (!this.cover || !this.coverHolds(target)) this.cover = findCover(game, this, target);
        }
        if (this.cover) {
          goX = this.cover.x;
          goZ = this.cover.z;
          const there = dist(this.x, this.z, goX, goZ) < 0.8;
          speed = there ? 0 : 5;
          this.crouched = there;
          face = there ? Math.atan2(tx - this.x, tz - this.z) : null;
        } else {
          // Nothing to hide behind: keep moving away.
          if (!this.fleeGoal || dist(this.x, this.z, this.fleeGoal[0], this.fleeGoal[1]) < 2.5 || this.navFails >= 2) {
            this.navFails = 0;
            this.fleeGoal = escapePoint(game, this, tx, tz);
          }
          [goX, goZ] = this.fleeGoal;
          speed = 3;
          face = null;
        }
        // Nerve back: rejoin the fight.
        if (this.heart >= 0.35) {
          this.behavior = 'cover';
          this.cover = null;
          this.recheckT = 0;
        }
      }
    } else if (this.behavior === 'cover') {
      this.recheckT -= dt;
      if (this.cover && this.recheckT <= 0) {
        this.recheckT = 1;
        // Move up if the enemy is far away, or find new cover if this spot no longer hides you.
        if (!this.coverHolds(target) || (d > 32 && !this.peeking)) this.cover = null;
      }
      if (!this.cover && this.recheckT <= 0) {
        this.cover = findCover(game, this, target);
        this.coverTravelT = 0;
        this.recheckT = 1;
        this.coverT = rand(0.8, 1.6);
        this.peeking = false;
      }
      if (!this.cover) {
        // No cover around: hold at range, sidestepping, and trade shots.
        if (!los || d > 22) {
          goX = tx;
          goZ = tz;
          speed = 5.2;
        } else {
          if (Math.random() < dt * 0.5) this.strafe *= -1;
          goX = this.x - ((tz - this.z) / (d || 1)) * this.strafe * 3;
          goZ = this.z + ((tx - this.x) / (d || 1)) * this.strafe * 3;
          speed = 1.4;
        }
        canShoot = los;
        acc *= 0.85;
      } else {
        const c = this.cover;
        const atCover = dist(this.x, this.z, c.x, c.z) < 1.2 || (this.peeking && dist(this.x, this.z, c.peekX, c.peekZ) < 1.2);
        if (!atCover && !this.peeking) {
          goX = c.x;
          goZ = c.z;
          speed = 5.8;
          face = null;
          // Can't reach it: give up and look for other cover.
          this.coverTravelT = (this.coverTravelT || 0) + dt;
          if (this.coverTravelT > 4 || this.navFails >= 2) {
            this.badCover = (this.badCover || []).filter((b) => b.until > this.game.time);
            this.badCover.push({ x: c.x, z: c.z, until: this.game.time + 20 });
            this.navFails = 0;
            this.cover = null;
            this.recheckT = 0;
          }
        } else {
          this.coverTravelT = 0;
          this.coverT -= dt;
          if (!this.peeking) {
            // Hidden: crouch and wait.
            this.crouched = true;
            goX = c.x;
            goZ = c.z;
            speed = dist(this.x, this.z, c.x, c.z) > 0.5 ? 2 : 0;
            if (this.coverT <= 0) {
              this.peeking = true;
              this.peekShots = 2 + Math.floor(Math.random() * 3);
              this.coverT = 2.5;
            }
          } else {
            // Pop out and shoot a few rounds.
            goX = c.peekX;
            goZ = c.peekZ;
            speed = dist(this.x, this.z, goX, goZ) > 0.5 ? 3 : 0;
            canShoot = los && speed === 0;
            rate = [0.3, 0.5];
            // Popped up but can't see anyone: go find a better spot.
            if (speed === 0 && !los) {
              this.peeking = false;
              this.cover = null;
              this.recheckT = 0;
            }
            if (this.peekShots <= 0 || this.coverT <= 0) {
              this.peeking = false;
              this.coverT = rand(1.2, 2.4);
            }
          }
        }
      }
    } else {
      // Reckless: push forward in the open, sidestepping and spraying.
      if (!los || d > 9) {
        goX = tx;
        goZ = tz;
        speed = 5.4;
      } else {
        const ux = (tx - this.x) / (d || 1);
        const uz = (tz - this.z) / (d || 1);
        if (Math.random() < dt * 0.6) this.strafe *= -1;
        goX = this.x - uz * this.strafe * 3;
        goZ = this.z + ux * this.strafe * 3;
        speed = 2.2;
      }
      canShoot = los;
      acc *= 0.75;
      rate = [0.22, 0.55];
    }

    // Out of range for this gun (a shotgun at 30 m): close in before shooting.
    const W = this.weapon;
    if ((this.behavior === 'cover' || this.behavior === 'rush') && d > W.range * 0.9 && !this.peeking) {
      goX = tx;
      goZ = tz;
      speed = Math.max(speed, 4.8);
      face = null;
      canShoot = false;
    }
    this.move(dt, goX, goZ, speed, face);
    const armed = !(this.behavior === 'flee' && this.fleeT > 0) && this.behavior !== 'leave' && !(this.behavior === 'hide' && !this.crouched);
    this.char.armR.rotation.x = armed ? -1.45 : -0.3;
    if (armed) straightArms(this.char, 'R');

    if (canShoot && d < W.range) {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = rand(rate[0], rate[1]);
        this.peekShots--;
        // Shotguns hit hardest up close.
        const dmg = W.id === 'shotgun' ? W.dmg * Math.max(0.3, 1.4 - d / 18) : W.dmg;
        this.fireT *= W.rate;
        game.npcShootAt(this, target.ref, dmg, W.id, acc * W.acc);
      }
    }
  }

  // Is the current cover still between us and the target?
  coverHolds(target) {
    const c = this.cover;
    if (!c) return false;
    if (dist(c.x, c.z, target.x, target.z) < 6) return false;
    if (c.low) {
      // Target must be on the far side of the crate or car.
      return (c.x - c.ax) * (target.x - c.ax) + (c.z - c.az) * (target.z - c.az) < 0;
    }
    return segmentBlocked(target.x, target.z, c.x, c.z, this.game.city.los);
  }

  move(dt, goX, goZ, speed, face) {
    if (speed > 0) {
      const h = navStep(this, goX, goZ, speed, dt, this.game, 0.4);
      if ((face === null || face === undefined) && h !== null) face = h;
    }
    if (face !== null && face !== undefined) this.heading = lerpAngle(this.heading, face, Math.min(1, dt * 9));
    this.speedNow = speed;
  }

  animate(dt) {
    this.phase += dt * this.speedNow * 3;
    const s = Math.sin(this.phase) * Math.min(1, this.speedNow / 2);
    if (this.crouched) {
      // Squat down behind cover.
      this.crouchY = crouchPose(this.char, 1);
    } else {
      this.char.legL.rotation.x = s * 0.8;
      this.char.legR.rotation.x = -s * 0.8;
      this.char.kneeL.rotation.x = Math.max(0, s) * 1.1;
      this.char.kneeR.rotation.x = Math.max(0, -s) * 1.1;
    }
    this.char.armL.rotation.x = this.state === 'fight' && this.behavior !== 'flee' ? -1.1 : -s * 0.6;
    // (elbows bent with the pace; the gun arm stays straight while it's up)
    const e = 0.2 + 0.9 * Math.min(1, this.speedNow / 2);
    this.char.elbowL.rotation.x = this.state === 'fight' && this.behavior !== 'flee' ? -0.5 : -e;
    this.char.elbowR.rotation.x = this.char.armR.rotation.x < -1 ? 0 : -e;
    // (combatpose.js, the same as yours: the gun up and in two hands while it's up, a long gun
    // carried low across the body in a fight otherwise; knocked back a step when hit)
    const now = this.game.time;
    const wid = this.weapon?.id || 'pistol';
    if (this.char.armR.rotation.x < -1) {
      aimPose(this.char, wid, 0, now);
      if (this.crouched) this.crouchY = kneelPose(this.char); // (crouched and shooting: on one knee, the same as you)
    }
    else if (this.state === 'fight' && this.behavior !== 'flee') lowReady(this.char, wid);
    flinchPose(this.char, now);
  }

  place() {
    const y = this.game.city.groundY(this.x, this.z);
    this.char.group.position.set(this.x, !this.standing ? y + 0.2 : this.crouched ? y + (this.crouchY || -0.45) : y, this.z);
    this.char.group.rotation.y = this.heading;
  }

  // Frame update for the down / dead states. Returns true if handled.
  updateDown(dt) {
    if (this.state === 'dead') {
      this.t -= dt;
      this.place();
      return true;
    }
    if (this.state === 'down') {
      this.t -= dt;
      if (this.t <= 0) {
        setDown(this.char, false);
        this.state = 'idle';
      }
      this.place();
      return true;
    }
    return false;
  }

  dispose() {
    this.game.scene.remove(this.char.group);
    this.removed = true;
  }
}

// Members of the rival gang.
export class RivalMember extends GangFighter {
  constructor(game, x, z) {
    super(game, x, z, { shirt: 0x6a1b9a, pants: 0x1b1b1b, skin: pick(SKIN_TONES), bandana: 0x8e24aa });
    this.isGang = true;
    this.char.armR.rotation.x = -0.3;
  }

  onHurt() {
    this.game.gang.anger();
  }

  giveUp() {
    this.behavior = 'leave';
    this.leaveGoal = null;
  }

  onDeath() {
    this.game.gang.allyDown(this);
  }

  update(dt) {
    if (this.updateDown(dt)) return;
    const game = this.game;
    const foes = game.playerFaction();
    const [px, pz] = game.player.pos();
    const dPlayer = dist(this.x, this.z, px, pz);

    // Walking onto their corner on foot (you or your crew) starts a fight.
    if (!game.gang.angry && game.wastedT <= 0) {
      for (const f of foes) {
        if (!(f.ref === 'player' && game.player.vehicle) && dist(this.x, this.z, f.x, f.z) < 9) game.gang.anger();
      }
    }

    const leaving = this.state === 'fight' && this.behavior === 'leave';
    if (leaving || (game.gang.angry && dPlayer < 80 && game.wastedT <= 0)) {
      this.startFight(game.copsNear(this.x, this.z));
      // Someone leaving keeps heading away from you, however far they get.
      const target = leaving ? { x: px, z: pz, ref: 'player' } : game.pickTarget(this, foes, 60);
      if (target) this.fight(dt, target);
      else this.move(dt, px, pz, 4, null);
    } else {
      if (this.state === 'fight') this.endFight();
      this.heart = Math.min(this.baseHeart, this.heart + dt * 0.02);
      this.char.armR.rotation.x = -0.3;
      if (this.alertIdle(dt)) {
        // (heard shots: on guard)
      } else if (dist(this.x, this.z, this.homeX, this.homeZ) > 1) this.move(dt, this.homeX, this.homeZ, 1.6, null);
      else this.move(dt, this.x, this.z, 0, dPlayer < 25 ? Math.atan2(px - this.x, pz - this.z) : null);
    }
    this.animate(dt);
    this.place();
  }
}

// A homie in your crew: follows you, rides in your car, and fights your enemies.
export class CrewMember extends GangFighter {
  constructor(game, x, z, name) {
    super(game, x, z, { shirt: 0x1e7d32, pants: 0x263238, skin: pick(SKIN_TONES), bandana: 0x2e7d32 });
    this.name = name;
    this.isCrew = true;
    this.recruited = false;
    this.slot = 0;
    this.vehicle = null;
  }

  onDeath() {
    const game = this.game;
    game.crew.memberDown(this);
    for (const r of game.gang.members) if (r.alive && dist(r.x, r.z, this.x, this.z) < 25) r.heart = Math.min(1, r.heart + 0.05);
  }

  giveUp() {
    this.behavior = 'hide';
    this.cover = null;
    this.recheckT = 0;
  }

  hideInCar(v) {
    v.openDoor(1, 0.9);
    this.state = 'inCar';
    this.vehicle = v;
    this.char.group.visible = false;
    this.crouched = false;
  }

  leaveCar(i) {
    const v = this.vehicle;
    if (!v) return;
    const [fx, fz] = v.forward();
    const side = i % 2 === 0 ? -1 : 1;
    this.x = v.x - fz * side * 1.9 - fx * (i > 1 ? 1.5 : 0);
    this.z = v.z + fx * side * 1.9 - fz * (i > 1 ? 1.5 : 0);
    const r = pushCircle(this.x, this.z, 0.4, this.game.city.colliders);
    this.x = r.x;
    this.z = r.z;
    v.openDoor(1, 0.9);
    this.vehicle = null;
    this.state = 'follow';
    this.char.group.visible = true;
  }

  update(dt) {
    if (this.state === 'inCar') return;
    if (this.updateDown(dt)) return;
    const game = this.game;
    if (!this.recruited) {
      // Hanging out at the crew spot.
      this.char.armR.rotation.x = -0.3;
      const [px, pz] = game.player.pos();
      this.move(dt, this.homeX, this.homeZ, dist(this.x, this.z, this.homeX, this.homeZ) > 0.6 ? 1.6 : 0,
        dist(this.x, this.z, px, pz) < 12 ? Math.atan2(px - this.x, pz - this.z) : null);
      this.animate(dt);
      this.place();
      return;
    }

    const p = game.player;
    const [px, pz] = p.pos();
    const enemies = game.crewEnemies();
    const target = enemies.length ? game.pickTarget(this, enemies, 50) : null;
    const pv = p.vehicle;

    if (pv && this.state === 'boarding') {
      // Run to the car and hop in.
      if (dist(this.x, this.z, pv.x, pv.z) < 2.8) this.hideInCar(pv);
      else this.move(dt, pv.x, pv.z, 7, null);
    } else if (target && dist(px, pz, this.x, this.z) < 60) {
      this.startFight(!!target.ref.isCop || game.copsNear(this.x, this.z));
      this.fight(dt, target, 0.9);
    } else {
      if (this.state === 'fight') this.endFight();
      this.state = pv ? 'wait' : 'follow';
      this.heart = Math.min(this.baseHeart, this.heart + dt * 0.03);
      this.char.armR.rotation.x = -0.3;
      if (!pv) {
        // Walk in a loose formation behind you.
        const h = p.heading;
        const back = 2.2 + Math.floor(this.slot / 2) * 1.6;
        const side = this.slot % 2 === 0 ? -1.4 : 1.4;
        const gx = px - Math.sin(h) * back - Math.cos(h) * side;
        const gz = pz - Math.cos(h) * back + Math.sin(h) * side;
        const d = dist(this.x, this.z, gx, gz);
        const speed = d > 8 ? 7.2 : d > 1.2 ? 4.4 : 0;
        this.move(dt, gx, gz, speed, speed ? null : h);
      } else this.move(dt, this.x, this.z, 0, null);
    }
    this.animate(dt);
    this.place();
  }
}

// The Kings' corner (city.gangHome): spots back along the front sidewalk, and round the corner.
const RIVAL_SPOTS = (h) => {
  const sd = h.block.frontSide;
  return [[0, 0], [4, 0], [10, 0], [0, 4], [0, 11], [0, 19]].map(([a, d]) => [h.x - sd.ux * a - sd.nx * d, h.z - sd.uz * a - sd.nz * d]);
};

export class GangManager {
  constructor(game) {
    this.game = game;
    this.home = game.city.gangHome;
    this.members = [];
    this.angry = false;
    this.angryT = 0;
    this.respawnT = 0;
    this.spawn();
  }

  spawn() {
    for (const [x, z] of RIVAL_SPOTS(this.home)) this.members.push(new RivalMember(this.game, x, z));
  }

  anger() {
    if (!this.angry && this.game.wastedT <= 0 && this.members.some((m) => m.alive)) {
      this.game.hud.news(`${GANG_NAME} open fire in the Projects`);
    }
    this.angry = true;
    this.angryT = 25;
  }

  // Their home block fell: the hangout crew scatters.
  wipeOut() {
    this.angry = false;
    for (const m of this.members) if (m.alive) m.giveUp();
  }

  // Do the Kings still hold their hangout block?
  holdsHome() {
    const t = this.game.turfWars;
    const b = this.home.block;
    return !t || t.owner[b.key] === 'kings';
  }

  // A member went down: nearby friends lose nerve.
  allyDown(m) {
    for (const o of this.members) if (o !== m && o.alive && dist(o.x, o.z, m.x, m.z) < 25) o.shaken(0.18);
  }

  calm() {
    this.angry = false;
    for (const m of this.members) if (m.state === 'fight') m.endFight();
  }

  update(dt) {
    for (const m of this.members) m.update(dt);
    if (this.angry) {
      this.angryT -= dt;
      if (this.angryT <= 0) this.calm();
    }
    const [px, pz] = this.game.player.pos();
    const far = dist(this.home.x, this.home.z, px, pz) > 90;
    for (const m of this.members) if (m.state === 'dead' && m.t <= 0 && far) m.dispose();
    // Rivals who fled the area are gone once you can't see them.
    for (const m of this.members) {
      if (m.alive && m.behavior === 'leave' && dist(m.x, m.z, px, pz) > 60 && segmentBlocked(px, pz, m.x, m.z, this.game.city.los)) m.dispose();
    }
    this.members = this.members.filter((m) => !m.removed);
    if (!this.members.some((m) => m.alive)) {
      this.respawnT += dt;
      if (this.respawnT > 60 && far && this.holdsHome()) {
        for (const m of this.members) m.dispose();
        this.members = [];
        this.respawnT = 0;
        this.angry = false;
        this.spawn();
      }
    }
  }
}

const HOMIE_NAMES = ['Dre', 'Lil T', 'Smoke', 'Kiki', 'Ray', 'Boogie', 'Nino', 'Tasha', 'Junior', 'Mook'];
export const MAX_CREW = 3;

export class CrewManager {
  constructor(game) {
    this.game = game;
    this.home = game.city.crewHome;
    this.members = [];
    this.refillT = 0;
    this.names = HOMIE_NAMES.slice();
    for (let i = 0; i < 4; i++) this.addHomie();
  }

  addHomie() {
    const h = this.home;
    const used = this.members.filter((m) => !m.recruited && m.alive).length;
    const along = -6 + used * 3.2;
    const inset = (used % 2 ? 1.4 : 2.8) - 2.4; // (the hangout spot is 2.4 m in from the curb)
    const x = h.x + h.ux * along - h.nx * inset;
    const z = h.z + h.uz * along - h.nz * inset;
    const name = this.names.length ? this.names.splice(Math.floor(Math.random() * this.names.length), 1)[0] : 'Homie';
    const m = new CrewMember(this.game, x, z, name);
    this.members.push(m);
    return m;
  }

  get following() {
    return this.members.filter((m) => m.recruited && m.alive);
  }

  recruit(m) {
    if (this.following.length >= MAX_CREW) return false;
    m.recruited = true;
    m.state = 'follow';
    this.reslot();
    this.game.hud.news(`${m.name} rolled with you. (${m.heartLabel})`, 'good');
    return true;
  }

  dismiss(m) {
    m.recruited = false;
    m.endFight();
    m.state = 'idle';
    this.reslot();
  }

  reslot() {
    this.following.forEach((m, i) => (m.slot = i));
  }

  memberDown(m) {
    if (m.recruited) this.game.hud.news(`Your homie ${m.name} was killed`, 'info');
    for (const o of this.following) if (o !== m && dist(o.x, o.z, m.x, m.z) < 25) o.shaken(0.18);
    this.names.push(m.name);
  }

  // Player got in a car: nearby crew run over and climb in.
  playerEntered(v) {
    for (const m of this.following) {
      if (m.standing && dist(m.x, m.z, v.x, v.z) < 18) m.state = 'boarding';
    }
  }

  playerExited() {
    let i = 0;
    for (const m of this.following) {
      if (m.state === 'inCar') m.leaveCar(i++);
      else if (m.state === 'boarding' || m.state === 'wait') m.state = 'follow';
    }
  }

  // You bailed out at speed: the crew ride it out and get out once it stops.
  playerBailed() {}

  carStopped(v) {
    let i = 0;
    for (const m of this.following) if (m.state === 'inCar' && m.vehicle === v) m.leaveCar(i++);
  }

  // Car blew up with the crew inside.
  carDestroyed(v) {
    for (const m of this.following) {
      if (m.state === 'inCar' && m.vehicle === v) {
        m.leaveCar(0);
        m.takeHit(999);
      }
    }
  }

  // After being busted or wasted, your crew heads home.
  sendHome() {
    for (const m of this.following) {
      m.recruited = false;
      m.endFight();
      if (m.state === 'inCar') m.leaveCar(0);
      m.x = m.homeX;
      m.z = m.homeZ;
      m.state = 'idle';
      m.place();
    }
  }

  // Characters that can be seen and shot (not riding in a car).
  visible() {
    return this.members.filter((m) => m.state !== 'inCar');
  }

  update(dt) {
    for (const m of this.members) m.update(dt);
    // Bring stragglers along if you drive far away without them.
    const p = this.game.player;
    if (!p.vehicle) {
      for (const m of this.following) {
        if (m.state !== 'follow' || dist(m.x, m.z, p.x, p.z) < 120) continue;
        m.x = p.x - Math.sin(p.heading) * 4;
        m.z = p.z - Math.cos(p.heading) * 4;
      }
    }
    // Clear old bodies and keep a few homies at the hangout.
    const [px, pz] = p.pos();
    for (const m of this.members) if (m.state === 'dead' && m.t <= 0 && dist(m.x, m.z, px, pz) > 60) m.dispose();
    this.members = this.members.filter((m) => !m.removed);
    const idle = this.members.filter((m) => !m.recruited && m.alive).length;
    if (idle < 2) {
      this.refillT += dt;
      if (this.refillT > 45 && dist(this.home.x, this.home.z, px, pz) > 60) {
        this.refillT = 0;
        this.addHomie();
      }
    }
  }
}
