import * as THREE from 'three';
import { aimPose, flinchPose, fallFace, markFlinch, kneelPose } from './combatpose.js';
import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { makeCharacter, animateWalk, setDown, crouchPose, SKIN_TONES, straightArms, setHeight, randomHeight } from './character.js';
import { pushCircle, segmentBlocked } from './collision.js';
import { steerToward, throttleFor, StuckHelper } from './driving.js';
import { dist, pick, rand, lerpAngle } from './util.js';
import { streetAt, districtAt } from './city.js';
import { navStep } from './nav.js';
import { findCover } from './gang.js';
import { Helicopter } from './heli.js';
import { TrafficDriver, laneOff } from './traffic.js';
import { boxCorners } from './geom.js';

// A police officer on foot. Rides hidden inside the unit's car until it dismounts.
export class Officer {
  constructor(game, unit, swat = false) {
    this.game = game;
    this.unit = unit;
    this.swat = swat;
    this.char = swat
      ? makeCharacter({ shirt: 0x23272d, pants: 0x1a1d22, skin: pick(SKIN_TONES), cap: 0x0e0f11 })
      : makeCharacter({ shirt: 0x1f3a6e, pants: 0x14213d, skin: pick(SKIN_TONES), cap: 0x14213d });
    setHeight(this.char, randomHeight());
    this.char.group.visible = false;
    game.scene.add(this.char.group);
    this.x = unit.car.x;
    this.z = unit.car.z;
    this.heading = 0;
    this.state = 'inCar'; // inCar | chase | return | down | dead
    this.t = 0;
    this.phase = 0;
    this.health = swat ? 160 : 100; // body armor
    this.fireT = rand(0.5, 1.2);
    this.isCop = true;
    // Most cops fight from cover; a few push forward and flank (SWAT push more).
    this.flanker = Math.random() < (swat ? 0.35 : 0.15);
    if (swat) {
      // Rifle in hand, and a vest.
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.7), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      gun.position.set(0, -0.04, 0);
      gun.rotation.x = Math.PI / 2;
      this.char.wristR.add(gun);
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.36), new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
      vest.position.set(0, 1.3 - this.char.spine.position.y, 0);
      this.char.spine.add(vest);
    }
    this.crouched = false;
    this.spot = null;
    this.peeking = false;
    this.coverT = 0;
    this.peekShots = 0;
    this.recheckT = 0;
    this.blindT = 0;
    this.advanceT = 0;
  }

  get standing() {
    return this.state === 'chase' || this.state === 'return';
  }

  get alive() {
    return this.state !== 'dead';
  }

  get visibleOnStreet() {
    return this.state !== 'inCar';
  }

  dismount(side, back = 0) {
    if (this.state !== 'inCar') return;
    const c = this.unit.car;
    const [fx, fz] = c.forward();
    const w = c.type.w / 2 + 0.8;
    this.x = c.x - fz * side * w - fx * back;
    this.z = c.z + fx * side * w - fz * back;
    this.state = 'chase';
    this.char.group.visible = true;
    // Swing the door open on the way out (it stays open in a gunfight).
    c.openDoor(side, this.game.lethal ? 0 : 1.2);
  }

  knockDown(fromX, fromZ, fling = 0) {
    if (!this.standing) return;
    this.state = 'down';
    this.t = rand(3.5, 5);
    if (fling) {
      const d = dist(this.x, this.z, fromX, fromZ) || 1;
      this.x += ((this.x - fromX) / d) * fling;
      this.z += ((this.z - fromZ) / d) * fling;
    }
    setDown(this.char, true);
  }

  takeHit(dmg, fromX, fromZ) {
    if (this.state === 'dead' || this.state === 'inCar') return false;
    this.health -= dmg;
    if (this.health <= 0) {
      this.state = 'dead';
      this.crouched = false;
      setDown(this.char, true, fallFace(this.x, this.z, this.heading, fromX, fromZ));
      return true;
    }
    markFlinch(this.char, this.game.time, 'shot'); // (hit, still up: the jolt)
    return false;
  }

  update(dt) {
    if (this.state === 'inCar' || this.state === 'dead') {
      if (this.state === 'dead') this.place();
      return;
    }
    const game = this.game;
    const [px, pz] = game.player.pos();
    let tx = this.x;
    let tz = this.z;
    let speed = 0;
    let face = null;

    if (this.state !== 'chase') this.crouched = false;
    if (this.script && this.standing) {
      // Scripted (a traffic stop, stopscene.js): walk to a spot, then stand there facing a
      // point, in a pose.
      const S = this.script;
      this.crouched = false;
      const far = dist(this.x, this.z, S.x, S.z);
      if (far > 0.25) {
        tx = S.x;
        tz = S.z;
        speed = Math.min(S.speed || 1.7, far * 3);
      } else face = Math.atan2(S.fx - this.x, S.fz - this.z);
      if (speed > 0) {
        const h = navStep(this, tx, tz, speed, dt, game, 0.35);
        if (h !== null) this.heading = lerpAngle(this.heading, h, Math.min(1, dt * 10));
      }
      if (face !== null) this.heading = lerpAngle(this.heading, face, Math.min(1, dt * 8));
      this.phase += dt * speed * 3.2;
      animateWalk(this.char, this.phase, Math.min(1, speed / 2));
      this.tw = 0;
      S.pose?.(this.char, game.time, speed);
      this.place();
      return;
    }
    if (this.state === 'down') {
      this.t -= dt;
      if (this.t <= 0) {
        setDown(this.char, false);
        this.state = 'chase';
      }
    } else if (this.state === 'chase' && this.unit.task) {
      // Sent to a gang war: a crackdown (fight the targeted gangs) or investigating after.
      const r = this.taskUpdate(dt);
      tx = r.tx;
      tz = r.tz;
      speed = r.speed;
      face = r.face;
    } else if (this.state === 'chase' && this.unit.roadblock && game.stars > 0 && !this.unit.leaving && game.wastedT <= 0) {
      // Manning a roadblock.
      const d = dist(this.x, this.z, px, pz);
      const pv = game.player.vehicle;
      if (game.lethal && d < 55) {
        const r = this.combat(dt, px, pz);
        tx = r.tx;
        tz = r.tz;
        speed = r.speed;
        face = r.face;
      } else if (d < (pv ? 6 : 30)) {
        // You stopped at (or got out by) the roadblock: they come for you.
        tx = px;
        tz = pz;
        speed = CFG.OFFICER_SPEED;
        if (d < (pv ? 2.8 : 1.4) && (!pv || Math.abs(pv.speed) < 2)) {
          speed = 0;
          game.arrestPressure(dt);
        }
      } else {
        // Wait behind the cruiser, watching the road.
        this.recheckT -= dt;
        if (this.recheckT <= 0 || !this.spot) {
          this.recheckT = 1;
          this.spot = this.carCover(this.unit.car, { x: px, z: pz });
        }
        if (this.spot && dist(this.x, this.z, this.spot.x, this.spot.z) > 0.6) {
          tx = this.spot.x;
          tz = this.spot.z;
          speed = 3.5;
        }
        face = Math.atan2(px - this.x, pz - this.z);
        // You're driving at the roadblock: stand up and shoot out your tires.
        this.aimingTires = false;
        if (pv && d < 55 && Math.abs(pv.speed) > 2 && pv.flatCount < 4 && !segmentBlocked(this.x, this.z, px, pz, game.city.los)) {
          this.aimingTires = true;
          this.fireT -= dt;
          if (this.fireT <= 0) {
            this.fireT = rand(0.45, 0.9);
            game.shootTire(this, pv);
          }
        }
      }
    } else if (this.state === 'chase') {
      const d = dist(this.x, this.z, px, pz);
      const pv = game.player.vehicle;
      const giveUpRange = game.lethal ? 32 : 12;
      // Does the force know where you are right now (someone has eyes on you)?
      const since = game.time - game.lastSeen;
      const knows = since < 2.5;
      if (knows) this.searchGoal = null;
      if (game.stars === 0 || this.unit.leaving || game.wastedT > 0) {
        this.state = 'return';
      } else if (knows && ((pv && Math.abs(pv.speed) > 6 && d > giveUpRange) || d > 50)) {
        this.state = 'return';
      } else if (!knows) {
        // Lost sight of you: comb the area instead of standing around.
        if (since > 25 + game.stars * 5 || pv) this.state = 'return';
        else {
          const r = this.search(dt);
          tx = r.tx;
          tz = r.tz;
          speed = r.speed;
          face = r.face;
        }
      } else if (game.lethal) {
        const r = this.combat(dt, px, pz);
        tx = r.tx;
        tz = r.tz;
        speed = r.speed;
        face = r.face;
      } else {
        tx = px;
        tz = pz;
        speed = CFG.OFFICER_SPEED + game.stars * 0.15;
        // Arrest when close: on foot, or pull the player out of a stopped car.
        const reach = pv ? 2.8 : 1.4;
        if (d < reach && (!pv || Math.abs(pv.speed) < 2)) {
          speed = 0;
          game.arrestPressure(dt);
        }
      }
    } else if (this.state === 'return') {
      const c = this.unit.car;
      const carGone = this.unit.carLost;
      tx = c.x;
      tz = c.z;
      speed = carGone ? 0 : CFG.OFFICER_SPEED;
      if (!carGone && dist(this.x, this.z, c.x, c.z) < 2.6) {
        this.state = 'inCar';
        this.char.group.visible = false;
        return;
      }
      if (game.stars > 0 && !this.unit.leaving && game.wastedT <= 0 && game.time - game.lastSeen < 2.5 && dist(this.x, this.z, px, pz) < 30 && (!game.player.vehicle || game.lethal)) {
        this.state = 'chase';
      }
    }

    if (speed > 0) {
      const h = navStep(this, tx, tz, speed, dt, game, 0.4);
      if (face === null && h !== null) face = h;
    }
    if (face !== null) this.heading = lerpAngle(this.heading, face, Math.min(1, dt * 10));
    this.phase += dt * speed * 3.2;
    animateWalk(this.char, this.phase, Math.min(1, speed / 2));
    if (this.crouched) {
      // Kneeling behind the car.
      this.crouchY = crouchPose(this.char, 1);
    }
    // Gun up in a gunfight, or when shooting at tires.
    // (combatpose.js: the same two-handed aim as yours; SWAT shoulder their rifles)
    const gun = this.swat ? 'smg' : 'pistol';
    this.tw = 0;
    this.gunUp = false;
    if ((game.lethal || this.aimingTires) && this.state === 'chase') {
      this.tw = aimPose(this.char, gun, 0, game.time);
      this.gunUp = true;
    }
    // Heard shots (main.js gunshot): gun out, turned toward them.
    if (this.alertUntil > game.time && this.standing && !game.lethal) {
      this.tw = aimPose(this.char, gun, 0, game.time);
      this.gunUp = true;
      if (speed === 0 && this.alertAt) this.heading = lerpAngle(this.heading, Math.atan2(this.alertAt[0] - this.x, this.alertAt[1] - this.z), Math.min(1, dt * 6));
    }
    // (crouched behind the car with the gun up: down on one knee, the same as you)
    if (this.crouched && this.gunUp) this.crouchY = kneelPose(this.char);
    flinchPose(this.char, game.time);
    this.place();
  }

  // Searching on foot: check the places you could be hiding (behind crates, parked cars,
  // around corners), nearest to where you were last seen first. Officers split up the spots.
  search(dt) {
    const game = this.game;
    const pol = game.police;
    const out = { tx: this.x, tz: this.z, speed: 0, face: null };
    const [px, pz] = game.player.pos();
    // Footsteps: running nearby gives you away (crouch-walking doesn't).
    const p = game.player;
    if (!p.vehicle && !p.crouched && p.speed > 4 && dist(this.x, this.z, px, pz) < 16) {
      game.lastKnown = [px, pz];
      this.searchGoal = { x: px, z: pz, look: 0 };
      pol.searched = [];
    }
    this.searchLook = (this.searchLook || 0) - dt;
    if (this.searchLook > 0) {
      // Checking a spot: sweep the eyes around.
      out.face = this.heading + dt * 2.2;
      return out;
    }
    if (!this.searchGoal) this.searchGoal = pol.pickSearchSpot(this);
    const g = this.searchGoal;
    if (!g) return out;
    out.tx = g.x;
    out.tz = g.z;
    out.speed = 3.8;
    this.searchFail = (this.searchFail || 0) + dt;
    if (dist(this.x, this.z, g.x, g.z) < 1.2 || this.searchFail > 9 || this.navFails >= 3) {
      pol.searched.push({ x: g.x, z: g.z, t: game.time });
      this.searchGoal = null;
      this.searchFail = 0;
      this.navFails = 0;
      this.searchLook = rand(0.8, 1.6);
    }
    return out;
  }

  // Gang-war duty. Crackdown: shoot it out with the targeted gangs' soldiers until the war is
  // over. Investigation: walk the block looking around, then head back to the car.
  taskUpdate(dt) {
    const game = this.game;
    const task = this.unit.task;
    const b = task.block;
    const out = { tx: this.x, tz: this.z, speed: 0, face: null };
    this.taskT = (this.taskT || 0) + dt;
    if (task.type === 'crackdown') {
      const list = [];
      for (const s of game.turfWars.soldiers) {
        if (s.standing && task.gangs.includes(s.gangId) && dist(s.x, s.z, b.cx, b.cz) < 110) list.push({ x: s.x, z: s.z, ref: s });
      }
      if (list.length) {
        this.aimingTires = false;
        return this.combat(dt, b.cx, b.cz, list);
      }
      if (!task.war || task.war.state !== 'active') {
        this.state = 'return';
        return out;
      }
      out.tx = b.cx;
      out.tz = b.cz;
      out.speed = CFG.OFFICER_SPEED;
      return out;
    }
    // Investigating: stroll between spots on the block, pausing to look around.
    this.lookT = (this.lookT || 0) - dt;
    if (!this.invGoal || dist(this.x, this.z, this.invGoal[0], this.invGoal[1]) < 1.2 || this.lookT < -6) {
      if (this.lookT <= 0 && this.invGoal) this.lookT = rand(1.5, 3);
      const sides = b.sides.filter((sd) => sd.len > 10);
      const sd = sides.length ? sides[Math.floor(Math.random() * sides.length)] : b.frontSide;
      const u = rand(4, Math.max(4.1, sd.len - 4));
      this.invGoal = [sd.ax + sd.ux * u + sd.nx * 2, sd.az + sd.uz * u + sd.nz * 2];
    }
    if (this.lookT > 0) out.face = this.heading + dt * 1.5;
    else {
      out.tx = this.invGoal[0];
      out.tz = this.invGoal[1];
      out.speed = 1.8;
    }
    if (this.taskT > 45) this.state = 'return';
    return out;
  }

  // Where to take cover behind our own cruiser, given where the shooter is.
  carCover(c, tgt) {
    const [fx, fz] = c.forward();
    const rx = -fz;
    const rz = fx;
    const d = dist(c.x, c.z, tgt.x, tgt.z) || 1;
    const ux = (tgt.x - c.x) / d;
    const uz = (tgt.z - c.z) / d;
    const along = ux * fx + uz * fz;
    const lat = ux * rx + uz * rz;
    const k = this.unit.officers.indexOf(this);
    let spot;
    if (along > 0.5) {
      // Shooter ahead: crouch behind your open door, lean out past it to fire.
      const side = k === 0 ? -1 : 1;
      c.openDoor(side);
      const x = c.x + rx * side * 1.75 - fx * 0.7;
      const z = c.z + rz * side * 1.75 - fz * 0.7;
      spot = { x, z, peekX: x + rx * side * 0.7, peekZ: z + rz * side * 0.7, kind: 'door' };
    } else if (along < -0.5) {
      // Shooter behind: use the engine block at the front.
      const o = k === 0 ? -0.7 : 0.7;
      const x = c.x + fx * 3.1 + rx * o;
      const z = c.z + fz * 3.1 + rz * o;
      spot = { x, z, peekX: x, peekZ: z, kind: 'hood' };
    } else {
      // Shooter off to the side: get down on the far side of the car.
      const away = lat > 0 ? -1 : 1;
      const o = k === 0 ? 1.0 : -1.0;
      const x = c.x + rx * away * 2.2 + fx * o;
      const z = c.z + rz * away * 2.2 + fz * o;
      spot = { x, z, peekX: x, peekZ: z, kind: 'body' };
    }
    // Don't pick a spot inside a wall.
    const r = pushCircle(spot.x, spot.z, 0.45, this.game.city.colliders);
    if (Math.hypot(r.x - spot.x, r.z - spot.z) > 0.2) return null;
    return spot;
  }

  // One frame of a gunfight. Returns where to move and which way to face.
  combat(dt, px, pz, list = null) {
    const game = this.game;
    const tgt = game.pickTarget(this, list || game.playerFaction(), 55) || (list && list[0]) || { x: px, z: pz, ref: 'player' };
    const td = dist(this.x, this.z, tgt.x, tgt.z);
    const los = td < 45 && !segmentBlocked(this.x, this.z, tgt.x, tgt.z, game.city.los);
    const face = Math.atan2(tgt.x - this.x, tgt.z - this.z);
    const out = { tx: this.x, tz: this.z, speed: 0, face };
    let canShoot = false;
    let rate = [0.8, 1.4];
    this.crouched = false;

    // Pick (or refresh) a cover spot about once a second.
    this.recheckT -= dt;
    this.advanceT -= dt;
    if (this.recheckT <= 0) {
      this.recheckT = 0.8;
      const c = this.unit.car;
      const carUsable = !this.unit.carLost && !c.exploded && !c.wrecked && Math.abs(c.speed) < 1.5
        && dist(this.x, this.z, c.x, c.z) < 18 && dist(c.x, c.z, tgt.x, tgt.z) < 45;
      let spot = carUsable ? this.carCover(c, tgt) : null;
      if (!spot) {
        const cover = findCover(game, this, tgt);
        spot = cover ? { x: cover.x, z: cover.z, peekX: cover.peekX, peekZ: cover.peekZ, kind: 'other' } : null;
      }
      if (!spot || !this.spot || dist(spot.x, spot.z, this.spot.x, this.spot.z) > 0.8) this.peeking = false;
      this.spot = spot;
    }

    if (this.flanker || !this.spot || this.advanceT > 0) {
      // Push in: close to firing range in the open.
      if (!los || td > 16) {
        out.tx = tgt.x;
        out.tz = tgt.z;
        out.speed = CFG.OFFICER_SPEED;
        out.face = null;
      } else if (td < 7) {
        out.tx = this.x * 2 - tgt.x;
        out.tz = this.z * 2 - tgt.z;
        out.speed = 2.5;
      }
      canShoot = los;
    } else {
      const s = this.spot;
      const atSpot = dist(this.x, this.z, s.x, s.z) < 1.1 || (this.peeking && dist(this.x, this.z, s.peekX, s.peekZ) < 1.1);
      if (!atSpot && !this.peeking) {
        // Run to cover.
        out.tx = s.x;
        out.tz = s.z;
        out.speed = CFG.OFFICER_SPEED;
        out.face = null;
      } else if (!this.peeking) {
        // Down behind cover.
        this.crouched = true;
        this.coverT -= dt;
        if (dist(this.x, this.z, s.x, s.z) > 0.4) {
          out.tx = s.x;
          out.tz = s.z;
          out.speed = 1.5;
        }
        if (this.coverT <= 0) {
          this.peeking = true;
          this.peekShots = 2 + Math.floor(Math.random() * 2);
          this.coverT = 2.5;
        }
      } else {
        // Pop up (or lean out past the door) and fire a few rounds.
        this.coverT -= dt;
        if (dist(this.x, this.z, s.peekX, s.peekZ) > 0.4) {
          out.tx = s.peekX;
          out.tz = s.peekZ;
          out.speed = 2;
        } else canShoot = los;
        rate = [0.45, 0.75];
        if (this.peekShots <= 0 || this.coverT <= 0) {
          this.peeking = false;
          this.coverT = rand(1.0, 2.0);
        }
      }
      // Can't see anyone from here for a while: move up.
      this.blindT = los ? 0 : this.blindT + dt;
      if (this.blindT > 4) {
        this.blindT = 0;
        this.advanceT = 3;
      }
    }

    // Holding you at gunpoint (a raid or a sting): guns up, no shooting unless you resist.
    const holding = game.time < (game.holdFireUntil || 0) && game.lastShot < game.holdFireFrom;
    if (canShoot && !holding) {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = rand(rate[0], rate[1]);
        this.peekShots--;
        if (this.swat) {
          // Short rifle bursts.
          this.fireT *= 0.45;
          game.npcShootAt(this, tgt.ref, 9, 'smg', 0.95);
        } else game.npcShootAt(this, tgt.ref, 8, 'pistol');
      }
    }
    return out;
  }

  place() {
    const y = this.game.city.groundY(this.x, this.z);
    this.char.group.position.set(this.x, !this.standing ? y + 0.2 : this.crouched ? y + (this.crouchY || -0.45) : y, this.z);
    this.twS = (this.twS || 0) + ((this.standing ? this.tw || 0 : 0) - (this.twS || 0)) * 0.3;
    this.char.group.rotation.y = this.heading + this.twS;
  }

  dispose() {
    this.game.scene.remove(this.char.group);
  }
}

