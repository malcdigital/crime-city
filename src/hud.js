import { CFG, CRED_TIERS } from './config.js';

const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const $ = (id) => document.getElementById(id);

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
    this.clock = () => '9:00 PM';
    this.last = {};
  }

  show() {
    $('hud').classList.remove('hidden');
  }

  set(id, value) {
    if (this.last[id] === value) return;
    this.last[id] = value;
    $(id).textContent = value;
  }

  update(game, dt) {
    this.set('cash', `$${game.cash.toLocaleString('en-US')}`);
    let tier = CRED_TIERS[0];
    for (const t of CRED_TIERS) if (game.cred >= t.min) tier = t;
    this.set('cred-tier', tier.name);
    this.set('cred-value', game.cred.toLocaleString('en-US'));
    this.set('district', game.district);
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

    this.set('prompt', game.prompt || '');
    const v = game.player.vehicle;
    this.set('speed', v ? `${Math.round(Math.abs(v.speed) * 2.23694)} mph` : '');

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
    this.set('phone-foot', `${key} to put the phone away`);
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) $('toast').classList.remove('show');
    }
    this.drawMinimap(game, dt);
  }

  toast(text, color = '#8ff08f') {
    const el = $('toast');
    el.textContent = text;
    el.style.color = color;
    el.classList.add('show');
    this.toastT = 2.2;
  }

  // City News headlines arrive on the player's phone.
  news(text, kind = 'crime') {
    const time = this.clock();
    const list = $('phone-list');
    const item = document.createElement('div');
    item.className = `news-item ${kind === 'crime' ? '' : kind}`;
    item.innerHTML = `<div class="news-time">${esc(time)}</div><div>${esc(text)}</div>`;
    list.prepend(item);
    while (list.children.length > 30) list.lastChild.remove();
    if (!this.phoneOpen) {
      this.unread++;
      $('pt-time').textContent = time;
      $('pt-text').textContent = text;
      const toast = $('phone-toast');
      toast.className = `news-${kind}`;
      this.phoneToastT = 4;
    }
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

  pause(show) {
    $('pause').classList.toggle('hidden', !show);
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
    const sb = 1024 / (CFG.SIZE + CFG.ROAD * 2);
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(rot);
    ctx.scale(k / sb, k / sb);
    ctx.drawImage(this.mapBg, -(px + CFG.ROAD) * sb, -(pz + CFG.ROAD) * sb);
    ctx.restore();

    // Rival gang turf.
    const gh = city.gangHome;
    const [gx, gy] = project(gh.x, gh.z);
    ctx.fillStyle = game.gang.angry ? 'rgba(200,60,255,.5)' : 'rgba(160,60,220,.35)';
    ctx.beginPath();
    ctx.arc(gx, gy, 22 * k, 0, Math.PI * 2);
    ctx.fill();

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
    blip(gh.x, gh.z, '#8e24aa', 'K');
    blip(city.crewHome.x, city.crewHome.z, '#2e7d32', 'G');
    const tc = game.testCar;
    if (tc && !tc.removed && !tc.exploded && game.player.vehicle !== tc) {
      const pulse = game.carPingT > 0 && Math.floor(performance.now() / 200) % 2 === 0;
      blip(tc.x, tc.z, pulse ? '#ffffff' : '#1e88e5', 'V');
    }
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
      const [ux, uy] = rim(project(u.car.x, u.car.z), 4);
      ctx.fillStyle = flash ? '#ff3b3b' : '#3b7bff';
      ctx.beginPath();
      ctx.arc(ux, uy, 3.5, 0, Math.PI * 2);
      ctx.fill();
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
  }
}
