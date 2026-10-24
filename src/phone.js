import { CRED_TIERS } from './config.js';
import { tierOf } from './claim.js';
import { GANGS } from './turf.js';
import { dist } from './util.js';

// The in-game phone: a home screen with apps, like a real phone.
// D-pad / arrow keys move, ✕ / Enter opens or picks, ○ / Backspace goes back (and closes the
// phone from the home screen). Mouse clicks work too.
// Apps: Contacts (plugs: set up pickups, pay back what you owe), City News (headlines and
// helicopter footage), Missions (what you're doing now, and jobs you can go do).
const APPS = [
  { id: 'messages', name: 'Messages', icon: '✉', color: '#34c759' },
  { id: 'contacts', name: 'Contacts', icon: '☎', color: '#2ecc71' },
  { id: 'news', name: 'City News', icon: 'N', color: '#e63946' },
  { id: 'missions', name: 'Missions', icon: '★', color: '#f39c12' },
  { id: 'market', name: 'Market', icon: '$', color: '#8e44ad' },
];
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export class Phone {
  constructor(game) {
    this.game = game;
    this.app = null; // null = home screen
    this.homeSel = 0;
    this.rowSel = 0;
    const screen = document.querySelector('#phone .phone-screen');
    // Home screen and an app frame; the news list (#phone-list) lives in the app frame.
    const home = document.createElement('div');
    home.id = 'phone-home';
    home.innerHTML = APPS.map((a, i) => `<div class="ph-app" data-i="${i}"><div class="ph-icon" style="background:${a.color}">${a.icon}<span class="ph-badge"></span></div><div class="ph-name">${a.name}</div></div>`).join('');
    const head = document.createElement('div');
    head.id = 'phone-apphead';
    head.innerHTML = '<span class="ph-back">‹</span><span class="ph-title"></span>';
    const body = document.createElement('div');
    body.id = 'phone-body';
    const detail = document.createElement('div');
    detail.id = 'phone-detail';
    const list = document.getElementById('phone-list');
    screen.querySelector('.phone-app')?.remove(); // the old single-app header
    screen.insertBefore(home, list);
    screen.insertBefore(head, list);
    screen.insertBefore(body, list);
    screen.insertBefore(detail, document.getElementById('phone-foot'));
    this.el = { home, head, body, detail, list, apps: [...home.querySelectorAll('.ph-app')] };
    home.addEventListener('click', (e) => {
      const a = e.target.closest('.ph-app');
      if (a) this.open(APPS[+a.dataset.i].id);
    });
    head.addEventListener('click', () => this.back());
    body.addEventListener('click', (e) => {
      const r = e.target.closest('.ph-row');
      if (!r) return;
      this.rowSel = +r.dataset.i;
      this.pick();
    });
    this.render();
  }

  get isOpen() {
    return this.game.hud.phoneOpen;
  }

  show() {
    if (!this.isOpen) this.game.hud.togglePhone();
    if (this.game.input.locked) this.game.input.unlock(); // so you can tap things
    this.render();
  }

  close() {
    if (this.isOpen) this.game.hud.togglePhone();
    this.app = null;
  }

  open(app) {
    this.app = app;
    this.rowSel = 0;
    this.render();
  }

  back() {
    if (this.app) {
      this.app = null;
      this.render();
    } else this.close();
  }

  // Rows for list apps: { label, right, detail, act() } (act may be missing: just info).
  rows() {
    const game = this.game;
    if (this.app === 'contacts') {
      return game.drugs.contacts().map((it) => ({
        label: it.label,
        right: it.can !== true ? it.can : it.priceText ?? money(it.price),
        off: it.can !== true,
        detail: it.detail,
        act: it.can === true ? () => {
          if (game.cash < it.price) return game.hud.toast("You can't afford that", '#ff8080');
          game.cash -= it.price;
          const r = it.buy();
          game.save();
          game.drugs.save();
          if (r === 'close') return this.close();
          if (!game.drugs.run || game.drugs.run.stage !== 'toPlug') return;
          this.close(); // headed to the plug
        } : null,
      }));
    }
    if (this.app === 'missions') return this.missions();
    if (this.app === 'market') {
      return game.market.rows().map((r) => ({
        ...r,
        act: r.district ? () => {
          game.mapView.waypoint = game.market.center(r.district);
          game.hud.toast(`Waypoint set: ${r.district}`);
          this.close();
        } : null,
      }));
    }
    if (this.app === 'messages') {
      const t = game.hud.texts || [];
      if (!t.length) return [{ label: 'No messages yet', right: '', detail: '' }];
      return t.map((m) => ({ label: `${m.from}: ${m.msg}`, right: m.time, detail: m.msg }));
    }
    return [];
  }

  // Missions: what you're in the middle of, then jobs you can go do. ✕ sets a waypoint.
  missions() {
    const game = this.game;
    const T = game.turfWars;
    const D = game.drugs;
    const S = game.shops;
    const [px, pz] = game.player.pos();
    const out = [];
    const way = (x, z, msg) => () => {
      game.mapView.waypoint = [x, z];
      game.hud.toast(msg || 'Waypoint set');
      this.close();
    };
    // Active.
    if (D.run) {
      const p = D.plug(D.run.plug);
      const toHQ = D.run.stage === 'toHQ';
      const hq = game.city.crewHome;
      out.push({ label: `▶ ${D.banner().replace('DRUG RUN · ', 'Drug run: ')}`, right: 'GPS', detail: toHQ ? 'Get it to the hangout with no cops on you.' : `Meet ${p.name} on ${p.street}.`, act: toHQ ? way(hq.x, hq.z) : way(p.x, p.z) });
    }
    for (const d of D.debts) {
      const p = D.plug(d.plug);
      out.push({ label: `▶ ${d.hit ? `Hit on you — pay ${p.name}` : `Pay ${p.name} back`}`, right: money(d.owe), detail: 'Pay from Contacts.', act: () => this.open('contacts') });
    }
    if (T.claim) {
      const b = T.claim.block;
      out.push({ label: `▶ Claiming ${T.claim.street}`, right: 'GPS', detail: T.claim.summary(), act: way(b.cx, b.cz) });
    }
    for (const w of T.wars) {
      if (w.state !== 'active' || (w.attacker !== 'crew' && w.defender !== 'crew')) continue;
      out.push({ label: `▶ Turf war on ${w.street}`, right: 'GPS', detail: w.summary(), act: way(w.block.cx, w.block.cz) });
    }
    // Jobs.
    if (S.stash > 0) out.push({ label: 'Collect the stash', right: money(S.stash), detail: 'Turf money waiting on the bench at the hangout.', act: way(S.stashAt.x, S.stashAt.z) });
    if (!D.run && !D.debts.length) out.push({ label: 'Supply run', right: 'Call a plug', detail: 'Pick up product from a plug and bring it back to the hangout.', act: () => this.open('contacts') });
    if (D.holding()) out.push({ label: 'Sell product', right: D.hudLine(), detail: 'Hang around (no cops, no run going) and buyers come to you.' });
    const free = T.blocks.filter((b) => {
      const k = `${b.i},${b.j}`;
      return !T.owner[k] && !T.locked(k) && !T.warOn(k) && (T.claimCooldown[k] || 0) < Date.now();
    }).sort((a, b) => dist(a.cx, a.cz, px, pz) - dist(b.cx, b.cz, px, pz));
    if (free.length && !T.claim) {
      const need = T.claimNeed();
      const ok = tierOf(game.cred) >= need;
      const b = free[0];
      out.push({ label: 'Claim a block', right: ok ? `${Math.round(dist(b.cx, b.cz, px, pz))} m` : CRED_TIERS[need].name, off: !ok, detail: ok ? 'Nearest unclaimed block: tag it, shake it down, hold it.' : `Needs ${CRED_TIERS[need].name} street cred.`, act: ok ? way(b.cx, b.cz, 'Waypoint set: nearest unclaimed block') : null });
    }
    const rival = T.blocks.filter((b) => {
      const k = `${b.i},${b.j}`;
      const g = T.owner[k];
      return g && g !== 'crew' && !T.locked(k) && T.home[g] !== k;
    }).sort((a, b) => dist(a.cx, a.cz, px, pz) - dist(b.cx, b.cz, px, pz))[0];
    if (rival) {
      const g = T.owner[`${rival.i},${rival.j}`];
      out.push({ label: `Hit ${GANGS[g].name} turf`, right: `${Math.round(dist(rival.cx, rival.cz, px, pz))} m`, detail: 'Kill 3 of theirs on the block to start a turf war.', act: way(rival.cx, rival.cz) });
    }
    if (!out.length) out.push({ label: 'Nothing going on', right: '', detail: '' });
    return out;
  }

  pick() {
    const r = this.rows()[this.rowSel];
    if (r && r.act) r.act();
    if (this.isOpen) this.render();
  }

  // Called each frame while the phone is open. Returns nothing; uses up the buttons it reads.
  update(a) {
    const game = this.game;
    if (a.phoneUp || a.phoneDown || a.phoneLeft || a.phoneRight) {
      if (!this.app) {
        const n = APPS.length;
        if (a.phoneLeft || a.phoneUp) this.homeSel = (this.homeSel - 1 + n) % n;
        if (a.phoneRight || a.phoneDown) this.homeSel = (this.homeSel + 1) % n;
      } else if (this.app === 'news') {
        if (a.phoneUp || a.phoneDown) game.hud.moveClipSelection(a.phoneDown ? 1 : -1);
      } else {
        const n = this.rows().length;
        if (n && (a.phoneUp || a.phoneLeft)) this.rowSel = (this.rowSel - 1 + n) % n;
        if (n && (a.phoneDown || a.phoneRight)) this.rowSel = (this.rowSel + 1) % n;
      }
      this.render();
    }
    if (a.phoneOk) {
      if (!this.app) this.open(APPS[this.homeSel].id);
      else if (this.app === 'news') {
        const clip = game.hud.selectedClip();
        if (clip) game.clipPlayer.play(clip);
      } else this.pick();
    }
    if (a.phoneBack && !game.clipPlayer.open) this.back();
    // Live info (timers, cash) refreshes now and then.
    this.refreshT = (this.refreshT || 0) - 1;
    if (this.refreshT <= 0 && this.app && this.app !== 'news') {
      this.refreshT = 20;
      this.render();
    }
  }

  render() {
    const game = this.game;
    const { home, head, body, detail, list, apps } = this.el;
    const app = APPS.find((x) => x.id === this.app);
    home.style.display = app ? 'none' : '';
    head.style.display = app ? '' : 'none';
    list.style.display = this.app === 'news' ? '' : 'none';
    body.style.display = app && this.app !== 'news' ? '' : 'none';
    detail.style.display = app && this.app !== 'news' ? '' : 'none';
    apps.forEach((el, i) => el.classList.toggle('sel', i === this.homeSel));
    // Badges: unread news, money owed, active jobs.
    const D = game.drugs;
    const badges = { messages: game.hud.unreadTexts || '', contacts: D.debts.length ? '!' : '', news: game.hud.unreadNews || '', missions: D.run || game.turfWars.claim ? '1' : '' };
    const badge = APPS.map((x) => badges[x.id]);
    apps.forEach((el, i) => {
      const b = el.querySelector('.ph-badge');
      b.textContent = badge[i];
      b.style.display = badge[i] ? '' : 'none';
    });
    if (!app) return;
    head.querySelector('.ph-title').textContent = app.name;
    if (this.app === 'news') {
      game.hud.unreadNews = 0;
      return;
    }
    if (this.app === 'messages') game.hud.unreadTexts = 0;
    const rows = this.rows();
    this.rowSel = Math.min(this.rowSel, Math.max(0, rows.length - 1));
    body.innerHTML = rows.map((r, i) => `<div class="ph-row${i === this.rowSel ? ' sel' : ''}${r.off ? ' off' : ''}${r.head ? ' head' : ''}" data-i="${i}"><span>${esc(r.label)}</span><b>${esc(r.right || '')}</b></div>`).join('');
    detail.textContent = rows[this.rowSel] ? rows[this.rowSel].detail || '' : '';
    body.querySelector('.ph-row.sel')?.scrollIntoView({ block: 'nearest' });
  }
}
