import { CFG, CRED_TIERS } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(city) {
    this.city = city;
    this.mapBg = document.createElement('canvas');
    this.mapBg.width = this.mapBg.height = 200;
    city.drawMap(this.mapBg.getContext('2d'), 200);
    this.map = $('minimap').getContext('2d');
    this.toastT = 0;
    this.newsHidden = false;
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

    const starKey = `${game.stars}-${game.searching}`;
    if (this.last.stars !== starKey) {
      this.last.stars = starKey;
      const el = $('stars');
      el.innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="${i < game.stars ? 'on' : ''}">★</span>`).join('');
      el.classList.toggle('flash', game.searching);
    }

    this.set('prompt', game.prompt || '');
    const v = game.player.vehicle;
    this.set('speed', v ? `${Math.round(Math.abs(v.speed) * 3.6)} km/h` : '');

    const prog = $('progress');
    if (game.progress) {
      prog.classList.remove('hidden');
      $('progress-bar').style.width = `${Math.round(game.progress.value * 100)}%`;
      this.set('progress-label', game.progress.label);
    } else prog.classList.add('hidden');

    $('mouse-hint').classList.toggle('hidden', game.input.locked);

    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) $('toast').classList.remove('show');
    }
    this.drawMinimap(game);
  }

  toast(text, color = '#8ff08f') {
    const el = $('toast');
    el.textContent = text;
    el.style.color = color;
    el.classList.add('show');
    this.toastT = 2.2;
  }

  news(text, kind = 'crime') {
    const list = $('news-list');
    const item = document.createElement('div');
    item.className = `news-item ${kind === 'crime' ? '' : kind}`;
    item.textContent = text;
    list.prepend(item);
    while (list.children.length > 5) list.lastChild.remove();
  }

  toggleNews() {
    this.newsHidden = !this.newsHidden;
    $('news').classList.toggle('hidden', this.newsHidden);
  }

  busted(show, detail = '') {
    $('busted').classList.toggle('hidden', !show);
    $('busted-detail').textContent = detail;
  }

  drawMinimap(game) {
    const ctx = this.map;
    const px = 200;
    const s = px / (CFG.SIZE + CFG.ROAD * 2);
    const o = CFG.ROAD;
    const X = (x) => (x + o) * s;
    ctx.drawImage(this.mapBg, 0, 0);
    const city = this.city;

    // Search area while the police are looking for you.
    if (game.stars > 0 && game.searching && game.lastKnown) {
      ctx.strokeStyle = 'rgba(255,80,80,.8)';
      ctx.fillStyle = 'rgba(255,80,80,.15)';
      ctx.beginPath();
      ctx.arc(X(game.lastKnown[0]), X(game.lastKnown[1]), 40 * s * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (const st of city.stores) {
      ctx.fillStyle = st.cooldown > 0 ? '#555' : '#2ecc71';
      ctx.font = 'bold 11px Arial';
      ctx.fillText('$', X(st.x) - 3, X(st.z) + 4);
    }
    ctx.fillStyle = '#f39c12';
    ctx.fillRect(X(city.chop.x) - 3, X(city.chop.z) - 3, 6, 6);
    ctx.fillStyle = '#5dade2';
    ctx.fillRect(X(city.station.x) - 3, X(city.station.z) - 3, 6, 6);

    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const u of game.police.units) {
      ctx.fillStyle = blink ? '#ff3b3b' : '#3b7bff';
      ctx.beginPath();
      ctx.arc(X(u.car.x), X(u.car.z), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player arrow.
    const [x, z] = game.player.pos();
    const h = game.player.vehicle ? game.player.vehicle.heading : game.player.heading;
    ctx.save();
    ctx.translate(X(x), X(z));
    ctx.rotate(-h);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(4, -4);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
