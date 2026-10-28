import { GANGS } from './turf.js';
import { dist, pick } from './util.js';

// Selling on another gang's turf.
// - Loyal buyers: their buyers pay 25% less and come less often (they buy from their own) —
//   unless that gang's kingpin is dead, then their buyers come to you and pay 25% more.
// - They catch you: every sale there can get noticed (more near their people, on their home
//   block, and the more you sell on the same block). First time: a warning text. Again within
//   3 minutes: their crew opens fire (or drives over to find you).
// - Taxed: now and then one of their soldiers walks up and wants 30% of what you made on
//   their turf. Pay and you can sell there for 5 minutes. Refuse and they come at you; if they
//   drop you, they take everything you're holding.
// - Beef: selling on their turf builds tension (it cools off over time). At 50 you get a
//   warning; at 100 they hit your stash, or one of your blocks.
const PERMIT = 5 * 60;
const WARN_AGAIN = 3 * 60;
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const WARNINGS = ['who said u could serve over here. this aint ur block', 'u got one time to get off our block', 'thats our customers u eatin off. last warning'];
const BEEF_WARN = ['u been eatin on our side all week. thats a problem', 'keep servin on our block n see what happen'];

export class TurfRisk {
  constructor(game) {
    this.game = game;
    this.beef = { kings: 0, vipers: 0 };
    this.beefWarned = {};
    this.warned = {};
    this.permit = {};
    this.earned = { kings: 0, vipers: 0 }; // made on their turf since the last tax
    this.sales = {}; // block key -> recent sale times
    this.taxer = null;
    this.robbedBy = {};
  }

  // The rival gang whose turf you're on (or null).
  rivalAt(x, z) {
    const t = this.game.turfWars.turfAt(x, z);
    return t && (t.id === 'kings' || t.id === 'vipers') ? t.id : null;
  }

  // Buyers on rival turf: [price multiplier, customer-gap multiplier].
  loyalty(x, z) {
    const g = this.rivalAt(x, z);
    if (!g) return [1, 1];
    return this.game.market.kingpinAlive(g) ? [0.75, 1.6] : [1.25, 0.7];
  }

  // A sale went through on rival turf: tension, and a chance they notice (or send a collector).
  afterSale(x, z, price, units) {
    const game = this.game;
    const g = this.rivalAt(x, z);
    if (!g) return;
    const T = game.turfWars;
    this.beef[g] = Math.min(150, this.beef[g] + 4 + units);
    this.earned[g] += price;
    if ((this.permit[g] || 0) > game.time) return; // you paid: they leave you alone for now
    const k = T.ownerKeyAt(x, z);
    const recent = (this.sales[k] = (this.sales[k] || []).filter((t) => game.time - t < 300));
    recent.push(game.time);
    const near = T.soldiers.filter((s) => s.gangId === g && s.alive && s.standing && dist(s.x, s.z, x, z) < 45).length;
    const chance = 0.1 + 0.05 * Math.min(5, recent.length - 1) + (T.home[g] === k ? 0.25 : 0) + Math.min(0.3, near * 0.1);
    if (Math.random() < chance) this.caught(g, x, z);
    else if (near && !this.taxer && Math.random() < 0.4) this.sendTaxer(g, x, z);
  }

  caught(g, x, z) {
    const game = this.game;
    const T = game.turfWars;
    const from = GANGS[g].name;
    if (!this.warned[g] || game.time - this.warned[g] > WARN_AGAIN) {
      this.warned[g] = game.time;
      this.beef[g] += 10;
      game.hud.text(from, pick(WARNINGS));
      game.hud.toast(`${from} saw you serving on their block`, '#ffd36b');
      return;
    }
    // Second time: they come for you.
    this.beef[g] += 15;
    this.warned[g] = game.time;
    game.hud.text(from, 'we told u.');
    game.hud.toast(`${from} are coming for you`, '#ff8080');
    T.aggro(g, x, z, 90, 60);
    const close = T.soldiers.some((s) => s.gangId === g && s.alive && s.aggroUntil > game.time);
    if (!close) T.sendHunters(g, x, z, 1);
  }

  // One of theirs walks up for a cut.
  sendTaxer(g, x, z) {
    const T = this.game.turfWars;
    const s = T.soldiers
      .filter((q) => q.gangId === g && q.alive && q.standing && !q.war && !q.boarding && q.state !== 'inCar' && !q.kingpin && dist(q.x, q.z, x, z) < 80)
      .sort((p, q) => dist(p.x, p.z, x, z) - dist(q.x, q.z, x, z))[0];
    if (!s) return;
    s.taxing = true;
    this.taxer = { s, g, cut: Math.max(50, Math.round((this.earned[g] * 0.3) / 5) * 5), t: 0, wait: 0 };
  }

