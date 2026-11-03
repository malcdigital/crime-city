import * as THREE from 'three';
import { lam, reachArm, bendSpine, restPose } from './character.js';
import { dist } from './util.js';

// A police stop played out in the world (main.js: the arrest stop with a possible dirty cop;
// enforcement.js: a traffic ticket). An officer walks up to your driver's window (or up to you
// on foot) and the choices only come once he's there. What the prompt lists about him shows on
// him and his car:
//   cuffs out              - handcuffs in his hand
//   body cam light blinking - a camera on his chest, red light blinking
//   calls it in on the radio - hand up on the radio at his shoulder
//   reads you your rights   - a card in his hand
//   waves you around the corner - waving you on
//   partner watching from the car - his partner out, standing at the cruiser's door
//   came alone, no partner  - nobody else (the partner stays in the car)
//   lights flashing / no siren, never called it in - the light bar on, or dark
//   unmarked car            - a plain dark car
// Drive or run off while he's walking up and it's fleeing the stop.
const WALK = 1.7; // m/s
const MAX_WAIT = 14; // seconds: if he hasn't got there by then, he talks from where he is

export class StopScene {
  constructor(game, { tells = [], dirty = false, unit = null, hurry = false } = {}) {
    this.hurry = hurry; // (a call-out: he jogs over instead of strolling)
    this.game = game;
    this.tells = tells;
    this.dirty = dirty;
    this.unit = unit;
    this.t = 0;
    this.ready = false;
    this.props = [];
    const [px, pz] = game.player.pos();
    this.start = [px, pz];
    this.officer = this.pickOfficer();
  }