let callsigns = 10;
// A police cruiser with two officers.
export class PoliceUnit {
  constructor(game, x, z, heading, kind = 'police') {
    this.callsign = callsigns++; // (for the radio)
    this.game = game;
    this.kind = kind;
    this.car = new Vehicle(game.scene, kind, x, z, heading);
    this.car.driver = this;
    this.car.siren = true;
    // A cruiser carries two officers; a SWAT van carries a team of four.
    const swat = kind === 'swat';
    this.officers = Array.from({ length: swat ? 4 : 2 }, () => new Officer(game, this, swat));
    this.to = null;
    this.from = null;
    this.stuck = new StuckHelper();
    this.leaving = false;
    this.leaveT = 0;
    this.removed = false;
  }

  // The car was stolen or destroyed: officers continue on foot.
  get carLost() {
    return this.car.driver !== this || this.car.wrecked || this.car.removed;
  }

  // Everyone out: two per side, the second pair from the back doors.
  dismountAll() {
    if (this.car.high) return; // not up on the highway: they stay in the car
    this.officers.forEach((o, k) => o.dismount(k % 2 === 0 ? -1 : 1, k >= 2 ? 1.8 : 0));
  }

  get mounted() {
    return this.officers.every((o) => o.state === 'inCar' || o.state === 'dead');
  }

