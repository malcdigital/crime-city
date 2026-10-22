import { GANG_NAME } from './config.js';
import { makeCharacter, setDown, SKIN_TONES } from './character.js';
import { pushCircle, segmentBlocked } from './collision.js';
import { dist, pick, rand, lerpAngle } from './util.js';

// A member of the rival gang. Hangs out on their corner and shoots anyone who starts trouble.
export class GangMember {
  constructor(game, x, z) {
    this.game = game;
    this.char = makeCharacter({ shirt: 0x6a1b9a, pants: 0x1b1b1b, skin: pick(SKIN_TONES), bandana: 0x8e24aa });
    game.scene.add(this.char.group);
    this.homeX = x;
    this.homeZ = z;
    this.x = x;
    this.z = z;
    this.heading = rand(-Math.PI, Math.PI);
    this.state = 'idle'; // idle | fight | down | dead
    this.health = 100;
    this.t = 0;
    this.phase = Math.random() * 6;
    this.fireT = rand(0.4, 1);
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.isGang = true;
    this.removed = false;
    this.char.armR.rotation.x = -0.3;
  }

  get standing() {
    return this.state === 'idle' || this.state === 'fight';
  }

  get alive() {
    return this.state !== 'dead';
  }

  takeHit(dmg) {
    if (this.state === 'dead') return false;
    this.health -= dmg;
    this.game.gang.anger();
    if (this.health <= 0) {
      this.state = 'dead';
      this.t = 45;
      setDown(this.char, true);
      return true;
    }
    return false;
  }

  knockDown() {
    if (!this.standing) return;
    this.state = 'down';
    this.t = 3;
    setDown(this.char, true);
    this.game.gang.anger();
  }

  update(dt) {
    const game = this.game;
    if (this.state === 'dead') {
      this.t -= dt;
      this.place();
      return;
    }
    if (this.state === 'down') {
      this.t -= dt;
      if (this.t <= 0) {
        setDown(this.char, false);
        this.state = 'fight';
      }
      this.place();
      return;
    }
    const [px, pz] = game.player.pos();
    const d = dist(this.x, this.z, px, pz);
    let tx = this.x;
    let tz = this.z;
    let speed = 0;
    let face = null;

    // Walking onto their corner on foot starts a fight.
    if (!game.gang.angry && d < 9 && !game.player.vehicle && game.wastedT <= 0) game.gang.anger();

    if (game.gang.angry && d < 70 && game.wastedT <= 0) {
      this.state = 'fight';
      const los = !segmentBlocked(this.x, this.z, px, pz, game.city.los);
      if (!los || d > 20) {
        tx = px;
        tz = pz;
        speed = 5.2;
      } else if (d < 6) {
        tx = this.x * 2 - px;
        tz = this.z * 2 - pz;
        speed = 2.5;
      } else {
        // Sidestep while shooting.
        const ux = (px - this.x) / d;
        const uz = (pz - this.z) / d;
        if (Math.random() < dt * 0.5) this.strafe *= -1;
        tx = this.x - uz * this.strafe * 3;
        tz = this.z + ux * this.strafe * 3;
        speed = 1.6;
      }
      face = Math.atan2(px - this.x, pz - this.z);
      if (los && d < 50) {
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = rand(0.25, 0.8);
          game.npcShoot(this, 6, 'smg');
        }
      }
      this.char.armR.rotation.x = -1.45;
    } else {
      this.state = 'idle';
      this.char.armR.rotation.x = -0.3;
      if (dist(this.x, this.z, this.homeX, this.homeZ) > 1) {
        tx = this.homeX;
        tz = this.homeZ;
        speed = 1.6;
      } else if (d < 25) face = Math.atan2(px - this.x, pz - this.z);
    }

    if (speed > 0) {
      const dd = dist(this.x, this.z, tx, tz);
      if (dd > 0.1) {
        const ux = (tx - this.x) / dd;
        const uz = (tz - this.z) / dd;
        if (face === null) face = Math.atan2(ux, uz);
        this.x += ux * speed * dt;
        this.z += uz * speed * dt;
      }
      const r = pushCircle(this.x, this.z, 0.4, game.city.colliders);
      this.x = r.x;
      this.z = r.z;
    }
    if (face !== null) this.heading = lerpAngle(this.heading, face, Math.min(1, dt * 8));
    this.phase += dt * speed * 3;
    const s = Math.sin(this.phase) * Math.min(1, speed / 2);
    this.char.legL.rotation.x = s * 0.8;
    this.char.legR.rotation.x = -s * 0.8;
    this.char.armL.rotation.x = -s * 0.6;
    this.place();
  }

  place() {
    const y = this.game.city.groundY(this.x, this.z);
    this.char.group.position.set(this.x, this.standing ? y : y + 0.2, this.z);
    this.char.group.rotation.y = this.heading;
  }

  dispose() {
    this.game.scene.remove(this.char.group);
    this.removed = true;
  }
}

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
    const b = this.home.block;
    const spots = [
      [b.maxX - 2, b.minZ + 2],
      [b.maxX - 6, b.minZ + 2],
      [b.maxX - 12, b.minZ + 2],
      [b.maxX - 2, b.minZ + 6],
      [b.maxX - 2, b.minZ + 13],
    ];
    for (const [x, z] of spots) this.members.push(new GangMember(this.game, x, z));
  }

  anger() {
    if (!this.angry && this.game.wastedT <= 0) {
      const alive = this.members.filter((m) => m.alive).length;
      if (alive) this.game.hud.news(`${GANG_NAME} open fire in Southgate`);
    }
    this.angry = true;
    this.angryT = 25;
  }

  calm() {
    this.angry = false;
  }

  update(dt) {
    for (const m of this.members) m.update(dt);
    if (this.angry) {
      this.angryT -= dt;
      if (this.angryT <= 0) this.angry = false;
    }
    const [px, pz] = this.game.player.pos();
    const far = dist(this.home.x, this.home.z, px, pz) > 90;
    // Clear old bodies once nobody is watching.
    for (const m of this.members) if (m.state === 'dead' && m.t <= 0 && far) m.dispose();
    this.members = this.members.filter((m) => !m.removed);
    if (!this.members.some((m) => m.alive)) {
      this.respawnT += dt;
      if (this.respawnT > 60 && far) {
        for (const m of this.members) m.dispose();
        this.members = [];
        this.respawnT = 0;
        this.angry = false;
        this.spawn();
      }
    }
  }
}