  // The officer who walks up: one already on foot close by, or the driver of the nearest car.
  pickOfficer() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    let best = null;
    let bd = 25;
    for (const o of game.police.officers()) {
      if (!o.standing || o.unit.raid) continue;
      if (this.unit && o.unit !== this.unit) continue;
      const d = dist(o.x, o.z, px, pz);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best) {
      let unit = this.unit;
      if (!unit) {
        let ud = 45;
        for (const u of game.police.units) {
          if (u.carLost || u.allDead || u.kind !== 'police' || u.raid) continue;
          const d = dist(u.car.x, u.car.z, px, pz);
          if (d < ud) {
            ud = d;
            unit = u;
          }
        }
      }
      if (!unit) return null;
      this.unit = unit;
      best = unit.officers.find((o) => o.state === 'inCar');
      if (!best) return null;
      best.dismount(-1);
    }
    this.unit = best.unit;
    // The partner: out at the cruiser's door, watching, or kept in the car.
    const partner = this.unit.officers.find((o) => o !== best && o.state !== 'dead');
    if (partner && this.has('partner watching from the car')) {
      if (partner.state === 'inCar') partner.dismount(1);
      this.partner = partner;
    } else if (partner && partner.state !== 'inCar' && this.has('came alone')) {
      partner.state = 'inCar';
      partner.char.group.visible = false;
    }
    // The car.
    const c = this.unit.car;
    if (!this.unit.carLost) {
      if (this.has('lights flashing')) c.siren = true;
      if (this.has('no siren')) c.siren = false;
      if (this.has('unmarked car')) {
        c.setUnmarked(true);
        this.unmarked = true;
      }
    }
    this.dress(best);
    return best;
  }

  has(t) {
    return this.tells.some((x) => x.startsWith(t));
  }

  // Props on him for the tells.
  dress(o) {
    const c = o.char;
    const add = (mesh, parent) => {
      parent.add(mesh);
      this.props.push(mesh);
      return mesh;
    };
    if (this.has('cuffs out')) {
      const steel = lam(0xcfd6dc);
      for (const dx of [-0.06, 0.06]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 5, 12), steel);
        ring.position.set(dx, -0.72, 0.06);
        add(ring, c.armR);
      }
    }
    if (this.has('body cam')) {
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.05), lam(0x111111));
      cam.position.set(-0.1, 1.42, 0.18);
      add(cam, c.group);
      this.camLight = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
      this.camLight.position.set(-0.1, 1.47, 0.21);
      add(this.camLight, c.group);
    }
    if (this.has('calls it in')) {
      const radio = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.05), lam(0x161616));
      radio.position.set(0.22, 1.58, 0.15);
      add(radio, c.group);
    }
    if (this.has('reads you your rights')) {
      const card = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.08), lam(0xf2f2ea));
      card.position.set(0, -0.72, 0.08);
      add(card, c.armL);
    }
  }

  // Where he stands: at your driver's window, or a step in front of you on foot.
  spot() {
    const game = this.game;
    const v = game.player.vehicle;
    const o = this.officer;
    if (v) {
      const [fx, fz] = v.forward();
      const w = (v.type?.w || 2) / 2 + 0.55;
      // (the driver's side is the car's left)
      return { x: v.x + fx * 0.4 + fz * w, z: v.z + fz * 0.4 - fx * w, fx: v.x + fx * 0.4, fz: v.z + fz * 0.4 };
    }
    const [px, pz] = game.player.pos();
    if (this.grabT != null) {
      // (holding you: at your right side, a little behind, close enough to have your arm)
      const h = this.grabH;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      const rx = -Math.cos(h);
      const rz = Math.sin(h);
      return { x: px + rx * 0.5 - fx * 0.46, z: pz + rz * 0.5 - fz * 0.46, fx: px + fx * 0.6, fz: pz + fz * 0.6 };
    }
    const d = dist(o.x, o.z, px, pz) || 1;
    return { x: px + ((o.x - px) / d) * 1.5, z: pz + ((o.z - pz) / d) * 1.5, fx: px, fz: pz };
  }

  // On foot: he takes hold of you (a hand on your arm, the other on your shoulder) for the rest
  // of the stop (enforcement.js updateFoot).
  grab() {
    if (this.grabT != null) return;
    const P = this.game.player;
    const o = this.officer;
    this.grabT = this.game.time;
    // (you're turned to face him as he comes in; he steps round to your side)
    this.grabH = o ? Math.atan2(o.x - P.x, o.z - P.z) : P.heading;
  }

  // How far into the hold (0 him reaching, 1 he's got you), for both of you.
  grabK() {
    if (this.grabT == null || !this.officer) return 0;
    const s = this.spot();
    const near = dist(this.officer.x, this.officer.z, s.x, s.z) < 0.35;
    if (!near) {
      this.heldAt = null;
      return 0;
    }
    this.heldAt ??= this.game.time;
    const k = Math.min(1, (this.game.time - this.heldAt) / 0.45);
    return k * k * (3 - 2 * k);
  }

  // You, held (main.js, after your own animation): your right arm twisted up behind your back,
  // bent forward a little with your head down, pulling against it now and then.
  posePlayer() {
    const k = this.grabK();
    const P = this.game.player;
    const c = P.char;
    P.heading = this.grabH;
    c.group.rotation.y = this.grabH;
    if (k <= 0) return;
    const t = this.game.time;
    const tug = Math.max(0, Math.sin(t * 2.3)) ** 4; // (a pull against it every few seconds)
    restPose(c);
    bendSpine(c, (0.3 + 0.1 * tug) * k, (0.12 - 0.15 * tug) * k, 0.08 * k);
    c.neck.rotation.set(0.3 * k, -0.2 * k, 0);
    c.group.updateMatrixWorld(true);
    // (the right hand up in the small of the back, the elbow out to the side)
    const behind = new THREE.Vector3(-0.2, 0.86, -0.08).lerp(new THREE.Vector3(0.02, 1.02, -0.26), k);
    reachArm(c, 'R', behind, new THREE.Vector3(-1, 0.1, -0.5), null, null, 'group');
    c.armL.rotation.set((-0.25 - 0.35 * tug) * k, 0, 0.25 * k);
    c.elbowL.rotation.set(-0.5 * k, 0, 0);
  }

  // Each frame while the stop lasts. Returns 'fled' if you took off while he was walking up.
  update(dt) {
    const game = this.game;
    const o = this.officer;
    if (!o || !o.standing) {
      this.ready = true;
      return null;
    }
    this.t += dt;
    const s = this.spot();
    const waving = this.has('waves you around');
    const radio = this.has('calls it in');
    const cuffs = this.has('cuffs out');
    const rights = this.has('reads you your rights');
    const P = game.player;
    const grabbing = this.grabT != null && !game.player.vehicle;
    o.script = {
      x: s.x, z: s.z, fx: s.fx, fz: s.fz, speed: this.hurry && dist(o.x, o.z, s.x, s.z) > 2.5 ? 5 : WALK,
      pose: (c, t, speed) => {
        const k = grabbing ? this.grabK() : 0;
        if (k > 0) {
          // (your wrist in his left hand, twisted up behind your back; his right hand pressing
          // on your shoulder; leaning into you)
          restPose(c);
          for (const j of ['legL', 'legR', 'kneeL', 'kneeR']) c[j].rotation.set(0, 0, 0);
          c.legL.rotation.x = -0.25 * k; // (a step in)
          c.kneeL.rotation.x = 0.3 * k;
          bendSpine(c, 0.22 * k, 0, 0);
          c.group.updateMatrixWorld(true);
          P.char.group.updateMatrixWorld(true);
          const tgt = (node, off) => {
            const w = node.localToWorld(off.clone());
            const l = c.group.worldToLocal(w);
            return new THREE.Vector3(0.15, 1.05, 0.35).lerp(l, k);
          };
          reachArm(c, 'L', tgt(P.char.wristR, new THREE.Vector3(0, -0.05, 0)), new THREE.Vector3(1, -0.6, -0.3), null, null, 'group');
          reachArm(c, 'R', tgt(P.char.armR, new THREE.Vector3(0, -0.14, 0)), new THREE.Vector3(-0.8, -0.3, -0.4), null, null, 'group');
          return;
        }
        if (speed > 0.2) return;
        c.armR.rotation.x = cuffs ? -0.9 : -0.25;
        c.armL.rotation.x = rights ? -1.0 : -0.2;
        if (radio) c.armL.rotation.x = -2.5; // (hand on the radio)
        if (waving) c.armR.rotation.x = -2.2 + Math.sin(t * 6) * 0.5;
      },
    };
    if (grabbing && dist(o.x, o.z, s.x, s.z) < 2.8) {
      // (in arm's reach: he steps right in to his spot beside you, and stays on you)
      const k = Math.min(1, dt * 7);
      o.x += (s.x - o.x) * k;
      o.z += (s.z - o.z) * k;
      o.script.x = o.x;
      o.script.z = o.z;
      o.script.fx = game.player.x;
      o.script.fz = game.player.z;
    }
    if (this.partner && this.partner.standing && !this.unit.carLost) {
      const car = this.unit.car;
      const [fx, fz] = car.forward();
      const w = car.type.w / 2 + 0.7;
      const [px, pz] = game.player.pos();
      this.partner.script = { x: car.x - fz * w + fx * 0.6, z: car.z + fx * w + fz * 0.6, fx: px, fz: pz, speed: 1.5 };
    }
    if (this.camLight) this.camLight.visible = Math.floor(game.time * 2) % 2 === 0;
    if (!this.ready && (dist(o.x, o.z, s.x, s.z) < 0.45 || this.t > MAX_WAIT)) this.ready = true;
    // (a call-out: he runs straight up and takes hold of you, no stopping a step off first)
    if (!this.ready && this.hurry && !game.player.vehicle && dist(o.x, o.z, game.player.x, game.player.z) < 2.4) this.ready = true;
    // Taking off while he's on his way.
    if (!this.ready) {
      const v = game.player.vehicle;
      const [px, pz] = game.player.pos();
      const moved = dist(px, pz, this.start[0], this.start[1]);
      if ((v && (Math.abs(v.speed) > 5 || moved > 10)) || (!v && moved > 6)) return 'fled';
    }
    return null;
  }

  // The stop's over: they go back to their car (or stay put for an arrest).
  end() {
    for (const m of this.props) m.parent?.remove(m);
    this.props = [];
    for (const o of [this.officer, this.partner]) if (o) o.script = null;
    if (this.unmarked && !this.unit.carLost) this.unit.car.setUnmarked(false);
  }
}