  get allDead() {
    return this.officers.every((o) => o.state === 'dead');
  }

  update(dt) {
    const game = this.game;
    const c = this.car;
    if (this.carLost || this.allDead) {
      if (c.driver === this) {
        c.driver = null;
        c.siren = false;
      }
      for (const o of this.officers) {
        if (o.state === 'inCar') o.dismount(1);
        o.update(dt);
      }
      return;
    }
    for (const o of this.officers) o.update(dt);
    const [px, pz] = game.player.pos();
    const d = dist(c.x, c.z, px, pz);
    this.chasing = false;

    if (!this.mounted) {
      c.update(dt, { throttle: throttleFor(c, 0), steer: 0, handbrake: true }, game.city.colliders);
      return;
    }
    // On patrol: drives with the traffic (and obeys the lights) until it sees trouble. Once
    // you're wanted, a patrol car nearby joins the chase; one that catches you running a red
    // or speeding pulls you over (enforcement.js).
    if (this.patrol) {
      if (game.stars > 0 && d < 260) this.joinChase();
      else if (this.check) {
        // (heard shots: driving over to check it out - below)
      } else if (!this.pull) {
        c.siren = false;
        this.patrol.update(dt, game);
        return;
      }
    }
    c.closeDoors();

    let tx, tz, desired;
    let plan = null;
    const maxS = c.type.max * (0.6 + game.stars * 0.08);
    if (this.leaving || game.wastedT > 0) {
      this.leaveT += dt;
      c.siren = false;
      this.navigate(px, pz, true);
      tx = this.to.x;
      tz = this.to.z;
      desired = 12;
    } else if (this.task) {
      // Heading to a gang war (crackdown) or its aftermath (investigation).
      c.siren = this.task.type === 'crackdown';
      const b = this.task.block;
      if (this.task.done) {
        this.leaving = true;
        this.navigate(px, pz, true);
        tx = this.to.x;
        tz = this.to.z;
        desired = 12;
      } else {
        const ds = dist(c.x, c.z, b.cx, b.cz);
        if (ds < 55 && !segmentBlocked(c.x, c.z, b.cx, b.cz, game.city.los)) {
          tx = b.cx;
          tz = b.cz;
          desired = ds < 30 ? 0 : Math.min(maxS, 4 + ds * 0.4);
          if (desired === 0 && Math.abs(c.speed) < 3) {
            if (this.officers.some((o) => o.state === 'inCar' && !o.tasked)) {
              this.officers.forEach((o) => (o.tasked = true));
              this.dismountAll();
            } else if (this.officers.every((o) => o.state === 'inCar' || o.state === 'dead')) this.task.done = true;
          }
        } else {
          this.navigate(b.cx, b.cz, false, 2);
          tx = this.to.x;
          tz = this.to.z;
          desired = this.task.type === 'crackdown' ? maxS : maxS * 0.6;
          if (dist(c.x, c.z, tx, tz) < 22) desired = Math.min(desired, 12);
        }
      }
    } else if (this.blockPlan) {
      // Heading out to set up a roadblock ahead of you.
      c.siren = true;
      const s = this.blockPlan.slots[this.blockSlot];
      const ds = dist(c.x, c.z, s.x, s.z);
      if (ds < 5) {
        this.settle(dt, s);
        return;
      }
      if (ds < 50 && !segmentBlocked(c.x, c.z, s.x, s.z, game.city.los)) {
        tx = s.x;
        tz = s.z;
        desired = Math.min(maxS, 4 + ds * 0.7);
        this.to = null;
      } else {
        this.navigate(s.x, s.z, false, 2);
        tx = this.to.x;
        tz = this.to.z;
        desired = maxS;
        if (dist(c.x, c.z, tx, tz) < 22) desired = Math.min(desired, 14);
      }
    } else if (this.stage && !this.staged) {
      // A raid: drive to our spot on the road near you, pull up, and everyone out.
      c.siren = true;
      [tx, tz] = this.stage;
      const ds = dist(c.x, c.z, tx, tz);
      desired = Math.min(this.rush ? c.type.max : maxS, 3 + ds * (this.rush ? 1.1 : 0.8));
      if (ds < 3) {
        desired = 0;
        if (Math.abs(c.speed) < 2) {
          this.staged = true;
          this.dismountAll();
        }
      }
      // Something parked on our spot or in the way for a while: stop where we are.
      this.stageT = (this.stageT || 0) + dt;
      if (this.stageT > 7 && Math.abs(c.speed) < 1) {
        this.staged = true;
        this.dismountAll();
      }
      this.to = null;
    } else if (this.check && this.patrol) {
      // Shots fired nearby: lights on, drive over and look around.
      const k = this.check;
      k.t -= dt;
      c.siren = true;
      const dk = dist(c.x, c.z, k.x, k.z);
      if (dk > 25) {
        this.navigate(k.x, k.z, false, 2);
        tx = this.to.x;
        tz = this.to.z;
        desired = maxS * 0.8;
        if (dist(c.x, c.z, tx, tz) < 22) desired = Math.min(desired, 12);
      } else {
        tx = k.x;
        tz = k.z;
        desired = dk > 8 ? 4 : 0;
        if (!k.arrived) {
          k.arrived = true;
          k.t = Math.min(k.t, 18);
        }
      }
      // Find the shooter there: you, soon after the shots, in plain sight.
      if (game.time - (game.lastShot ?? -99) < 40 && d < 50 && game.canSeePlayer(c, 1.4, 50, false)) {
        this.check = null;
        game.pursuit?.radio(`Unit ${this.callsign}: I've got the shooter on ${streetAt(px, pz) || 'scene'}!`, true);
        game.crime('gunfire', px, pz);
        if (game.stars < 1) {
          game.heat = Math.max(game.heat, CFG.STAR_HEAT[0]);
          game.stars = 1; // (they've got you for it)
        }
        this.joinChase();
      } else if (k.t <= 0) {
        this.check = null;
        this.resumePatrol();
      }
    } else if (this.pull) {
      // Pulling you over: lights on, up behind your car.
      c.siren = true;
      [tx, tz, desired] = game.enforce.pursue(this, dt);
    } else {
      c.siren = true;
      this.chasing = true; // (pursuit.js gives chasing cars their jobs)
      const seesPlayer = (d < 45 && game.spots(c, 1.4, 60, false)) || (this.raid && d < 45); // a raid knows exactly where you are
      plan = seesPlayer && !this.raid && game.pursuit ? game.pursuit.drive(this, maxS) : null;
      if (plan) {
        // Cutting you off, a PIT, or boxing you in (pursuit.js).
        [tx, tz, desired] = plan;
        this.to = null;
      } else if (seesPlayer) {
        const [vx, vz] = game.player.velocity();
        tx = px + vx * 0.6;
        tz = pz + vz * 0.6;
        desired = Math.min(maxS, 6 + d * 0.9);
        const stopRange = this.raid ? 20 : game.lethal ? 22 : 14;
        // A raid team bails out on arrival, car or no car.
        if ((!game.player.vehicle || game.lethal || this.raid) && d < stopRange) {
          desired = 0;
          if (Math.abs(c.speed) < 4) this.dismountAll();
        }
        this.to = null;
      } else {
        // Out of sight: search around where the player was last seen.
        const [kx, kz] = game.lastKnown || [px, pz];
        this.navigate(kx, kz, false);
        tx = this.to.x;
        tz = this.to.z;
        desired = maxS * 0.85;
        if (dist(c.x, c.z, tx, tz) < 22) desired = Math.min(desired, 12);
        // Close to where you vanished on foot: pull over and search on foot.
        const since = game.time - game.lastSeen;
        this.searchCd = (this.searchCd || 0) - dt;
        if (!game.player.vehicle && since > 1.5 && since < 20 + game.stars * 5 && this.searchCd <= 0 && dist(c.x, c.z, kx, kz) < 32) {
          this.stopping = true;
          this.searchCd = 20;
        }
        if (this.stopping) {
          desired = 0;
          if (Math.abs(c.speed) < 3) {
            this.dismountAll();
            this.stopping = false;
          }
        }
      }
    }
    // Don't plow into cars ahead (especially other cruisers parked at the scene) or officers on foot.
    const [fx, fz] = c.forward();
    const tactic = plan && this.role && this.role !== 'tail'; // (a PIT or a box-in means getting right up on you)
    for (const o of game.vehicles) {
      if (o === c || o.removed) continue;
      if (tactic && o === game.player.vehicle) continue;
      const ox = o.x - c.x;
      const oz = o.z - c.z;
      if (Math.abs(ox) > 18 || Math.abs(oz) > 18) continue;
      const fwd = ox * fx + oz * fz;
      const lat = Math.abs(ox * fz - oz * fx);
      if (o.parkSpot && lat > 1.7) continue; // parked at the curb
      if (!!o.high !== !!c.high || Math.abs((o.y || 0) - (c.y || 0)) > 3) continue; // (one on the highway, one underneath, or on a bridge over it)
      if (fwd > 0 && fwd < 18 && lat < 3) desired = Math.min(desired, Math.max(0, (fwd - 7) * 1.2));
    }
    for (const o of game.police.officers()) {
      if (!o.standing) continue;
      const ox = o.x - c.x;
      const oz = o.z - c.z;
      const fwd = ox * fx + oz * fz;
      if (fwd > 0 && fwd < 12 && Math.abs(ox * fz - oz * fx) < 2) desired = 0;
    }
    // Held up behind another car near a gunfight: bail out and go in on foot.
    const heldUp = desired < 1 && !this.leaving && game.lethal && d < 55;
    this.heldT = heldUp ? (this.heldT || 0) + dt : 0;
    if (this.heldT > 1.5 && Math.abs(c.speed) < 3) {
      this.dismountAll();
      this.heldT = 0;
    }
    const ctrl = { throttle: throttleFor(c, desired), steer: steerToward(c, tx, tz), handbrake: desired === 0 };
    this.stuck.apply(dt, c, desired, ctrl);
    c.update(dt, ctrl, game.city.colliders);
  }

