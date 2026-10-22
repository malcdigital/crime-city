import { CFG } from './config.js';
import { makeCharacter, animateWalk, setDown, SKIN_TONES } from './character.js';
import { pushCircle } from './collision.js';
import { pick, rand, dist, lerpAngle } from './util.js';
import { navStep, escapePoint } from './nav.js';

const SHIRTS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0xecf0f1, 0x1abc9c, 0xe67e22, 0x34495e, 0xff7eb6, 0x95a5a6];
const PANTS = [0x2c3e50, 0x1b1b1b, 0x5d4037, 0x34495e, 0x7f8c8d, 0x1f3a5f];

// Sidewalk corner points around a block, clockwise.
function corners(b) {
  const x0 = b.minX + 2, x1 = b.maxX - 2, z0 = b.minZ + 2, z1 = b.maxZ - 2;
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

// Where a pedestrian at a corner can cross to: [di, dj, corner on the new block].
const CROSSINGS = [
  [[-1, 0, 1], [0, -1, 3]],
  [[1, 0, 0], [0, -1, 2]],
  [[1, 0, 3], [0, 1, 1]],
  [[-1, 0, 2], [0, 1, 0]],
];

export class Ped {
  constructor(game, block, corner) {
    this.game = game;
    this.char = makeCharacter({ shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKIN_TONES) });
    game.scene.add(this.char.group);
    this.block = block;
    this.corner = corner;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    const [cx, cz] = corners(block)[corner];
    this.x = cx;
    this.z = cz;
    this.heading = 0;
    this.speed = 0;
    this.walkSpeed = rand(1.2, 1.7);
    this.phase = Math.random() * 6;
    this.state = 'walk';
    this.t = 0;
    this.threat = null;
    this.removed = false;
    this.health = 100;
  }

  get standing() {
    return this.state !== 'down' && this.state !== 'dead';
  }

  get alive() {
    return this.state !== 'dead';
  }

  // Returns true if this hit killed them.
  takeHit(dmg, fromX, fromZ) {
    if (this.state === 'dead') return false;
    this.health -= dmg;
    if (this.health <= 0) {
      this.state = 'dead';
      this.t = 40;
      setDown(this.char, true);
      return true;
    }
    if (this.state !== 'down') this.scare(fromX, fromZ);
    return false;
  }

  knockDown(fromX, fromZ, fling = 0) {
    if (this.state === 'down' || this.state === 'dead') return;
    this.state = 'down';
    this.t = rand(5, 7);
    this.threat = [fromX, fromZ];
    if (fling) {
      const d = dist(this.x, this.z, fromX, fromZ) || 1;
      this.x += ((this.x - fromX) / d) * fling;
      this.z += ((this.z - fromZ) / d) * fling;
    }
    setDown(this.char, true);
  }

  scare(fromX, fromZ) {
    if (this.state === 'down' || this.state === 'dead') return;
    // Pick a street corner to run to, away from the danger (re-pick if the danger moved a lot).
    const moved = !this.threat || dist(this.threat[0], this.threat[1], fromX, fromZ) > 12;
    if (this.state !== 'flee' || moved || !this.fleeGoal) this.fleeGoal = escapePoint(this.game, this, fromX, fromZ);
    this.state = 'flee';
    this.t = rand(5, 8);
    this.threat = [fromX, fromZ];
  }

  resumeWalking() {
    const city = this.game.city;
    const i = Math.max(0, Math.min(CFG.BLOCKS - 1, Math.floor(this.x / CFG.PITCH)));
    const j = Math.max(0, Math.min(CFG.BLOCKS - 1, Math.floor(this.z / CFG.PITCH)));
    this.block = city.blocks[i * CFG.BLOCKS + j];
    const cs = corners(this.block);
    let best = 0;
    cs.forEach(([x, z], k) => {
      if (dist(x, z, this.x, this.z) < dist(cs[best][0], cs[best][1], this.x, this.z)) best = k;
    });
    this.corner = best;
    this.state = 'walk';
  }

  update(dt) {
    const game = this.game;
    let tx = this.x;
    let tz = this.z;
    let speed = 0;

    if (this.state === 'dead') {
      this.t -= dt;
      if (this.t <= 0) this.dispose();
    } else if (this.state === 'down') {
      this.t -= dt;
      if (this.t <= 0) {
        setDown(this.char, false);
        this.scare(...this.threat);
      }
    } else if (this.state === 'flee') {
      this.t -= dt;
      const dThreat = dist(this.x, this.z, ...this.threat);
      [tx, tz] = this.fleeGoal;
      // Sprint while close, ease into a jog once well clear.
      speed = dThreat > 40 ? 3 : 4.3;
      // Reached the corner but still scared: keep going to the next one.
      if (dist(this.x, this.z, tx, tz) < 2 || this.navFails >= 2) {
        this.navFails = 0;
        this.fleeGoal = escapePoint(game, this, ...this.threat);
      }
      if (this.t <= 0) {
        if (dThreat < 35) this.t = 1.5; // still too close: keep going
        else this.afterFlee();
      }
    } else if (this.state === 'call') {
      // On the phone to 911, watching the scene.
      this.t -= dt;
      this.heading = lerpAngle(this.heading, Math.atan2(this.threat[0] - this.x, this.threat[1] - this.z), Math.min(1, dt * 5));
      if (this.t <= 0) {
        game.civilianCall(this, this.threat);
        this.char.armR.rotation.x = 0;
        this.resumeWalking();
        this.hurryT = 12;
      }
    } else if (this.state === 'leave') {
      // Ducking into a building to get off the street.
      [tx, tz] = this.door;
      speed = 2.4;
      if (dist(this.x, this.z, tx, tz) < 0.9 || this.navFails >= 3) {
        this.dispose();
        return;
      }
    } else {
      const cs = corners(this.block);
      [tx, tz] = cs[this.corner];
      this.hurryT = Math.max(0, (this.hurryT || 0) - dt);
      speed = this.walkSpeed * (this.hurryT > 0 ? 1.6 : 1);
      if (dist(this.x, this.z, tx, tz) < 0.6) this.arrive();
    }

    if (speed > 0) {
      const h = navStep(this, tx, tz, speed, dt, game, 0.35);
      if (h !== null) this.heading = lerpAngle(this.heading, h, Math.min(1, dt * 8));
    }
    this.speed = speed;
    this.phase += dt * speed * 4;
    animateWalk(this.char, this.phase, Math.min(1, speed / 1.5));
    if (this.state === 'call') this.char.armR.rotation.x = -2.5; // phone to the ear
    const y = game.city.groundY(this.x, this.z);
    this.char.group.position.set(this.x, this.standing ? y : y + 0.2, this.z);
    this.char.group.rotation.y = this.heading;
  }

  // What a civilian does once they've run far enough.
  afterFlee() {
    const r = Math.random();
    if (r < 0.35) {
      this.state = 'call';
      this.t = rand(4, 6);
      return;
    }
    if (r < 0.65) {
      const door = this.nearestDoor();
      if (door) {
        this.door = door;
        this.state = 'leave';
        this.navFails = 0;
        return;
      }
    }
    this.resumeWalking();
    this.hurryT = 15;
  }

  // A spot against the nearest building wall to walk into.
  nearestDoor() {
    let best = null;
    let bestD = 30;
    for (const b of this.game.city.los) {
      const cx = Math.max(b.minX, Math.min(this.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(this.z, b.maxZ));
      const d = dist(this.x, this.z, cx, cz);
      if (d < bestD && d > 0.01) {
        bestD = d;
        best = [cx + ((this.x - cx) / d) * 0.6, cz + ((this.z - cz) / d) * 0.6];
      }
    }
    return best;
  }

  arrive() {
    if (Math.random() < 0.25) {
      const opts = CROSSINGS[this.corner];
      const [di, dj, nc] = pick(opts);
      const i = this.block.i + di;
      const j = this.block.j + dj;
      if (i >= 0 && j >= 0 && i < CFG.BLOCKS && j < CFG.BLOCKS) {
        this.block = this.game.city.blocks[i * CFG.BLOCKS + j];
        this.corner = nc;
        return;
      }
    }
    this.corner = (this.corner + this.dir + 4) % 4;
  }

  dispose() {
    this.game.scene.remove(this.char.group);
    this.removed = true;
  }
}

export class PedManager {
  constructor(game) {
    this.game = game;
    this.peds = [];
  }

  spawn(minDist) {
    const [px, pz] = this.game.player.pos();
    for (let tries = 0; tries < 10; tries++) {
      const b = pick(this.game.city.blocks);
      if (dist(b.cx, b.cz, px, pz) < minDist) continue;
      this.peds.push(new Ped(this.game, b, Math.floor(Math.random() * 4)));
      return;
    }
  }

  init() {
    for (let i = 0; i < CFG.PEDS; i++) this.spawn(20);
  }

  // Add a ped at a spot (e.g. a driver pulled out of a car).
  addAt(x, z) {
    const b = this.game.city.blocks[0];
    const p = new Ped(this.game, b, 0);
    p.x = x;
    p.z = z;
    this.peds.push(p);
    return p;
  }

  update(dt) {
    for (const p of this.peds) p.update(dt);
    // Keep the population steady: drop extras far from the player, refill when low.
    const [px, pz] = this.game.player.pos();
    if (this.peds.length > CFG.PEDS) {
      const far = this.peds.find((p) => dist(p.x, p.z, px, pz) > 120 && p.standing);
      if (far) far.dispose();
    }
    this.peds = this.peds.filter((p) => !p.removed);
    if (this.peds.length < CFG.PEDS) this.spawn(80);
  }
}
