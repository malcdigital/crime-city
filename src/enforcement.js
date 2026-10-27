import { CFG } from './config.js';
import { segmentBlocked } from './collision.js';
import { dist } from './util.js';
import { StopScene } from './stopscene.js';

// Traffic enforcement. Run a red light or speed (over 55 in the city's 45 zone) where a patrol
// car can see you, and it lights you up:
// - Pull over (stop the car) and you get a ticket: $150 for a red light, $200 for speeding,
//   paid from the bank first, then cash. Tickets go to the city treasury.
// - Holding product? The officer may smell it and search the car: that's an arrest (which
//   could still turn out to be a dirty cop, see main.js).
// - Don't stop (or drive off during the stop) and it's a chase: 1 star for fleeing.
// After a ticket the cops leave you alone for a minute.
export const SPEED_LIMIT = 45; // mph
export const HIGHWAY_LIMIT = 65; // mph, on the highways
const SPEEDING = 55; // mph: when they pull you over for it
const FINES = { red: 150, speed: 200 };
const MPH = 2.237;

export class Enforcement {
  constructor(game) {
    this.game = game;
    this.cool = 0;
    this.prevNode = null;
    this.prevApproach = 0;
    this.fastT = 0;
  }

  // The patrol unit pulling you over, if any.
  get unit() {
    return this.game.police.units.find((u) => u.pull && !u.carLost && !u.allDead) || null;
  }

  update(dt, a) {
    const game = this.game;
    this.cool -= dt;
    const u = this.unit;
    if (u) return this.updateStop(dt, a, u);
    const v = game.player.vehicle;
    if (!CFG.TRAFFIC_TICKETS) return; // (switched off in config.js)
    if (!v || game.stars > 0 || game.stop || game.wastedT > 0 || game.bustedT > 0) {
      this.prevNode = null;
      this.fastT = 0;
      return;
    }
    const vio = this.redLight(v) || this.speeding(v, dt);
    if (!vio || this.cool > 0) return;
    const cop = this.witness(v);
    if (cop) this.start(cop, vio);
  }

  // Crossing the stop line at a signal on red.
  redLight(v) {
    const S = this.game.streets;
    const n = v.high ? null : S.nodeNear(v.x, v.z);
    if (!n || S.typeAt(n) !== 'signal' || Math.abs(v.speed) < 4) {
      this.prevNode = null;
      return null;
    }
    const s = Math.sign(v.speed);
    const [fx, fz] = v.forward();
    const mx = fx * s;
    const mz = fz * s;
    // The arm you're coming in along, and how far you are before the middle and off to the side.
    const arm = S.armFrom(n, { x: v.x, z: v.z });
    if (!arm || !arm.stop || -(arm.ux * mx + arm.uz * mz) < 0.7) {
      this.prevNode = null;
      return null;
    }
    const approach = (v.x - n.x) * arm.ux + (v.z - n.z) * arm.uz;
    const side = Math.abs(-(v.x - n.x) * arm.uz + (v.z - n.z) * arm.ux);
    let out = null;
    if (this.prevNode === n && side < arm.e.w / 2 + 1 && this.prevApproach > arm.stopAt && approach <= arm.stopAt && approach > 0) {
      if (S.phase(n, arm.group === 1 ? 'EW' : 'NS') === 'red') out = { kind: 'red', label: 'ran a red light', fine: FINES.red };
    }
    this.prevNode = n;
    this.prevApproach = approach;
    return out;
  }

  speeding(v, dt) {
    const mph = Math.abs(v.speed) * MPH;
    const limit = v.high ? HIGHWAY_LIMIT : SPEED_LIMIT;
    this.fastT = mph > limit + (SPEEDING - SPEED_LIMIT) ? this.fastT + dt : 0;
    if (this.fastT < 0.8) return null;
    return { kind: 'speed', label: `were doing ${Math.round(mph)} in a ${limit}`, fine: FINES.speed };
  }

  // A patrol car close enough to see it.
  witness(v) {
    const game = this.game;
    for (const u of game.police.units) {
      if (!u.patrol || u.pull || u.carLost || u.allDead) continue;
      const c = u.car;
      if (dist(c.x, c.z, v.x, v.z) > 65) continue;
      if (segmentBlocked(c.x, c.z, v.x, v.z, game.city.los)) continue;
      return u;
    }
    return null;
  }