  // Final few meters of a roadblock: ease the car into its spot, sideways across the road.
  settle(dt, s) {
    const c = this.car;
    const game = this.game;
    c.speed *= Math.max(0, 1 - dt * 5);
    // Either way across the road is fine: pick whichever is closer to how the car is pointing.
    const h1 = s.heading;
    const h2 = s.heading + Math.PI;
    const d1 = Math.abs(Math.atan2(Math.sin(h1 - c.heading), Math.cos(h1 - c.heading)));
    const d2 = Math.abs(Math.atan2(Math.sin(h2 - c.heading), Math.cos(h2 - c.heading)));
    const h = d1 < d2 ? h1 : h2;
    const k = Math.min(1, dt * 2.2);
    c.x += (s.x - c.x) * k;
    c.z += (s.z - c.z) * k;
    c.heading += Math.atan2(Math.sin(h - c.heading), Math.cos(h - c.heading)) * k;
    c.steerVis *= 0.9;
    c.update(dt, { throttle: 0, steer: 0, handbrake: true }, game.city.colliders);
    if (dist(c.x, c.z, s.x, s.z) < 0.5 && Math.min(d1, d2) < 0.08) {
      c.speed = 0;
      c.heavy = true;
      this.roadblock = true;
      const plan = this.blockPlan;
      plan.ready = (plan.ready || 0) + 1;
      // Officers get out on the side away from you.
      const [cfx, cfz] = c.forward();
      const side = -cfz * plan.ax + cfx * plan.az > 0 ? 1 : -1;
      this.officers.forEach((o, k) => o.dismount(side, k >= 2 ? 1.8 : (k ? -1.2 : 0)));
      if (!plan.announced) {
        plan.announced = true;
        // Once per chase is enough.
        if (!game.story || !game.story.roadblock) game.hud.news(`Police roadblock on ${streetAt(plan.cx, plan.cz)}`);
        if (game.story) game.story.roadblock = true;
      }
      // At 5 stars, a spike strip goes down across the road in front of the block.
      if (game.stars >= 5 && !plan.spiked) {
        plan.spiked = true;
        game.police.laySpikes(plan.cx - plan.ax * 12, plan.cz - plan.az * 12, plan.lx, plan.lz);
        if (!game.story || !game.story.spikes) game.hud.news(`Police lay spike strips on ${streetAt(plan.cx, plan.cz)}`);
        if (game.story) game.story.spikes = true;
      }
    }
  }