  endTax() {
    if (this.taxer) this.taxer.s.taxing = false;
    this.taxer = null;
  }

  // Each frame. Returns a prompt while a collector is talking to you.
  update(dt, a) {
    const game = this.game;
    // Tension cools off (about 2 points a minute).
    for (const g of ['kings', 'vipers']) {
      if (this.beef[g] >= 100) {
        this.retaliate(g);
        continue;
      }
      this.beef[g] = Math.max(0, this.beef[g] - (dt / 60) * 2);
      if (this.beef[g] >= 50 && !this.beefWarned[g]) {
        this.beefWarned[g] = true;
        game.hud.text(GANGS[g].name, pick(BEEF_WARN));
      }
      if (this.beef[g] < 35) this.beefWarned[g] = false;
    }
    const tx = this.taxer;
    if (!tx) return '';
    const s = tx.s;
    tx.t += dt;
    if (!s.alive || !s.standing || s.state === 'inCar' || s.war || tx.t > 45 || game.wastedT > 0) {
      this.endTax();
      return '';
    }
    const [px, pz] = game.player.pos();
    if (dist(s.x, s.z, px, pz) > 2.6) return '';
    tx.wait += dt;
    const pad = game.input.mode === 'pad';
    game.askedAt = game.time; // (a yes / no question up: the phone shows ✕ and ○)
    const prompt = `${GANGS[tx.g].name}: "this our block. u eatin here, we eatin. ${money(tx.cut)}" — ${pad ? '✕' : 'E'} pay · ${pad ? '○' : 'Q'} refuse`;
    if (a.dealYes) {
      if (game.cash >= tx.cut) {
        game.cash -= tx.cut;
        this.permit[tx.g] = game.time + PERMIT;
        this.earned[tx.g] = 0;
        this.beef[tx.g] = Math.max(0, this.beef[tx.g] - 15);
        game.hud.toast(`Paid ${money(tx.cut)}. You can serve here for 5 minutes.`);
        game.hud.text(GANGS[tx.g].name, 'smart. u good for a lil while');
        game.save();
        this.endTax();
        return '';
      }
      game.hud.toast("You don't have it", '#ff8080');
      this.refuse(tx);
      return '';
    }
    if (a.dealNo || tx.wait > 12) {
      this.refuse(tx);
      return '';
    }
    a.melee = a.sprint = false;
    a.interactHeld = false;
    return prompt;
  }

  // Said no: they come at you, and if they drop you they take what you're holding.
  refuse(tx) {
    const game = this.game;
    const [px, pz] = game.player.pos();
    this.beef[tx.g] += 25;
    this.robbedBy[tx.g] = game.time;
    game.hud.text(GANGS[tx.g].name, 'aight. u chose this');
    game.hud.toast(`${GANGS[tx.g].name} want your pack — they're coming for it`, '#ff8080');
    game.turfWars.aggro(tx.g, px, pz, 80, 60);
    this.endTax();
  }

  // Wasted: if a gang you stiffed just dropped you, they take your product.
  onWasted() {
    const game = this.game;
    const g = Object.keys(this.robbedBy).find((k) => game.time - this.robbedBy[k] < 90);
    if (!g || !game.drugs.holding()) return;
    game.drugs.inv = { weed: 0, pills: 0, coke: 0 };
    game.drugs.save();
    game.hud.toast(`${GANGS[g].name} took everything you were holding`, '#ff8080');
    delete this.robbedBy[g];
  }

  // Too much beef: they hit back at your stash, or one of your blocks.
  retaliate(g) {
    const game = this.game;
    const T = game.turfWars;
    const S = game.shops;
    this.beef[g] = 30;
    this.beefWarned[g] = false;
    game.hud.text(GANGS[g].name, 'u wanted to eat on our side. now we eatin on yours');
    const home = game.bank.biggestHome();
    if (home && home.stash > Math.max(300, S.stash)) return game.bank.robHome(home, g);
    if (S.stash > 300) return S.raid(g);
    const busy = T.wars.some((w) => w.state === 'active' && (w.attacker === 'crew' || w.defender === 'crew'));
    const blocks = T.blocks.filter((b) => {
      const k = b.key;
      return T.owner[k] === 'crew' && T.home.crew !== k && !T.locked(k);
    });
    if (!busy && blocks.length && !T.underground(g)) T.startWar(pick(blocks), g, 'crew', false);
    else if (S.stash > 0) S.raid(g);
  }

  busy() {
    return !!this.taxer;
  }

}