  start(u, vio) {
    const game = this.game;
    u.pull = { vio, stage: 'pursue', t: 0, stillT: 0 };
    u.to = null;
    this.fastT = 0;
    game.hud.toast(`Police: you ${vio.label}. Pull over`, '#9fc3ff');
  }

  // Where the patrol car drives while pulling you over: up behind your car, then stopped there.
  pursue(u, dt) {
    const game = this.game;
    const c = u.car;
    const v = game.player.vehicle;
    const [px, pz] = game.player.pos();
    let bx = px;
    let bz = pz;
    if (v) {
      const [fx, fz] = v.forward();
      bx = v.x - fx * (v.halfLen + 5);
      bz = v.z - fz * (v.halfLen + 5);
    }
    const dd = dist(c.x, c.z, bx, bz);
    if (dd > 60 || segmentBlocked(c.x, c.z, bx, bz, game.city.los)) {
      u.navigate(bx, bz, false, 2);
      return [u.to.x, u.to.z, c.type.max * 0.75];
    }
    u.to = null;
    if (dd < 2.5) return [bx, bz, 0];
    const vs = v ? Math.abs(v.speed) : 0;
    return [bx, bz, Math.min(c.type.max * 0.8, 1 + dd * 0.7 + vs)];
  }

  updateStop(dt, a, u) {
    const game = this.game;
    const p = u.pull;
    p.t += dt;
    if (game.stars > 0) {
      u.joinChase();
      return;
    }
    const v = game.player.vehicle;
    const [px, pz] = game.player.pos();
    const d = dist(u.car.x, u.car.z, px, pz);
    const pad = game.input.mode === 'pad';
    if (p.stage === 'pursue') {
      game.prompt = `🚨 Pull over: stop your car (you ${p.vio.label})`;
      const stopped = (!v || Math.abs(v.speed) < 1) && d < 30;
      p.stillT = stopped ? p.stillT + dt : 0;
      if (p.stillT > 1.2) {
        p.stage = 'stopped';
        p.t = 0;
        p.scene = new StopScene(game, { unit: u }); // (he walks up to your window)
        if (!p.scene.officer) p.scene = null;
        return;
      }
      if (p.t > 22 || d > 120) this.flee(u);
      return;
    }
    if (p.stage === 'done') {
      // Ticket written: back to the car, then off on patrol.
      if (u.mounted) u.resumePatrol();
      return;
    }
    // Pulled over: he walks up first.
    if (p.scene) {
      if (p.scene.update(dt) === 'fled') return this.flee(u);
      if (!p.scene.ready) {
        p.t = 0;
        game.prompt = '🚨 The officer is walking up to your window… stay put';
        return;
      }
    }
    const fine = p.vio.fine;
    const held = game.drugs.holding();
    game.prompt = `Officer: "License and registration. You ${p.vio.label}." Ticket $${fine}. ${pad ? '✕' : 'E'} pay it · drive off to run`;
    // Something in the car? A good chance he smells it.
    if (held && !p.searched && p.t > 2.5) {
      p.searched = true;
      if (Math.random() < 0.35) {
        game.hud.toast('"I smell something. Step out the car."', '#ff8080');
        p.scene?.end();
        u.pull = null;
        u.joinChase();
        game.crime('possession', px, pz);
        game.bust();
        return;
      }
    }
    if (p.t < 0.8) return;
    if (v && Math.abs(v.speed) > 4 && d > 12) return this.flee(u);
    if (!v && d > 40) return this.flee(u);
    if (a.dealYes || p.t > 25) this.payTicket(u, fine);
  }

  payTicket(u, fine) {
    const game = this.game;
    const paid = game.bank.canPay(fine) ? fine : Math.min(fine, Math.max(0, game.cash));
    if (paid === fine) game.bank.pay(fine);
    else game.cash -= paid;
    if (game.property) game.property.treasury += paid;
    game.hud.toast(paid === fine ? `Ticket paid: -$${fine}` : `Ticket: paid $${paid} (all you had)`, '#9fc3ff');
    game.president?.win?.(0.5, 'Traffic enforcement');
    u.pull.scene?.end();
    u.pull.stage = 'done'; // (he walks back to his car first)
    this.cool = 60;
    game.save();
  }

  flee(u) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    u.pull?.scene?.end();
    u.pull = null;
    u.joinChase();
    game.crime('fleeStop', px, pz);
    game.hud.toast('Fleeing a traffic stop', '#ff8080');
    this.cool = 30;
  }
}