  joinChase() {
    this.patrol = null;
    this.pull = null;
    this.to = null;
  }

  // Back to patrolling after a traffic stop: pick up the street the car is on.
  resumePatrol() {
    const city = this.game.city;
    const c = this.car;
    const [fx, fz] = c.forward();
    const n = city.nearestNode(c.x, c.z);
    const ahead = (q) => (q.x - c.x) * fx + (q.z - c.z) * fz;
    let from;
    let to;
    if (ahead(n) > 4) {
      to = n;
      from = [...n.nb].sort((a, b) => ahead(a) - ahead(b))[0];
    } else {
      from = n;
      to = [...n.nb].sort((a, b) => ahead(b) - ahead(a))[0];
    }
    this.patrol = new TrafficDriver(c, from, to);
    this.patrol.cruise = rand(9, 12);
    this.pull = null;
    c.siren = false;
  }

  // Follow the road grid toward (or away from) a point.
  navigate(px, pz, away, jitter = 15) {
    const city = this.game.city;
    const c = this.car;
    if (!this.to) {
      this.to = city.nearestNode(c.x, c.z);
      this.from = null;
    }
    if (dist(c.x, c.z, this.to.x, this.to.z) < 10) {
      const options = this.to.nb.filter((n) => n !== this.from);
      const score = (n) => dist(n.x, n.z, px, pz) * (away ? -1 : 1) + Math.random() * jitter;
      options.sort((a, b) => score(a) - score(b));
      this.from = this.to;
      this.to = options[0] || this.from;
    }
  }

  dispose() {
    for (const o of this.officers) o.dispose();
    if (this.car.driver === this) this.car.dispose();
    this.removed = true;
  }
}

export class PoliceManager {
  constructor(game) {
    this.game = game;
    this.units = [];
    this.spawnT = 0;
    this.searched = []; // spots already checked: {x, z, t}
    this.spikes = [];
    this.plans = []; // roadblocks being set up or in place
  }

