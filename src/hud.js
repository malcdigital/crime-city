import { drawBusStop } from './mapview.js';
import { fillTurf, strokeTurf, fillBlocks, strokeBlock } from './turfdraw.js';
const MARGIN = 0; // (the map is the whole world)
import { drawHeli, drawSearchlight } from './heliicon.js';
import { CFG, CRED_TIERS } from './config.js';
import { GANGS } from './turf.js';
import { WAR_LEVELS } from './market.js';

const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const $ = (id) => document.getElementById(id);

// Which phone app a headline belongs in. City business first (politics, money, the market), then
// anything about crime; everything else is City News.
const CITY = /President|City Hall|treasury|budget|tax|election|re-elected|voted out|sworn in|steps down|Housing|home prices|Developers|transit|Factory|landlords|Flooding|investor|utility|Auditors|Internal Affairs|Lawsuit|cleared again|Welcome to Crime City|approval|\bbuys?\b|bought|for sale/i;
const CRIME = /police|suspect|shoot|shot|kill|murder|robb|raid|arrest|crackdown|gang|turf|Kings|Vipers|Green Street|drug|seize|stolen|break-in|bribe|victim|violence|rampage|roadblock|spike|SWAT|911|officer|plug|connect|kingpin|hunting|wiped|underground|explosion|carjack|footage|sweep|dealer/i;
export function newsCategory(text, kind) {
  if (CITY.test(text)) return 'news';
  if (kind === 'crime' || CRIME.test(text)) return 'crime';
  return 'news';
}

export class Hud {
  constructor(city) {
    this.city = city;
    this.mapBg = document.createElement('canvas');
    this.mapBg.width = this.mapBg.height = 1024;
    city.drawMap(this.mapBg.getContext('2d'), 1024);
    this.mapZoom = 120;
    this.map = $('minimap').getContext('2d');
    this.toastT = 0;
    this.hitT = 0;
    this.hurtT = 0;
    this.phoneOpen = false;
    this.unread = 0;
    this.phoneToastT = 0;
    this.clock = () => '9:00 AM';
    this.last = {};
  }

  show() {
    $('hud').classList.remove('hidden');
  }

  // A line of police radio chatter under the wanted stars (pursuit.js).
  radio(text) {
    const el = $('radio');
    el.textContent = `📻 ${text}`;
    el.classList.remove('hidden', 'fade');
    this.radioT = 4.5;
  }

  set(id, value) {
    if (this.last[id] === value) return;
    this.last[id] = value;
    $(id).textContent = value;
  }

