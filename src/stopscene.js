import * as THREE from 'three';
import { lam } from './character.js';
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
  constructor(game, { tells = [], dirty = false, unit = null } = {}) {
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
    const d = dist(o.x, o.z, px, pz) || 1;
    return { x: px + ((o.x - px) / d) * 1.5, z: pz + ((o.z - pz) / d) * 1.5, fx: px, fz: pz };
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
    o.script = {
      x: s.x, z: s.z, fx: s.fx, fz: s.fz, speed: WALK,
      pose: (c, t, speed) => {
        if (speed > 0.2) return;
        c.armR.rotation.x = cuffs ? -0.9 : -0.25;
        c.armL.rotation.x = rights ? -1.0 : -0.2;
        if (radio) c.armL.rotation.x = -2.5; // (hand on the radio)
        if (waving) c.armR.rotation.x = -2.2 + Math.sin(t * 6) * 0.5;
      },
    };
    if (this.partner && this.partner.standing && !this.unit.carLost) {
      const car = this.unit.car;
      const [fx, fz] = car.forward();
      const w = car.type.w / 2 + 0.7;
      const [px, pz] = game.player.pos();
      this.partner.script = { x: car.x - fz * w + fx * 0.6, z: car.z + fx * w + fz * 0.6, fx: px, fz: pz, speed: 1.5 };
    }
    if (this.camLight) this.camLight.visible = Math.floor(game.time * 2) % 2 === 0;
    if (!this.ready && (dist(o.x, o.z, s.x, s.z) < 0.45 || this.t > MAX_WAIT)) this.ready = true;
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