  // Places worth checking for a hidden suspect near (kx, kz).
  searchSpots(kx, kz, r) {
    const game = this.game;
    const out = [{ x: kx, z: kz, r: 0 }];
    for (const b of game.city.crates) {
      if (dist(b.x, b.z, kx, kz) < r) out.push({ x: b.x, z: b.z, r: Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 });
    }
    for (const v of game.vehicles) {
      if (v.removed || v.exploded || v.siren || Math.abs(v.speed) > 1) continue;
      if (dist(v.x, v.z, kx, kz) < r) out.push({ x: v.x, z: v.z, r: 2.4 });
    }
    for (const b of game.city.los) {
      if (b.maxX < kx - r - 30 || b.minX > kx + r + 30 || b.maxZ < kz - r - 30 || b.minZ > kz + r + 30) continue;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      for (const [x0, z0] of boxCorners(b)) {
        // Just round the corner, diagonally out from it.
        const L = Math.hypot(x0 - cx, z0 - cz) || 1;
        const x = x0 + ((x0 - cx) / L) * 2.2;
        const z = z0 + ((z0 - cz) / L) * 2.2;
        if (dist(x, z, kx, kz) < r) out.push({ x, z, r: 0 });
      }
    }
    return out;
  }

  // The best unchecked spot for this officer: close to him, close to where you were last seen,
  // and not one a partner is already heading to. Cops also follow their instincts a bit.
  pickSearchSpot(o) {
    const game = this.game;
    const [kx, kz] = game.lastKnown || [o.x, o.z];
    const [px, pz] = game.player.pos();
    this.searched = this.searched.filter((s) => game.time - s.t < 40);
    const taken = this.officers().filter((q) => q !== o && q.searchGoal).map((q) => q.searchGoal);
    let best = null;
    let bestScore = Infinity;
    for (const s of this.searchSpots(kx, kz, game.searchRadius)) {
      // Stand on the far side of the object, where someone would be hiding from us.
      let x = s.x;
      let z = s.z;
      if (s.r > 0) {
        const d = dist(o.x, o.z, s.x, s.z) || 1;
        x += ((s.x - o.x) / d) * (s.r + 1.2);
        z += ((s.z - o.z) / d) * (s.r + 1.2);
      }
      const fix = pushCircle(x, z, 0.45, game.city.colliders);
      x = fix.x;
      z = fix.z;
      if (this.searched.some((q) => dist(q.x, q.z, x, z) < 3.5)) continue;
      if (taken.some((q) => dist(q.x, q.z, x, z) < 3.5)) continue;
      const score = dist(o.x, o.z, x, z) * 0.6 + dist(x, z, kx, kz) + dist(x, z, px, pz) * 0.35 + Math.random() * 4;
      if (score < bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
    if (best) return best;
    // Checked everything: widen the sweep at random.
    const a = Math.random() * Math.PI * 2;
    const rr = game.searchRadius * rand(0.4, 1);
    return { x: kx + Math.cos(a) * rr, z: kz + Math.sin(a) * rr };
  }

  // A spike strip across the road (5 stars). Pops any tire that rolls over it.
  laySpikes(cx, cz, lx, lz) {
    const len = 12;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.5), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    base.position.y = 0.04;
    g.add(base);
    const spikeGeo = new THREE.ConeGeometry(0.06, 0.18, 4);
    const spikeMat = new THREE.MeshLambertMaterial({ color: 0xb8b8b8 });
    const spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, 48);
    const m = new THREE.Object3D();
    for (let k = 0; k < 48; k++) {
      m.position.set(-len / 2 + 0.15 + (k >> 1) * (len - 0.3) / 23, 0.15, k & 1 ? 0.12 : -0.12);
      m.updateMatrix();
      spikes.setMatrixAt(k, m.matrix);
    }
    g.add(spikes);
    // (lx, lz): the direction across the road; the strip's long side lies along it.
    const L = Math.hypot(lx, lz) || 1;
    lx /= L;
    lz /= L;
    g.position.set(cx, this.game.city.groundY(cx, cz), cz);
    g.rotation.y = -Math.atan2(lz, lx);
    this.game.scene.add(g);
    const strip = { x: cx, z: cz, lx, lz, half: len / 2, mesh: g, t: 90 };
    this.spikes.push(strip);
    return strip;
  }

  updateSpikes(dt) {
    const game = this.game;
    const blocking = this.units.some((u) => u.roadblock);
    for (const s of this.spikes) {
      s.t -= dt;
      if (s.t <= 0 || (!blocking && s.t < 85)) {
        game.scene.remove(s.mesh);
        s.gone = true;
        continue;
      }
      for (const v of game.vehicles) {
        if (v.removed || v.siren || Math.abs(v.speed) < 1 || dist(v.x, v.z, s.x, s.z) > 10) continue;
        let popped = 0;
        v.wheels.forEach((w, i) => {
          const [wx, , wz] = v.wheelPos(i);
          const u = (wx - s.x) * s.lx + (wz - s.z) * s.lz;
          const sw = -(wx - s.x) * s.lz + (wz - s.z) * s.lx;
          if (Math.abs(u) < s.half + 0.2 && Math.abs(sw) < 0.55 && v.popTire(i)) popped++;
        });
        if (popped) {
          game.effects.smoke(v.x, 0.5, v.z);
          if (v.driver === 'player') game.hud.toast('Spike strip!', '#ff8080');
        }
      }
    }
    this.spikes = this.spikes.filter((s) => !s.gone);
  }

  officers() {
    return this.units.flatMap((u) => u.officers);
  }

  // New units roll out of the police station yard, so response time depends on how far away you are.
  spawnUnit(kind = 'police') {
    const { city } = this.game;
    const st = city.station;
    // In the yard out front: either side of the door, and a little further out.
    const spots = [[st.x - st.ux * 6, st.z - st.uz * 6], [st.x + st.ux * 6, st.z + st.uz * 6], [st.x - st.nx * 5, st.z - st.nz * 5]];
    const spot = spots.find(([x, z]) => !this.game.vehicles.some((v) => !v.removed && dist(v.x, v.z, x, z) < 5));
    if (!spot) return false;
    const u = new PoliceUnit(this.game, spot[0], spot[1], st.heading, kind);
    this.units.push(u);
    this.game.vehicles.push(u.car);
    return true;
  }