  update(game, dt) {
    this.set('cash', `$${game.cash.toLocaleString('en-US')}`);
    if (game.bank) this.set('bank-line', `Bank $${Math.round(game.bank.balance).toLocaleString('en-US')}${game.bank.stashTotal() ? ` · Stash $${Math.round(game.bank.stashTotal()).toLocaleString('en-US')}` : ''}`);
    let tier = CRED_TIERS[0];
    for (const t of CRED_TIERS) if (game.cred >= t.min) tier = t;
    this.set('cred-tier', tier.name);
    this.set('cred-value', game.cred.toLocaleString('en-US'));
    const war = game.turfWars.banner() || (game.backup && game.backup.banner()) || game.drugs.banner();
    $('war').textContent = war;
    $('war').classList.toggle('hidden', !war);
    this.set('district', game.turf ? `${game.district} · ${game.turf.name} turf` : game.district);
    const crew = game.crew.following;
    const crewKey = crew.map((m) => `${m.name}${Math.round(m.health / 5)}${m.mode}`).join('|');
    if (this.last.crew !== crewKey) {
      this.last.crew = crewKey;
      $('crew').innerHTML = crew.map((m) => `<div class="crew-row"><span class="nm">${m.name}</span><div class="hb"><div style="width:${Math.max(0, m.health)}%"></div></div><span class="md">${m.heartLabel} · ${m.state === 'inCar' ? 'in car' : m.mode}</span></div>`).join('');
    }

    const starKey = `${game.stars}-${game.searching}`;
    if (this.last.stars !== starKey) {
      this.last.stars = starKey;
      const el = $('stars');
      el.innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="${i < game.stars ? 'on' : ''}">★</span>`).join('');
      el.classList.toggle('flash', game.searching);
    }

    // Losing the police: the meter, and lying low.
    const P = game.pursuit;
    if (P) {
      const share = P.escapeShare();
      const show = game.stars > 0 && (share > 0 || P.lyingLow);
      $('evade').classList.toggle('hidden', !show);
      if (show) {
        $('evade-bar').style.width = `${Math.round(share * 100)}%`;
        $('evade').classList.toggle('low', P.lyingLow);
        this.set('evade-label', P.lyingLow ? 'LYING LOW' : 'LOSING THEM');
      }
    }
    if (this.radioT > 0) {
      this.radioT -= dt;
      if (this.radioT <= 0.4) $('radio').classList.add('fade');
      if (this.radioT <= 0) $('radio').classList.add('hidden');
    }
    if (game.stars === 0 && this.radioT > 0.4) this.radioT = 0.4;

    this.set('prompt', game.prompt || '');
    const v = game.player.vehicle;
    this.set('clock', game.clockLong());
    const mph = v ? Math.round(Math.abs(v.speed) * 2.23694) : 0;
    const lim = v && v.high ? 65 : 45;
    this.set('speed', v ? `${mph} mph${mph > lim ? ` · limit ${lim}` : ''}` : '');

    const prog = $('progress');
    if (game.progress) {
      prog.classList.remove('hidden');
      $('progress-bar').style.width = `${Math.round(game.progress.value * 100)}%`;
      this.set('progress-label', game.progress.label);
    } else prog.classList.add('hidden');

    $('mouse-hint').classList.toggle('hidden', game.input.locked || game.input.mode === 'pad');
    $('pad-status').classList.toggle('hidden', !game.input.padConnected);

    // Weapon, ammo and health.
    const w = game.arsenal.current();
    this.set('weapon-name', w.name);
    if (w.melee) this.set('ammo', '');
    else {
      const am = game.arsenal.ammo[w.id];
      this.set('ammo', CFG.INFINITE_AMMO ? '∞' : game.arsenal.reloadT > 0 ? 'RELOADING' : `${am.mag} / ${am.reserve}`);
    }
    const hp = Math.max(0, Math.round(game.health));
    if (this.last.hp !== hp) {
      this.last.hp = hp;
      const bar = $('health-bar');
      bar.style.width = `${hp}%`;
      bar.style.background = hp > 50 ? '#4cd964' : hp > 25 ? '#ffcc00' : '#ff3b30';
    }
    this.set('product', game.drugs.hudLine());
    const ap = Math.max(0, Math.round(game.armor || 0));
    if (this.last.ap !== ap) {
      this.last.ap = ap;
      $('armor-bar').style.width = `${ap}%`;
    }
    $('crosshair').classList.toggle('hidden', !game.showCrosshair);
    $('crosshair').classList.toggle('locked', !!game.lockTarget);
    this.hitT = Math.max(0, this.hitT - dt);
    if (this.hitT <= 0) $('hitmarker').classList.remove('show');
    this.hurtT = Math.max(0, this.hurtT - dt);
    $('vignette').style.opacity = Math.max(this.hurtT * 2.5, game.health < 30 ? 0.35 : 0).toFixed(2);
    const cm = $('car-marker');
    if (game.carMarker) {
      cm.classList.remove('hidden');
      cm.style.left = `${game.carMarker.x}px`;
      cm.style.top = `${game.carMarker.y}px`;
      this.set('car-marker-text', `YOUR CAR · ${game.carMarker.d} m`);
    } else cm.classList.add('hidden');

    // Phone: clock, notification banner, and the hint with unread count.
    this.set('phone-clock', this.clock());
    if (this.phoneToastT > 0) {
      this.phoneToastT -= dt;
      if (this.phoneToastT <= 0) $('phone-toast').classList.add('hidden');
    }
    const key = game.input.label('phone');
    this.set('phone-hint', this.phoneOpen ? '' : this.unread ? `${key}  Phone · ${this.unread} new` : `${key}  Phone`);
    this.set('phone-foot', game.input.touchMode ? 'Tap to choose, tap again to open · ○ back · 📱 put away' : game.input.mode === 'pad' ? 'D-pad move · ✕ open · ○ back · Create: put away' : 'Arrows move · Enter open · Backspace back · T: put away');
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) $('toast').classList.remove('show');
    }
    this.drawMinimap(game, dt);
  }

  // A pickup game: the score up top, the shot meter, what your buttons do, your energy
  // (streetball.js, gridiron.js). `meter`: a number 0..1 (the green zone at the top), or
  // { v, lo, hi } with the green zone from lo to hi.
  sport(board, meter = null, hint = '', energy = null) {
    let el = this.sportEl;
    if (!board) {
      if (el) el.classList.add('hidden');
      this.sportFloat(null);
      return;
    }
    if (!el) {
      el = this.sportEl = document.createElement('div');
      el.id = 'sport';
      el.innerHTML = '<div class="sb"></div><div class="sm"><div class="sweet"></div><div class="fill"></div></div><div class="sh"></div><div class="se"><span>ENERGY</span><div class="eb"><div class="ef"></div></div></div>';
      document.body.appendChild(el);
    }
    el.classList.remove('hidden');
    el.querySelector('.sb').textContent = board;
    const m = el.querySelector('.sm');
    m.classList.toggle('hidden', meter == null);
    if (meter != null) {
      const M = typeof meter === 'number' ? { v: meter, lo: 0.82, hi: 1 } : meter;
      const f = m.querySelector('.fill');
      const sw = m.querySelector('.sweet');
      f.style.width = `${Math.round(Math.min(1, M.v) * 100)}%`;
      sw.style.left = `${(M.lo * 100).toFixed(1)}%`;
      sw.style.width = `${((M.hi - M.lo) * 100).toFixed(1)}%`;
      f.classList.toggle('good', M.v >= M.lo && M.v <= M.hi);
    }
    el.querySelector('.sh').textContent = hint || '';
    const e = el.querySelector('.se');
    e.classList.toggle('hidden', energy == null);
    if (energy != null) {
      const ef = e.querySelector('.ef');
      ef.style.width = `${Math.round(energy * 100)}%`;
      ef.classList.toggle('low', energy < 0.3);
    }
  }

  // Next to the player (basketball): the shot meter, upright, beside him; his energy, flat,
  // under his feet. `at` has the screen points { mx, my } (beside him) and { ex, ey } (feet).
  sportFloat(at, meter = null, energy = null) {
    let m = this.floatMeter;
    let e = this.floatEnergy;
    if (!m) {
      m = this.floatMeter = document.createElement('div');
      m.id = 'shot-meter';
      m.innerHTML = '<div class="sweet"></div><div class="fill"></div>';
      e = this.floatEnergy = document.createElement('div');
      e.id = 'energy-float';
      e.innerHTML = '<div class="ef"></div>';
      document.body.append(m, e);
    }
    const showM = !!(at && meter);
    const showE = !!(at && energy != null);
    m.classList.toggle('hidden', !showM);
    e.classList.toggle('hidden', !showE);
    if (showM) {
      m.style.left = `${Math.round(at.mx)}px`;
      m.style.top = `${Math.round(at.my)}px`;
      const f = m.querySelector('.fill');
      const sw = m.querySelector('.sweet');
      f.style.height = `${Math.round(Math.min(1, meter.v) * 100)}%`;
      sw.style.bottom = `${(meter.lo * 100).toFixed(1)}%`;
      sw.style.height = `${((meter.hi - meter.lo) * 100).toFixed(1)}%`;
      f.classList.toggle('good', meter.v >= meter.lo && meter.v <= meter.hi);
      // (a perfect release: pop, glow, a shine up the bar and a ring off it; restarts per shot)
      const pk = meter.perfect ? String(meter.perfect) : '';
      if (m.dataset.pk !== pk) {
        m.dataset.pk = pk;
        m.classList.remove('perfect');
        if (pk) {
          void m.offsetWidth;
          m.classList.add('perfect');
        }
      }
    }
    if (showE) {
      e.style.left = `${Math.round(at.ex)}px`;
      e.style.top = `${Math.round(at.ey)}px`;
      const ef = e.querySelector('.ef');
      ef.style.width = `${Math.round(energy * 100)}%`;
      ef.classList.toggle('low', energy < 0.3);
    }
  }

  toast(text, color = '#8ff08f') {
    const el = $('toast');
    el.textContent = text;
    el.style.color = color;
    el.classList.add('show');
    this.toastT = 2.2;
  }

  // Headlines arrive on the player's phone, in one of two apps: City News (the city, politics,
  // money) or Crime Reports (shootings, robberies, arrests, raids, gangs). cat: 'news' | 'crime'
  // (worked out from the headline when not given).
  news(text, kind = 'crime', cat = null) {
    const time = this.clock();
    cat = cat || newsCategory(text, kind);
    const list = $('phone-list');
    const item = document.createElement('div');
    item.className = `news-item ${kind === 'crime' ? '' : kind} cat-${cat}`;
    item.innerHTML = `<div class="news-time">${esc(time)}</div><div>${esc(text)}</div>`;
    list.prepend(item);
    // Keep the latest 30 of each kind.
    const same = [...list.children].filter((el) => el.classList.contains(`cat-${cat}`));
    for (const el of same.slice(30)) el.remove();
    item._kind = kind;
    if (cat === 'crime') this.unreadCrime = (this.unreadCrime || 0) + 1;
    else this.unreadNews = (this.unreadNews || 0) + 1;
    if (!this.phoneOpen) {
      this.unread++;
      $('pt-icon').textContent = cat === 'crime' ? '!' : 'N';
      $('pt-icon').style.background = cat === 'crime' ? '#1f3a93' : '';
      $('pt-app').textContent = cat === 'crime' ? 'CRIME REPORTS' : 'CITY NEWS';
      $('pt-time').textContent = time;
      $('pt-text').textContent = text;
      const toast = $('phone-toast');
      toast.className = `news-${kind}`;
      this.phoneToastT = 4;
    }
    return item;
  }

  // A text message from someone you know (your homies, the plugs). Goes to the Messages app.
  text(from, msg) {
    const time = this.clock();
    this.texts = this.texts || [];
    this.texts.unshift({ from, msg, time });
    if (this.texts.length > 40) this.texts.pop();
    this.unreadTexts = (this.unreadTexts || 0) + 1;
    if (!this.phoneOpen) {
      this.unread++;
      $('pt-icon').textContent = '✉';
      $('pt-icon').style.background = '#34c759';
      $('pt-app').textContent = from.toUpperCase();
      $('pt-time').textContent = time;
      $('pt-text').textContent = msg;
      $('phone-toast').className = 'news-text';
      this.phoneToastT = 4;
    }
  }

  // Give a news story a helicopter video. Shows "processing" until the clip is ready.
  attachClip(item, clip, play) {
    item.clip = clip;
    item.classList.add('has-clip');
    const btn = document.createElement('div');
    btn.className = 'clip-btn';
    btn.textContent = '● Recording footage…';
    item.appendChild(btn);
    clip.onReady = () => {
      btn.textContent = '▶ Watch helicopter footage';
      item.classList.add('ready');
    };
    item.addEventListener('click', play);
    item.style.pointerEvents = 'auto';
  }

  // Stories in the list that's showing (City News or Crime Reports).
  clipItems() {
    const cat = $('phone-list').dataset.cat || 'crime';
    return [...$('phone-list').querySelectorAll(`.news-item.cat-${cat}`)];
  }

  // Scroll the story list (mouse wheel / right stick while the phone is open).
  scrollPhone(px) {
    $('phone-list').scrollTop += px;
  }

  moveClipSelection(dir) {
    const items = this.clipItems();
    if (!items.length) return;
    let k = items.findIndex((el) => el.classList.contains('sel'));
    items.forEach((el) => el.classList.remove('sel'));
    k = k < 0 ? 0 : (k + dir + items.length) % items.length;
    items[k].classList.add('sel');
    items[k].scrollIntoView({ block: 'nearest' });
  }

  selectedClip() {
    const items = this.clipItems();
    const el = items.find((e) => e.classList.contains('sel')) || items.find((e) => e.clip);
    return el && el.clip && el.clip.ready ? el.clip : null;
  }

  togglePhone() {
    this.phoneOpen = !this.phoneOpen;
    $('phone').classList.toggle('open', this.phoneOpen);
    if (this.phoneOpen) {
      this.unread = 0;
      this.phoneToastT = 0;
      $('phone-toast').classList.add('hidden');
    }
  }

  // Toggle crackdowns per gang (the President's orders).
  renderCrackdowns(game) {
    // Approval rating and what's driving it.
    const P = game.president;
    const ap = Math.round(P.approval);
    const t = Math.round(P.target());
    const trend = t > ap + 1 ? '▲' : t < ap - 1 ? '▼' : '';
    const col = ap >= 55 ? '#4cd964' : ap >= 40 ? '#ffcc00' : '#ff3b30';
    const drivers = P.drivers().map(([k, w]) => `<span class="${w > 0 ? 'bad' : 'good'}">${w > 0 ? '▼' : '▲'} ${k}</span>`).join('');
    $('approval').innerHTML = (P.leader ? `<div class="ap-who"><b>${P.title()}</b><span>${P.p.blurb}</span></div>` : '')
      + `<div class="ap-top"><span>Approval</span><b style="color:${col}">${ap}% ${trend}</b><span class="ap-crime">Crime: ${P.levelName()}</span></div>`
      + `<div class="ap-bar"><div style="width:${ap}%;background:${col}"></div></div>`
      + `<div class="ap-why">${drivers || '<span>Quiet lately</span>'}</div>`;
    const T = game.turfWars;
    const box = $('crackdowns');
    box.innerHTML = Object.values(GANGS).filter((g) => !g.hidden).map((g) => {
      const on = !!(T.crackdown || {})[g.id];
      return `<button class="cd ${on ? 'on' : ''}" data-g="${g.id}" style="--gc:${g.color}"><span class="sw"></span>${g.name}${g.id === 'crew' ? ' (you)' : ''}<b>${on ? 'CRACKDOWN' : 'Left alone'}</b></button>`;
    }).join('');
    // The war on drugs: click to step through the levels.
    const M = game.market;
    const lvl = M.war || 0;
    const W = WAR_LEVELS[lvl];
    box.innerHTML += `<button class="cd drugwar lv${lvl}"><span class="sw"></span>War on drugs<b>${W.name.toUpperCase()}</b><i>${W.detail}</i></button>`;
    // The city budget: what the treasury pays for.
    if (game.budget) box.innerHTML += game.budget.html();
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      if (b.classList.contains('budget-auto')) game.budget.toggleAuto();
      else if (b.dataset.line) game.budget.step(b.dataset.line);
      else if (b.classList.contains('drugwar')) {
        M.setWar((lvl + 1) % WAR_LEVELS.length);
        if (game.budget) game.budget.auto = false; // you've taken over the orders
      }
      else {
        T.setCrackdown(b.dataset.g, !T.crackdown[b.dataset.g]);
        if (game.budget) game.budget.auto = false;
      }
      this.renderCrackdowns(game);
    }));
  }

  // Inventory strip (hold L1 / Tab): two weapons, an Ammo tab, cash, and a Drugs tab. An
  // open tab shows its contents in a row above.
  inventoryStrip(game, inv) {
    let el = $('strip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'strip';
      el.className = 'hidden';
      document.getElementById('hud').appendChild(el);
    }
    el.classList.toggle('hidden', !inv.open);
    if (!inv.open) return;
    const ars = game.arsenal;
    const inf = CFG.INFINITE_AMMO;
    const items = inv.items();
    const TOP = inv.constructor.TOP;
    const cap = (k) => k[0].toUpperCase() + k.slice(1);
    const tile = (it, sel) => {
      const s = sel ? ' sel' : '';
      if (it.type === 'weapon') {
        const w = ars.inSlot(it.slot);
        const empty = !ars.slots[it.slot];
        const sub = empty ? 'empty slot' : inf ? '∞' : `${ars.ammo[w.id].mag} / ${ars.ammo[w.id].reserve}`;
        return `<div class="st weap${it.slot === ars.active ? ' cur' : ''}${empty ? ' empty' : ''} r-${w.id}${s}"><div class="st-top">${it.slot + 1}${it.slot === ars.active ? ' · in hand' : ''}</div><div class="st-name">${w.name}</div><div class="st-sub">${sub}</div></div>`;
      }
      if (it.type === 'ammo') return `<div class="st small${it.count ? '' : ' none'}${s}"><div class="st-top">Ammo</div><div class="st-name">${it.name}</div><div class="st-sub">${inf && ars.has(it.id) ? '∞' : it.count}</div></div>`;
      if (it.type === 'cash') return `<div class="st cash${s}"><div class="st-top">Cash</div><div class="st-cash">$${game.cash.toLocaleString('en-US')}</div><div class="st-sub">Armor ${Math.round(game.armor || 0)}</div></div>`;
      return `<div class="st small drug d-${it.kind}${it.count ? '' : ' none'}${s}"><div class="st-top">Drugs</div><div class="st-name">${cap(it.kind)}</div><div class="st-sub">${it.count}</div></div>`;
    };
    const top = TOP.map((t, i) => {
      const here = i === inv.top;
      if (!t.group) return tile(items[t.flat], here && !inv.group);
      const inside = t.items.map((k) => items[k]);
      const total = inside.reduce((n, it) => n + it.count, 0);
      const kinds = inside.filter((it) => it.count > 0).length;
      const open = inv.group === t.group;
      return `<div class="st tab${here && !inv.group ? ' sel' : ''}${open ? ' open' : ''}${total ? '' : ' none'}"><div class="st-top">${t.name} ${open ? '▾' : '▸'}</div><div class="st-name">${kinds} type${kinds === 1 ? '' : 's'}</div><div class="st-sub">${total}</div></div>`;
    }).join('');
    let sub = '';
    if (inv.group) {
      const t = TOP[inv.top];
      sub = `<div class="st-row st-open">${t.items.map((k, j) => tile(items[k], j === inv.sub)).join('')}</div>`;
    }
    el.innerHTML = `${sub}<div class="st-row">${top}</div><div class="st-hint">${inv.hint()}</div>`;
  }

  hitmarker(kill) {
    const el = $('hitmarker');
    el.classList.add('show');
    el.classList.toggle('kill', kill);
    this.hitT = kill ? 0.35 : 0.12;
  }

  hurt() {
    this.hurtT = 0.3;
  }

  wasted(show, detail = '') {
    $('wasted').classList.toggle('hidden', !show);
    $('wasted-detail').textContent = detail;
  }

  pause(show, game) {
    $('pause').classList.toggle('hidden', !show);
    if (show && game) this.renderCrackdowns(game);
  }

  busted(show, detail = '') {
    $('busted').classList.toggle('hidden', !show);
    $('busted-detail').textContent = detail;
  }

  // Round radar: the player arrow stays in the center pointing up and the city rotates around it.
  drawMinimap(game, dt) {
    const ctx = this.map;
    const C = 100;
    const R = 97;
    const city = this.city;
    const [px, pz] = game.player.pos();
    const v = game.player.vehicle;
    const heading = v ? v.heading : game.player.heading;
    // Zoom out when driving fast.
    const wantZoom = v ? 160 + Math.min(120, Math.abs(v.speed) * 4) : 120;
    this.mapZoom += (wantZoom - this.mapZoom) * Math.min(1, (dt || 0.016) * 2);
    const k = R / this.mapZoom; // pixels per meter
    const rot = heading - Math.PI; // turns the player's facing direction to screen-up
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const project = (x, z) => {
      const dx = (x - px) * k;
      const dz = (z - pz) * k;
      return [C + dx * cos - dz * sin, C + dx * sin + dz * cos];
    };
    // Keep important blips on the rim when they're off the radar.
    const rim = ([x, y], pad = 6) => {
      const dx = x - C, dy = y - C;
      const d = Math.hypot(dx, dy);
      const max = R - pad;
      return d > max ? [C + (dx / d) * max, C + (dy / d) * max] : [x, y];
    };
    const inside = ([x, y]) => Math.hypot(x - C, y - C) < R - 4;

    ctx.clearRect(0, 0, 200, 200);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#26402a';
    ctx.fillRect(0, 0, 200, 200);

    // City background, rotated around the player.
    const sb = 1024 / (game.city.size + MARGIN * 2);
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(rot);
    ctx.scale(k / sb, k / sb);
    ctx.drawImage(this.mapBg, -(px + MARGIN) * sb, -(pz + MARGIN) * sb);
    ctx.restore();

    // Gang territories, tinted in each gang's color (the streets around their blocks too).
    // The rival gang's turf pulses when they're at war with you.
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(rot);
    ctx.scale(k, k);
    const allBlocks = game.city.blocks;
    for (const t of game.turfWars.view()) {
      const war = t.gang === 'kings' && game.gang.angry;
      ctx.globalAlpha = war ? 0.33 + 0.15 * Math.sin(performance.now() / 180) : 0.26;
      ctx.fillStyle = t.color;
      fillTurf(ctx, t.blocks, px, pz);
      // Border around the whole area (only the outer edges).
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 2.2 / k;
      strokeTurf(ctx, t.blocks, allBlocks, px, pz);
    }
    // Blocks being fought over flash between the two gangs' colors.
    for (const w of game.turfWars.wars) {
      const b = w.block;
      const on = Math.floor(performance.now() / 300) % 2 === 0;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = on ? GANGS[w.attacker].color : w.defender ? GANGS[w.defender].color : '#ffffff';
      fillBlocks(ctx, [b], px, pz);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // GPS route to the waypoint.
    if (game.gps) {
      ctx.lineJoin = ctx.lineCap = 'round';
      const path = () => {
        ctx.beginPath();
        game.gps.forEach(([x, z], i) => {
          const [sx, sy] = project(x, z);
          if (i) ctx.lineTo(sx, sy);
          else ctx.moveTo(sx, sy);
        });
      };
      path();
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    // Police search area.
    if (game.stars > 0 && game.searching && game.lastKnown) {
      const [sx, sy] = project(game.lastKnown[0], game.lastKnown[1]);
      ctx.strokeStyle = 'rgba(255,80,80,.8)';
      ctx.fillStyle = 'rgba(255,80,80,.15)';
      ctx.beginPath();
      ctx.arc(sx, sy, game.searchRadius * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const st of city.stores) {
      const p = project(st.x, st.z);
      if (!inside(p)) continue;
      ctx.fillStyle = st.cooldown > 0 ? '#666' : '#2ecc71';
      ctx.fillText('$', p[0], p[1]);
    }
    const blip = (x, z, color, text) => {
      const [bx, by] = rim(project(x, z), 8);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px Arial';
      ctx.fillText(text, bx, by + 0.5);
    };
    blip(city.chop.x, city.chop.z, '#e67e22', 'C');
    blip(city.station.x, city.station.z, '#2e6fd8', 'P');
    blip(city.hospital.x, city.hospital.z, '#d63031', 'H');
    blip(city.gangHome.x, city.gangHome.z, '#8e24aa', 'K');
    blip(city.crewHome.x, city.crewHome.z, '#2e7d32', 'G');
    for (const [x, z, col, txt] of game.turfWars.claimMarks()) blip(x, z, col, txt);
    for (const [x, z, col, txt] of [...game.shops.blips(), ...game.drugs.blips()]) blip(x, z, col, txt);
    // Banks, homes and ATMs: only when they're on the radar (not pinned to the rim).
    for (const [x, z, col, txt] of [...game.bank.blips(), ...game.economy.blips()]) if (inside(project(x, z))) blip(x, z, col, txt);
    for (const t of game.bank.atmSpots()) {
      const p = project(t.x, t.z);
      if (!inside(p)) continue;
      ctx.fillStyle = '#5dade2';
      ctx.fillRect(p[0] - 2.5, p[1] - 2.5, 5, 5);
    }
    // Bus stops: only when they're on the radar.
    for (const st of game.transit.shelters()) {
      const p = project(st.sx, st.sz);
      if (inside(p)) drawBusStop(ctx, p[0], p[1], 6);
    }
    const wp = game.mapView.waypoint;
    if (wp) blip(wp[0], wp[1], '#e0b000', 'W');
    const tc = game.testCar;
    if (tc && !tc.removed && !tc.exploded && game.player.vehicle !== tc) {
      const pulse = game.carPingT > 0 && Math.floor(performance.now() / 200) % 2 === 0;
      blip(tc.x, tc.z, pulse ? '#ffffff' : '#1e88e5', 'V');
    }
    // Backup on the way: their car, pinned to the rim if it's off the radar.
    if (game.backup) for (const v of game.backup.cars()) blip(v.x, v.z, '#2ecc71', 'B');
    for (const m of game.crew.following) {
      if (m.state === 'inCar' || !m.alive) continue;
      const q = project(m.x, m.z);
      if (!inside(q)) continue;
      ctx.fillStyle = '#7ee081';
      ctx.beginPath();
      ctx.arc(q[0], q[1], 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const r of game.gang.members) {
      if (!r.alive || !game.gang.angry) continue;
      const q = project(r.x, r.z);
      if (!inside(q)) continue;
      ctx.fillStyle = '#d17bff';
      ctx.beginPath();
      ctx.arc(q[0], q[1], 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const flash = Math.floor(performance.now() / 250) % 2 === 0;
    for (const u of game.police.units) {
      // A patrol car just cruising: a plain blue dot, only when it's on the radar.
      if (u.patrol && !u.car.siren) {
        const [qx, qy] = project(u.car.x, u.car.z);
        if (!inside([qx, qy])) continue;
        ctx.fillStyle = '#3b7bff';
        ctx.beginPath();
        ctx.arc(qx, qy, 3, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const [ux, uy] = rim(project(u.car.x, u.car.z), 4);
      ctx.fillStyle = flash ? '#ff3b3b' : '#3b7bff';
      ctx.beginPath();
      ctx.arc(ux, uy, u.kind === 'swat' ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Gang cars chasing you, in the gang's color.
    for (const r of game.turfWars.rides) {
      if (r.mode !== 'chase' || r.done) continue;
      const g = r.riders[0] && GANGS[r.riders[0].gangId];
      const [cx, cy] = rim(project(r.car.x, r.car.z), 4);
      ctx.fillStyle = g ? g.color : '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // North marker on the rim.
    const nx = C + Math.sin(rot) * (R - 9);
    const ny = C - Math.cos(rot) * (R - 9);
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath();
    ctx.arc(nx, ny, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px Arial';
    ctx.fillText('N', nx, ny + 0.5);

    // Player arrow, always centered and pointing up.
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(C, C - 14);
    ctx.lineTo(C + 10, C + 10);
    ctx.lineTo(C, C + 5);
    ctx.lineTo(C - 10, C + 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Police helicopter, on top (it's above you): a little helicopter pointing where it's
    // flying, rotor spinning, and its searchlight on the ground.
    const heli = game.police.heli;
    if (heli && !heli.removed) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(C, C, R, 0, Math.PI * 2);
      ctx.clip();
      const hp = project(heli.x, heli.z);
      const [hx, hy] = rim(hp, 12);
      if (heli.beam && heli.beam.visible && inside(hp)) {
        const [sx, sy] = project(heli.aim[0], heli.aim[1]);
        drawSearchlight(ctx, hx, hy, sx, sy, Math.max(4, 5 * k), heli.sees);
      }
      const [nx, ny] = project(heli.x + Math.sin(heli.heading), heli.z + Math.cos(heli.heading));
      drawHeli(ctx, hx, hy, Math.atan2(nx - hp[0], -(ny - hp[1])), 1.6);
      ctx.restore();
    }
  }
}