  // A raid: cruisers come screaming in from several directions at once, already close, and
  // pull up around the spot. n = how many cars.
  // rush: an undercover's backup, already close by, arrives in a couple of seconds.
  raid(x, z, n = 3, rush = false) {
    const game = this.game;
    // The road you're on (or next to), and how far along it you are.
    const hit = game.city.edgeAt(x, z);
    if (!hit) return 0;
    const e = hit.e;
    const EL = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z) || 1;
    const rux = (e.b.x - e.a.x) / EL;
    const ruz = (e.b.z - e.a.z) / EL;
    const L = e.lane || CFG.LANE;
    const along = (hit.x - e.a.x) * rux + (hit.z - e.a.z) * ruz;
    // A point s along the road (past its ends too: roads mostly carry on), lane meters right of it.
    const at = (sAlong, lane) => [e.a.x + rux * sAlong - ruz * lane, e.a.z + ruz * sAlong + rux * lane];
    const lo = -1e9;
    const hi = 1e9;
    // Cars come in from both ends, in both lanes, and each heads for its own spot on the
    // road 10-15 m from you (clear of your car and anything else parked there).
    const plans = [[-1, L], [1, -L], [-1, -L], [1, L]];
    const taken = [];
    let sent = 0;
    for (const [dir, lane] of plans) {
      if (sent >= n) break;
      const [sx, sz] = at(along + dir * (rush ? 34 : 50), lane);
      if (sx < lo || sx > hi || sz < lo || sz > hi) continue;
      if (game.vehicles.some((v) => !v.removed && dist(v.x, v.z, sx, sz) < 6)) continue;
      let stage = null;
      for (const off of [12, 14, 10, 16, 18, 20]) {
        const [tx, tz] = at(along + dir * off, lane);
        const clear = !game.vehicles.some((v) => !v.removed && dist(v.x, v.z, tx, tz) < 4.5) && !taken.some(([qx, qz]) => dist(qx, qz, tx, tz) < 5);
        if (clear) {
          stage = [tx, tz];
          break;
        }
      }
      if (!stage) continue;
      taken.push(stage);
      // Facing along the road toward you.
      const h = Math.atan2(-dir * rux, -dir * ruz);
      const u = new PoliceUnit(game, sx, sz, h, 'police');
      u.car.speed = rush ? 24 : 16; // already flying in
      u.rush = rush;
      u.car.isCop = true;
      u.raid = true;
      u.stage = stage;
      game.lethalFlag = true; // guns out, from behind their doors
      this.units.push(u);
      game.vehicles.push(u.car);
      sent++;
    }
    game.holdFire(8); // ...but they don't open fire unless you resist
    return sent;
  }

  // Roadblocks: find a spot on the road ahead of you that police cars can reach first,
  // and send them there (cars already in the chase, or fresh ones from the station).
  planRoadblock() {
    const game = this.game;
    const v = game.player.vehicle;
    if (!v) return false;
    const [fx, fz] = v.forward();
    const sgn = v.speed >= 0 ? 1 : -1;
    const pSpeed = Math.max(Math.abs(v.speed), 12);
    const st = game.city.station;
    const cands = [];
    for (const n of game.city.nodes) {
      const dx = n.x - v.x;
      const dz = n.z - v.z;
      const d = Math.hypot(dx, dz);
      if (d < 100 || d > 420) continue;
      const cos = ((dx * fx + dz * fz) * sgn) / d;
      if (cos < 0.9) continue;
      cands.push({ n, d });
    }
    cands.sort((p, q) => Math.abs(p.d - 200) - Math.abs(q.d - 200));
    const free = this.units.filter((u) => !u.leaving && !u.carLost && !u.allDead && !u.roadblock && !u.blockPlan && u.mounted);
    for (const { n: best } of cands) {
      // The street you'd come in on: the neighbor most toward you.
      const toV = [v.x - best.x, v.z - best.z];
      const tl = Math.hypot(...toV) || 1;
      let arm = null;
      let ac = 0.7;
      for (const m of best.nb) {
        if (!m.street) continue;
        const ml = dist(m.x, m.z, best.x, best.z) || 1;
        const c = ((m.x - best.x) * toV[0] + (m.z - best.z) * toV[1]) / (ml * tl);
        if (c > ac && ml > 20) {
          ac = c;
          arm = m;
        }
      }
      if (!arm) continue;
      const al = dist(arm.x, arm.z, best.x, best.z);
      // (ax, az): the way toward the junction along that street; (lx, lz): across it.
      const ax = (best.x - arm.x) / al;
      const az = (best.z - arm.z) / al;
      const cx = best.x - ax * 14;
      const cz = best.z - az * 14;
      const lx = -az;
      const lz = ax;
      const heading = Math.atan2(lx, lz);
      const playerEta = dist(v.x, v.z, cx, cz) / pSpeed;
      // Rough drive time along the grid for a cruiser.
      const eta = (x, z) => (Math.hypot(x - cx, z - cz) * 1.3) / 30 + 2;
      const sources = free.map((u) => ({ u, t: eta(u.car.x, u.car.z) }));
      if (active(this) < CFG.UNITS_PER_STAR[game.stars] + 2) sources.push({ station: true, t: eta(st.x, st.z) + 2 }, { station: true, t: eta(st.x, st.z) + 4 });
      // Patrol cars already out on the streets, far from you and out of sight.
      for (const n of game.city.nodes) {
        if (sources.length > 12) break;
        const dp = dist(n.x, n.z, v.x, v.z);
        if (dp < 160 || dist(n.x, n.z, cx, cz) > 200 || dist(n.x, n.z, cx, cz) < 40) continue;
        if (!segmentBlocked(n.x, n.z, v.x, v.z, game.city.los)) continue;
        if (game.vehicles.some((o) => !o.removed && dist(o.x, o.z, n.x, n.z) < 8)) continue;
        sources.push({ patrol: n, t: eta(n.x, n.z) });
      }
      const ok = sources.filter((s) => s.t < playerEta * 0.85).sort((p, q) => p.t - q.t);
      // Two cars, from two different places.
      const pick = [];
      for (const s of ok) {
        if (pick.length === 2) break;
        if (s.patrol && pick.some((q) => q.patrol && dist(q.patrol.x, q.patrol.z, s.patrol.x, s.patrol.z) < 10)) continue;
        pick.push(s);
      }
      if (pick.length < 2) continue;
      if (ok.length < 2) continue;
      const plan = { cx, cz, ax, az, lx, lz, slots: [-2.5, 2.5].map((o) => ({ x: cx + lx * o, z: cz + lz * o, heading })), t: 0 };
      pick.forEach((s, k) => {
        let u = s.u;
        if (s.station) {
          if (!this.spawnUnit()) return;
          u = this.units[this.units.length - 1];
        } else if (s.patrol) {
          const n = s.patrol;
          const nb = n.nb.filter((m) => m.street).reduce((a, b) => (dist(a.x, a.z, cx, cz) < dist(b.x, b.z, cx, cz) ? a : b));
          u = new PoliceUnit(game, n.x, n.z, Math.atan2(nb.x - n.x, nb.z - n.z));
          this.units.push(u);
          game.vehicles.push(u.car);
        }
        u.blockPlan = plan;
        u.blockSlot = k;
        u.to = null;
      });
      this.plans.push(plan);
      return true;
    }
    return false;

    function active(m) {
      return m.units.filter((u) => !u.leaving && !u.carLost && !u.allDead).length;
    }
  }

  // Gang wars. Normally the police stay out of it and only show up afterwards to investigate.
  // If the President has ordered a crackdown on a gang, units roll out during the war and
  // go after that gang's soldiers.
  crackdownOn(war) {
    const cd = this.game.turfWars.crackdown || {};
    const gangs = [war.attacker, war.defender].filter((g) => g && cd[g]);
    if (!gangs.length || this.units.some((u) => u.task && u.task.war === war)) return;
    const task = { type: 'crackdown', war, block: war.block, gangs };
    for (const kind of ['police', 'swat']) {
      if (this.spawnUnit(kind)) this.units[this.units.length - 1].task = task;
    }
    this.game.hud.news(`Police move in on the ${war.street} gang war — crackdown on ${gangs.map((g) => this.game.turfWars.gangName(g)).join(' and ')}`, 'info');
  }

  investigateLater(block, street) {
    (this.pending = this.pending || []).push({ at: this.game.time + 15, block, street });
  }

  updateGangDuty() {
    const game = this.game;
    if (!this.pending) return;
    for (const p of this.pending) {
      if (game.time < p.at) continue;
      p.sent = true;
      if (this.units.some((u) => u.task && u.task.block === p.block && !u.task.done)) continue;
      if (this.spawnUnit('police')) {
        this.units[this.units.length - 1].task = { type: 'investigate', block: p.block };
        game.hud.news(`Police investigating the aftermath of a shootout on ${p.street}`, 'info');
      }
    }
    this.pending = this.pending.filter((p) => !p.sent);
  }

  // Police helicopter: at 4+ stars air support gets called in, and some time later (20-30 s)
  // it takes off from the precinct roof and flies over.
  updateHeli(dt) {
    const game = this.game;
    this.heliCd = Math.max(0, (this.heliCd || 0) - dt);
    const wanted = !this.heli && game.stars >= CFG.HELI_STARS && this.heliCd <= 0 && game.wastedT <= 0;
    if (!wanted) this.heliEta = null;
    else if (this.heliEta == null) {
      this.heliEta = (20 + Math.random() * 10) / (game.budget ? game.budget.policeMult() : 1); // police budget
      game.hud.toast('Police are calling in air support', '#9fc3ff');
    } else this.heliEta -= dt;
    if (wanted && this.heliEta <= 0) {
      this.heliEta = null;
      this.heli = new Helicopter(game, game.city.station.roof);
      if (!game.story || !game.story.heli) game.hud.news('Police helicopter in the air');
      if (game.story) game.story.heli = true;
    }
    const h = this.heli;
    if (!h) return;
    if (game.stars < CFG.HELI_STARS - 1 || game.wastedT > 0) h.leave();
    h.update(dt);
    if (h.removed) {
      if (h.destroyed) this.heliCd = 45;
      this.heli = null;
    }
  }

  // Wanted level cleared: units drive off and despawn.
  // Patrol cars out on the streets when nobody's wanted: about 3 around you (more Downtown and
  // in the Government and Financial districts and on the Strip; more or fewer with the police
  // budget). They cruise with the traffic until something happens.
  updatePatrols(dt) {
    const game = this.game;
    this.patrolT = (this.patrolT ?? 1) - dt;
    if (this.patrolT > 0 || game.stars > 0 || game.wastedT > 0) return;
    this.patrolT = 2;
    const [px, pz] = game.player.pos();
    const busy = ['Downtown', 'Government District', 'Financial District', 'The Strip'].includes(districtAt(px, pz));
    const want = Math.round((busy ? 4 : 3) * (game.budget ? game.budget.policeMult() : 1));
    const have = this.units.filter((u) => u.patrol && !u.carLost).length;
    if (have >= want) return;
    const city = game.city;
    for (let tries = 0; tries < 20; tries++) {
      const from = pick(city.nodes);
      const dd = dist(from.x, from.z, px, pz);
      if (dd < 110 || dd > 260) continue;
      const opts = from.nb.filter((m) => m.street && !m.rampEnd);
      if (!opts.length) continue;
      const to = pick(opts);
      const L = dist(from.x, from.z, to.x, to.z);
      if (L < 30) continue;
      const ux = (to.x - from.x) / L;
      const uz = (to.z - from.z) / L;
      const off = laneOff(from, to);
      const x = from.x + ux * 14 - uz * off;
      const z = from.z + uz * 14 + ux * off;
      if (game.vehicles.some((v) => !v.removed && dist(v.x, v.z, x, z) < 8)) continue;
      const u = new PoliceUnit(game, x, z, Math.atan2(ux, uz), 'police');
      u.car.siren = false;
      u.patrol = new TrafficDriver(u.car, from, to);
      u.patrol.cruise = rand(9, 12);
      u.car.speed = 6;
      this.units.push(u);
      game.vehicles.push(u.car);
      return;
    }
  }

  standDown() {
    for (const u of this.units) if (!u.patrol) u.leaving = true;
  }

  clearAll() {
    if (this.heli) this.heli.dispose();
    this.heli = null;
    for (const u of this.units) u.dispose();
    this.units = [];
    for (const s of this.spikes) this.game.scene.remove(s.mesh);
    this.spikes = [];
    this.searched = [];
    this.plans = [];
  }

  update(dt) {
    const game = this.game;
    const want = Math.round(CFG.UNITS_PER_STAR[game.stars] * (game.budget ? game.budget.policeMult() : 1)); // police budget
    const wantSwat = CFG.SWAT_PER_STAR[game.stars];
    const live = this.units.filter((u) => !u.leaving && !u.carLost && !u.allDead && !u.roadblock && !u.task && !u.patrol);
    const active = live.filter((u) => u.kind !== 'swat');
    const swatActive = live.filter((u) => u.kind === 'swat');
    // Roadblocks when you're fleeing by car at 4+ stars.
    this.blockT = (this.blockT ?? 6) - dt;
    const pv = game.player.vehicle;
    if (game.stars >= 4 && pv && !pv.high && Math.abs(pv.speed) > 6 && this.blockT <= 0 && this.plans.length < 2 && game.wastedT <= 0) {
      this.blockT = this.planRoadblock() ? 15 : 2;
    }
    // Called off: you got past or away before it was set up, or it's served its purpose.
    const [ppx, ppz] = game.player.pos();
    for (const plan of this.plans) {
      plan.t += dt;
      const members = this.units.filter((u) => u.blockPlan === plan);
      const passed = (ppx - plan.cx) * plan.ax + (ppz - plan.cz) * plan.az > 15;
      const far = dist(plan.cx, plan.cz, ppx, ppz) > (plan.ready ? 170 : 340);
      if (game.stars < (plan.ready ? 1 : 4) || far || (passed && !plan.ready) || plan.t > 120 || !members.length) {
        plan.done = true;
        for (const u of members) {
          u.blockPlan = null;
          u.roadblock = false;
          u.car.heavy = false;
          u.to = null;
        }
      }
    }
    this.plans = this.plans.filter((p) => !p.done);
    // Dispatch: a short delay after the first call, then one unit every few seconds.
    if (want === 0) this.spawnT = 3;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && game.wastedT <= 0) {
      // SWAT vans roll out once you hit 4 stars, alternating with cruisers.
      const needSwat = swatActive.length < wantSwat;
      const needCar = active.length < want;
      const kind = needSwat && (!needCar || this.lastKind !== 'swat') ? 'swat' : needCar ? 'police' : null;
      if (kind && this.spawnUnit(kind)) {
        this.spawnT = 4;
        this.lastKind = kind;
        if (kind === 'swat' && !this.swatNews) {
          this.swatNews = true;
          game.hud.news('SWAT team deployed');
        }
      }
    }
    if (game.stars < 4) this.swatNews = false;
    this.updatePatrols(dt);
    this.updateHeli(dt);
    this.updateGangDuty();
    for (const u of this.units) u.update(dt);
    this.updateSpikes(dt);
    // Fresh sighting: the old search grid no longer means anything.
    if (game.time - game.lastSeen < 0.5) this.searched = [];

    const [px, pz] = game.player.pos();
    for (const u of this.units) {
      const d = dist(u.car.x, u.car.z, px, pz);
      const officersHome = u.officers.every((o) => o.state === 'inCar');
      const onFoot = u.carLost || u.allDead;
      if (onFoot) {
        const allFar = u.officers.every((o) => dist(o.x, o.z, px, pz) > 70 || o.state === 'dead' || o.state === 'inCar');
        if ((game.stars === 0 && allFar) || (u.allDead && allFar)) {
          for (const o of u.officers) o.dispose();
          u.removed = true;
        }
      } else if (u.leaving && officersHome && (d > 90 || u.leaveT > 30)) u.dispose();
      else if (u.patrol && !u.pull && officersHome && d > 400 && game.player.vehicle !== u.car) u.dispose(); // patrols far off: replaced nearer
    }
    this.units = this.units.filter((u) => !u.removed);
  }
}
