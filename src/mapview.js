import { DISTRICTS, districtCenter } from './districts.js';
import { drawHeli, drawSearchlight } from './heliicon.js';
import { CFG, CRED_TIERS } from './config.js';
import { GANGS } from './turf.js';
import { districtAt, streetAt } from './city.js';
import { clamp, dist } from './util.js';
import { tierOf } from './claim.js';
import { gpsRoute, routeLength } from './gps.js';

// Full-screen city map (touchpad / M). The game pauses while it's open.
// Left stick / WASD / mouse drag pans the cursor, R2 / L2 / wheel zoom, ✕ / click sets or
// clears a waypoint, touchpad / M / ○ / Esc closes.
// A tiny helicopter for the legend.
const HELI_SVG = '<svg width="18" height="18" viewBox="-10 -10 20 20"><rect x="-0.9" y="2" width="1.8" height="7" fill="#1c2a44" stroke="#fff" stroke-width="1"/><rect x="-2.6" y="7.6" width="5.2" height="1.4" fill="#1c2a44" stroke="#fff" stroke-width="1"/><ellipse cx="0" cy="-0.5" rx="3.6" ry="5" fill="#1c2a44" stroke="#fff" stroke-width="1"/><circle cx="-2.2" cy="1.5" r="1.1" fill="#ff3b3b"/><circle cx="2.2" cy="1.5" r="1.1" fill="#3b7bff"/><path d="M-8 -8L8 8M-8 8L8 -8" stroke="#fff" stroke-width="1.3"/></svg>';

export class MapView {
  constructor(game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'bigmap';
    this.el.className = 'hidden';
    this.el.innerHTML = `
      <canvas></canvas>
      <div class="bm-info"></div>
      <div class="bm-legend"></div>
      <div class="bm-legend-tab">Legend ▸</div>
      <div class="bm-help"></div>`;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    // The legend can be opened and closed (L / △, or click the tab); remembered between visits.
    try {
      this.legendOpen = localStorage.getItem('crimecity.legend') !== 'closed';
    } catch {
      this.legendOpen = true;
    }
    this.el.querySelector('.bm-legend-tab').addEventListener('click', () => this.toggleLegend());
    this.ctx = this.canvas.getContext('2d');
    this.info = this.el.querySelector('.bm-info');
    this.open = false;
    this.waypoint = null;
    // Mouse: drag to pan, wheel to zoom, click to set a waypoint.
    let drag = null;
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.game.input.touchMode) return; // (touch has its own handling below)
      drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    addEventListener('mousemove', (e) => {
      if (!this.open || (!e.movementX && !e.movementY)) return;
      this.mouse = [e.clientX, e.clientY];
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        this.cx -= dx / this.scale;
        this.cz -= dy / this.scale;
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    });
    addEventListener('mouseup', (e) => {
      if (!this.open || !drag) return;
      if (!drag.moved) {
        const [x, z] = this.toWorld(e.clientX, e.clientY);
        this.toggleWaypoint(x, z);
      }
      drag = null;
    });
    // Hovering a legend row highlights its marker on the map.
    this.el.querySelector('.bm-legend').addEventListener('mouseover', (e) => {
      const r = e.target.closest('.lg-row');
      this.rowHover = r && +r.dataset.i >= 0 ? +r.dataset.i : null;
    });
    this.el.querySelector('.bm-legend').addEventListener('mouseleave', () => {
      this.rowHover = null;
    });
    this.el.querySelector('.bm-legend').addEventListener('click', (e) => {
      const r = e.target.closest('.lg-row');
      if (r && +r.dataset.i >= 0) this.jumpTo(+r.dataset.i);
    });
    // Touch: drag with one finger to pan, pinch with two to zoom, tap to set a waypoint.
    const fingers = new Map();
    let tapStart = null;
    let pinch = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      fingers.set(e.pointerId, [e.clientX, e.clientY]);
      tapStart = fingers.size === 1 ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
      pinch = 0;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const f = fingers.get(e.pointerId);
      if (!f || !this.open) return;
      if (fingers.size === 1) {
        this.cx -= (e.clientX - f[0]) / this.scale;
        this.cz -= (e.clientY - f[1]) / this.scale;
        fingers.set(e.pointerId, [e.clientX, e.clientY]);
      } else if (fingers.size === 2) {
        fingers.set(e.pointerId, [e.clientX, e.clientY]);
        const [a, b] = [...fingers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this.zoomAt(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch = d;
      }
    });
    const lift = (e) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.delete(e.pointerId);
      pinch = 0;
      if (tapStart && this.open && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 10 && e.timeStamp - tapStart.t < 450) {
        const [x, z] = this.toWorld(e.clientX, e.clientY);
        this.cursor = [x, z];
        this.toggleWaypoint(x, z);
      }
      tapStart = null;
    };
    this.canvas.addEventListener('pointerup', lift);
    this.canvas.addEventListener('pointercancel', lift);
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    }, { passive: false });
  }

  fit() {
    return Math.min(innerWidth, innerHeight) * 0.9 / (CFG.SIZE + CFG.ROAD * 2);
  }

  show() {
    const game = this.game;
    this.open = true;
    this.el.classList.remove('hidden');
    const [px, pz] = game.player.pos();
    this.cx = CFG.SIZE / 2;
    this.cz = CFG.SIZE / 2;
    this.scale = this.fit();
    this.cursor = [px, pz]; // cursor starts on you
    this.mouse = null;
    if (game.input.locked) game.input.unlock();
    this.applyLegend();
    this.setHelp();
    this.legendSel = 0;
    this.legendActive = false;
    this.legendHtml = '';
    this.legend();
    this.draw();
  }

  toggleLegend() {
    this.legendOpen = !this.legendOpen;
    try {
      localStorage.setItem('crimecity.legend', this.legendOpen ? 'open' : 'closed');
    } catch {
      // Storage unavailable.
    }
    this.applyLegend();
    this.setHelp();
  }

  applyLegend() {
    this.el.querySelector('.bm-legend').classList.toggle('hidden', !this.legendOpen);
    const tab = this.el.querySelector('.bm-legend-tab');
    tab.textContent = this.legendOpen ? 'Hide legend ▴' : 'Legend ▾';
    tab.classList.toggle('open', this.legendOpen);
  }

  setHelp() {
    const pad = this.game.input.mode === 'pad';
    const heat = this.heat ? `${this.heat} prices` : 'prices';
    this.el.querySelector('.bm-help').textContent = pad
      ? `Left stick: move · D-pad ↑↓: go to a place · △: ${this.legendOpen ? 'hide' : 'show'} legend · □: ${heat} · R2 / L2: zoom · ✕: waypoint · ○: close`
      : `WASD / drag: move · ↑↓ / legend: go to a place · L: ${this.legendOpen ? 'hide' : 'show'} legend · H: ${heat} · Wheel: zoom · Enter / click: waypoint · M / Esc: close`;
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  // Everything on the map, grouped. Each entry has a place: picking it in the legend (D-pad
  // ↑ ↓ / arrow keys, or a click) moves the cursor there.
  legendEntries() {
    const game = this.game;
    const city = game.city;
    const T = game.turfWars;
    const S = game.shops;
    const D = game.drugs;
    const [px, pz] = game.player.pos();
    const out = [];
    const head = (t) => out.push({ head: t });
    const add = (kind, color, text, label, x, z) => out.push({ kind, color, text, label, x, z });
    head('You');
    add('you', '#fff', '➤', 'You', px, pz);
    if (this.waypoint) add('pin', '#ffd23f', '', 'Waypoint', ...this.waypoint);
    head('Territories');
    for (const t of T.view()) {
      if (GANGS[t.gang].hidden) continue;
      const hb = T.homeBlock(t.gang) || t.blocks[0];
      const n = t.blocks.length;
      const name = t.gang === 'crew' ? `${t.name} (you)` : t.name;
      if (hb) add('swatch', t.color, '', `${name} · ${n} block${n === 1 ? '' : 's'}`, hb.cx, hb.cz);
      else add('swatch', t.color, '', `${name} · underground`, null, null);
    }
    const free = T.blocks.filter((b) => !T.owner[`${b.i},${b.j}`]).sort((a, b) => dist(a.cx, a.cz, px, pz) - dist(b.cx, b.cz, px, pz));
    if (free.length) add('swatch', '#555', '', `Unclaimed · ${free.length} blocks (nearest)`, free[0].cx, free[0].cz);
    for (const w of T.wars) if (w.state === 'active') add('swatch', '#ff4d4d', '', `Turf war · ${w.street}`, w.block.cx, w.block.cz);
    head('Places');
    add('blip', '#2e7d32', 'G', 'Green Street hangout', city.crewHome.x, city.crewHome.z);
    add('blip', '#8e24aa', 'K', `${GANGS.kings.name} hangout`, city.gangHome.x, city.gangHome.z);
    const vh = T.homeBlock('vipers');
    if (vh) add('blip', '#ff7a1a', 'V', `${GANGS.vipers.name} home`, vh.cx, vh.cz);
    add('blip', '#2e6fd8', 'P', 'Police station', city.station.x, city.station.z);
    add('blip', '#d63031', 'H', 'Hospital', city.hospital.x, city.hospital.z);
    add('blip', '#e67e22', 'C', 'Chop shop (sell cars)', city.chop.x, city.chop.z);
    add('blip', S.gun.color, 'A', `${S.gun.name} (guns, armor)`, S.gun.x, S.gun.z);
    add('blip', S.garage.color, 'M', `${S.garage.name} (mods, respray)`, S.garage.x, S.garage.z);
    add('blip', S.safehouse ? '#2c3e50' : '#7f8c8d', 'S', S.safehouse ? 'Your safehouse' : 'Safehouse (for sale)', S.safe.x, S.safe.z);
    head('Money');
    game.bank.legend(add);
    game.economy.legend(add);
    head('Gang bases');
    game.bases.legend(add);
    head('Business');
    if (S.stash > 0) add('blip', '#27ae60', '$', `Turf stash · $${S.stash.toLocaleString('en-US')}`, S.stashAt.x, S.stashAt.z);
    for (const p of D.plugs) add('blip', p.dead ? '#555' : '#6c3483', 'D', p.dead ? `Plug (${p.product}): dead, replaced soon` : `Plug: ${p.name} (${p.product})`, p.x, p.z);
    for (const k of game.market.kingpinSpots()) add('blip', '#111', '♛', `${GANGS[k.g].name} kingpin`, k.x, k.z);
    for (const st of city.stores) add('text', st.cooldown > 0 ? '#777' : '#2ecc71', '$', `${st.name} (rob it)${st.cooldown > 0 ? ' · robbed' : ''}`, st.x, st.z);
    for (const [x, z, col, txt] of T.claimMarks()) add('blip', col, txt, txt === 'T' ? 'Claim: wall to tag' : 'Claim: shop owner', x, z);
    const cops = game.police.units;
    const heli = game.police.heli;
    if (cops.length || (heli && !heli.removed)) head('Police');
    if (cops.length) {
      const u = [...cops].sort((a, b) => dist(a.car.x, a.car.z, px, pz) - dist(b.car.x, b.car.z, px, pz))[0];
      add('dot', '#ff3b3b', '', `Police units · ${cops.length} (nearest)`, u.car.x, u.car.z);
    }
    if (heli && !heli.removed) add('heli', '#3b7bff', '', heli.sees ? 'Police helicopter · has you in the light' : 'Police helicopter · searching', heli.x, heli.z);
    return out;
  }

  legend() {
    const entries = this.legendEntries();
    const pickable = entries.filter((e) => !e.head && e.x !== null);
    this.entries = entries;
    this.legendSel = Math.min(this.legendSel ?? 0, pickable.length - 1);
    const sel = pickable[this.legendSel];
    const icon = (e) => {
      if (e.kind === 'swatch') return `<span class="lg-sw" style="background:${e.color}"></span>`;
      if (e.kind === 'dot') return `<span class="lg-dot" style="background:${e.color}"></span>`;
      if (e.kind === 'text') return `<span class="lg-tx" style="color:${e.color}">${e.text}</span>`;
      if (e.kind === 'pin') return '<span class="lg-pin"></span>';
      if (e.kind === 'heli') return '<span class="lg-heli">' + HELI_SVG + '</span>';
      if (e.kind === 'you') return '<span class="lg-you">▲</span>';
      return `<span class="lg-bl" style="background:${e.color}">${e.text}</span>`;
    };
    const html = entries.map((e) => {
      if (e.head) return `<div class="lg-head">${e.head}</div>`;
      const i = pickable.indexOf(e);
      return `<div class="lg-row${e === sel && this.legendActive ? ' sel' : ''}${i < 0 ? ' off' : ''}" data-i="${i}">${icon(e)}<span class="lg-l">${e.label}</span></div>`;
    }).join('');
    if (html !== this.legendHtml) {
      this.legendHtml = html;
      const box = this.el.querySelector('.bm-legend');
      box.innerHTML = html;
      box.querySelector('.lg-row.sel')?.scrollIntoView({ block: 'nearest' });
    }
    this.pickable = pickable;
  }

  // Jump the cursor (and the view) to a legend entry.
  jumpTo(i) {
    const e = this.pickable && this.pickable[i];
    if (!e) return;
    this.legendSel = i;
    this.legendActive = true;
    this.cursor = [e.x, e.z];
    this.cx = e.x;
    this.cz = e.z;
    this.mouse = null;
  }

  // Keep the city centered on screen when it fits; when zoomed in, don't scroll past its edges.
  clampView() {
    const lo = -CFG.ROAD;
    const hi = CFG.SIZE + CFG.ROAD;
    const mid = (lo + hi) / 2;
    const fitAxis = (c, screen) => {
      const half = screen / 2 / this.scale;
      if (hi - lo <= half * 2) return mid;
      return clamp(c, lo + half, hi - half);
    };
    this.cx = fitAxis(this.cx, innerWidth);
    this.cz = fitAxis(this.cz, innerHeight);
  }

  toWorld(sx, sy) {
    return [this.cx + (sx - innerWidth / 2) / this.scale, this.cz + (sy - innerHeight / 2) / this.scale];
  }

  toScreen(x, z) {
    return [innerWidth / 2 + (x - this.cx) * this.scale, innerHeight / 2 + (z - this.cz) * this.scale];
  }

  zoomAt(f, sx, sy) {
    const [wx, wz] = this.toWorld(sx, sy);
    this.scale = clamp(this.scale * f, this.fit(), this.fit() * 6);
    // Keep the point under the mouse where it was.
    this.cx = wx - (sx - innerWidth / 2) / this.scale;
    this.cz = wz - (sy - innerHeight / 2) / this.scale;
  }

  toggleWaypoint(x, z) {
    const w = this.waypoint;
    if (w && dist(w[0], w[1], x, z) < 20 / Math.max(0.5, this.scale)) this.waypoint = null;
    else this.waypoint = [clamp(x, -CFG.ROAD, CFG.SIZE + CFG.ROAD), clamp(z, -CFG.ROAD, CFG.SIZE + CFG.ROAD)];
  }

  update(dt, a) {
    const game = this.game;
    // Cursor: the stick (or WASD) moves it; the view follows when it nears the edge.
    if (this.mouse && game.input.mode !== 'pad') this.cursor = this.toWorld(...this.mouse);
    // The legend: step through the places on the map; the cursor jumps to each.
    if (a.phoneUp || a.phoneDown) {
      if (!this.legendOpen) this.toggleLegend(); // stepping through places opens it
      const n = (this.pickable || []).length;
      if (n) this.jumpTo(this.legendActive ? (this.legendSel + (a.phoneDown ? 1 : -1) + n) % n : 0);
    }
    const mx = a.moveX;
    const my = -(a.moveY - (a.arrowY || 0)); // arrow keys are for the legend here
    if (mx || my) {
      this.mouse = null;
      this.legendActive = false;
      const sp = 520 / this.scale; // screen pixels per second, in world units
      this.cursor[0] = clamp(this.cursor[0] + mx * sp * dt, -CFG.ROAD, CFG.SIZE + CFG.ROAD);
      this.cursor[1] = clamp(this.cursor[1] + my * sp * dt, -CFG.ROAD, CFG.SIZE + CFG.ROAD);
      const [sx, sy] = this.toScreen(...this.cursor);
      const m = 120;
      if (sx < m) this.cx -= (m - sx) / this.scale;
      if (sx > innerWidth - m) this.cx += (sx - innerWidth + m) / this.scale;
      if (sy < m) this.cz -= (m - sy) / this.scale;
      if (sy > innerHeight - m) this.cz += (sy - innerHeight + m) / this.scale;
    }
    if (a.mapLegend) this.toggleLegend();
    // □ / H: cycle the drug price heat map (off → weed → pills → coke).
    if (a.mapHeat) {
      const order = [null, 'weed', 'pills', 'coke'];
      this.heat = order[(order.indexOf(this.heat || null) + 1) % order.length];
      this.setHelp();
    }
    const zoom = game.input.btnVal(7) - game.input.btnVal(6);
    if (Math.abs(zoom) > 0.1) this.zoomAt(Math.exp(zoom * dt * 2), ...this.toScreen(...this.cursor));
    if (a.mapWaypoint) this.toggleWaypoint(...this.cursor);
    this.draw();
  }

  draw() {
    const game = this.game;
    const city = game.city;
    const c = this.canvas;
    if (c.width !== innerWidth || c.height !== innerHeight) {
      c.width = innerWidth;
      c.height = innerHeight;
    }
    this.clampView();
    const ctx = this.ctx;
    const s = this.scale;
    ctx.fillStyle = '#1d2b1f';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(innerWidth / 2, innerHeight / 2);
    ctx.scale(s, s);
    ctx.translate(-this.cx, -this.cz);
    // City background (same picture as the minimap).
    const bg = game.hud.mapBg;
    const span = CFG.SIZE + CFG.ROAD * 2;
    ctx.drawImage(bg, -CFG.ROAD, -CFG.ROAD, span, span);
    // Turf.
    const half = CFG.ROAD / 2;
    for (const t of game.turfWars.view()) {
      ctx.globalAlpha = 0.33;
      ctx.fillStyle = t.color;
      for (const b of t.blocks) ctx.fillRect(b.minX - half, b.minZ - half, b.maxX - b.minX + CFG.ROAD, b.maxZ - b.minZ + CFG.ROAD);
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 2.5 / s;
      const has = (i, j) => t.blocks.some((o) => o.i === i && o.j === j);
      ctx.beginPath();
      for (const b of t.blocks) {
        const x0 = b.minX - half, x1 = b.maxX + half, z0 = b.minZ - half, z1 = b.maxZ + half;
        if (!has(b.i - 1, b.j)) { ctx.moveTo(x0, z0); ctx.lineTo(x0, z1); }
        if (!has(b.i + 1, b.j)) { ctx.moveTo(x1, z0); ctx.lineTo(x1, z1); }
        if (!has(b.i, b.j - 1)) { ctx.moveTo(x0, z0); ctx.lineTo(x1, z0); }
        if (!has(b.i, b.j + 1)) { ctx.moveTo(x0, z1); ctx.lineTo(x1, z1); }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.55;
    for (const w of game.turfWars.wars) {
      const b = w.block;
      const def = w.defender || w.responder;
      ctx.fillStyle = Math.floor(performance.now() / 300) % 2 ? GANGS[w.attacker].color : def ? GANGS[def].color : '#fff';
      ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    }
    ctx.globalAlpha = 1;
    // Drug price heat (cycle with □ / H): blue = cheap there, red = sells high.
    const heat = this.heat ? game.market : null;
    if (heat) {
      for (const b of game.turfWars.blocks) {
        const m = heat.mult(districtAt(b.cx, b.cz), this.heat);
        const k = clamp((m - 0.6) / 1.1, 0, 1);
        ctx.fillStyle = `hsla(${Math.round(220 - k * 220)}, 90%, 50%, 0.62)`;
        ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
      }
    }
    // Hovered block outline.
    const hb = game.turfWars.blockAt(...this.cursor);
    if (hb) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.strokeRect(hb.minX, hb.minZ, hb.maxX - hb.minX, hb.maxZ - hb.minZ);
      ctx.setLineDash([]);
    }
    // Police search area.
    if (game.stars > 0 && game.searching && game.lastKnown) {
      ctx.fillStyle = 'rgba(255,80,80,.15)';
      ctx.strokeStyle = 'rgba(255,80,80,.8)';
      ctx.lineWidth = 2 / s;
      ctx.beginPath();
      ctx.arc(game.lastKnown[0], game.lastKnown[1], game.searchRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // Icons, drawn at screen size.
    const dot = (x, z, r, fill) => {
      const [sx, sy] = this.toScreen(x, z);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const blip = (x, z, color, text, r = 11) => {
      const [sx, sy] = this.toScreen(x, z);
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.1)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, sx, sy + 0.5);
    };
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const st of city.stores) {
      const [sx, sy] = this.toScreen(st.x, st.z);
      ctx.fillStyle = st.cooldown > 0 ? '#777' : '#2ecc71';
      ctx.fillText('$', sx, sy);
    }
    blip(city.chop.x, city.chop.z, '#e67e22', 'C');
    blip(city.station.x, city.station.z, '#2e6fd8', 'P');
    blip(city.hospital.x, city.hospital.z, '#d63031', 'H');
    blip(city.gangHome.x, city.gangHome.z, '#8e24aa', 'K');
    blip(city.crewHome.x, city.crewHome.z, '#2e7d32', 'G');
    for (const [x, z, col, txt] of game.turfWars.claimMarks()) blip(x, z, col, txt, 9);
    for (const [x, z, col, txt] of [...game.shops.blips(), ...game.drugs.blips(), ...game.bank.blips(), ...game.economy.blips(), ...game.bases.blips()]) blip(x, z, col, txt);
    for (const t of game.bank.atmSpots()) dot(t.x, t.z, 4, '#5dade2');
    for (const k of game.market.kingpinSpots()) blip(k.x, k.z, '#111', '♛', 10);
    const tc = game.testCar;
    if (tc && !tc.removed && !tc.exploded && game.player.vehicle !== tc) blip(tc.x, tc.z, '#1e88e5', 'V', 9);
    for (const m of game.crew.following) if (m.alive && m.state !== 'inCar') dot(m.x, m.z, 4, '#7ee081');
    for (const v of game.backup.cars()) blip(v.x, v.z, '#2ecc71', 'B', 9);
    const flash = Math.floor(performance.now() / 250) % 2 === 0;
    for (const u of game.police.units) dot(u.car.x, u.car.z, u.kind === 'swat' ? 6 : 5, flash ? '#ff3b3b' : '#3b7bff');
    for (const r of game.turfWars.rides) {
      if (r.mode !== 'chase' || r.done) continue;
      const g = r.riders[0] && GANGS[r.riders[0].gangId];
      dot(r.car.x, r.car.z, 6, g ? g.color : '#fff');
    }
    // GPS route, then the waypoint pin.
    this.route = this.waypoint ? gpsRoute(city, ...game.player.pos(), ...this.waypoint) : null;
    if (this.route) {
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      this.route.forEach(([x, z], i) => {
        const [sx, sy] = this.toScreen(x, z);
        if (i) ctx.lineTo(sx, sy);
        else ctx.moveTo(sx, sy);
      });
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = Math.max(6, s * 4 + 3);
      ctx.stroke();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = Math.max(3.5, s * 4);
      ctx.stroke();
    }
    if (this.waypoint) {
      const [wx, wy] = this.toScreen(...this.waypoint);
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx - 9, wy - 16);
      ctx.arc(wx, wy - 18, 9, Math.PI * 0.85, Math.PI * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // You: an arrow pointing the way you face.
    {
      const [px, pz] = game.player.pos();
      const v = game.player.vehicle;
      const h = v ? v.heading : game.player.heading;
      const [sx, sy] = this.toScreen(px, pz);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-h + Math.PI);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(8, 9);
      ctx.lineTo(0, 4);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // Police helicopter on top (it's above everything).
    const heli = game.police.heli;
    if (heli && !heli.removed) {
      const [hx, hy] = this.toScreen(heli.x, heli.z);
      if (heli.beam && heli.beam.visible) {
        const [sx, sy] = this.toScreen(heli.aim[0], heli.aim[1]);
        drawSearchlight(ctx, hx, hy, sx, sy, Math.max(4, 5 * this.scale), heli.sees);
      }
      drawHeli(ctx, hx, hy, Math.PI - heli.heading, Math.max(1.5, Math.min(2.4, this.scale * 2)));
    }
    // Cursor.
    {
      const [sx, sy] = this.toScreen(...this.cursor);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.moveTo(sx - 16, sy);
      ctx.lineTo(sx - 6, sy);
      ctx.moveTo(sx + 6, sy);
      ctx.lineTo(sx + 16, sy);
      ctx.moveTo(sx, sy - 16);
      ctx.lineTo(sx, sy - 6);
      ctx.moveTo(sx, sy + 6);
      ctx.lineTo(sx, sy + 16);
      ctx.stroke();
    }
    if (!heat) {
      // District names, faint, so you can tell where you are.
      ctx.font = `800 ${Math.round(Math.max(11, Math.min(20, this.scale * 30)))}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      for (const d of DISTRICTS) {
        const [sx, sy] = this.toScreen(...districtCenter(d));
        ctx.fillText(d.toUpperCase(), sx, sy);
      }
    }
    if (heat) {
      const base = { weed: 40, pills: 85, coke: 190 }[this.heat];
      ctx.font = 'bold 15px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const d of DISTRICTS) {
        const [sx, sy] = this.toScreen(...heat.center(d));
        const t = `${d} $${Math.round(base * heat.mult(d, this.heat))} ${heat.trend(d, this.heat)}`;
        const w = ctx.measureText(t).width + 14;
        ctx.fillStyle = 'rgba(0,0,0,.75)';
        ctx.fillRect(sx - w / 2, sy - 12, w, 24);
        ctx.fillStyle = '#fff';
        ctx.fillText(t, sx, sy);
      }
    }
    this.info.innerHTML = this.blockInfo(hb);
    this.legend();
    this.drawHover(ctx);
  }

  // Hovering a marker (the mouse, or the controller's cursor) or a legend row: the marker grows
  // and a label says what it is.
  drawHover(ctx) {
    const entries = (this.entries || []).filter((e) => !e.head && e.x != null);
    let hit = null;
    if (this.rowHover != null && this.pickable && this.pickable[this.rowHover]) hit = this.pickable[this.rowHover];
    else {
      const [mx, my] = this.mouse || this.toScreen(...this.cursor);
      let best = 15;
      for (const e of entries) {
        const [sx, sy] = this.toScreen(e.x, e.z);
        // Territories (big areas) only win if nothing else is there.
        const d = Math.hypot(sx - mx, sy - my) + (e.kind === 'swatch' ? 8 : 0);
        if (d < best) {
          best = d;
          hit = e;
        }
      }
    }
    this.hovered = hit;
    if (!hit) return;
    const [sx, sy] = this.toScreen(hit.x, hit.z);
    const r = 17;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = hit.kind === 'you' || hit.kind === 'pin' ? '#ffd23f' : hit.kind === 'heli' ? '#3b7bff' : hit.color || '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    const glyph = hit.kind === 'you' ? '▲' : hit.kind === 'heli' ? '✈' : hit.kind === 'pin' ? '★' : hit.text || '';
    ctx.fillStyle = hit.kind === 'text' ? '#000' : '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, sx, sy + 1);
    // The label, above the marker (kept on screen).
    ctx.font = '600 13px Arial';
    const w = ctx.measureText(hit.label).width + 18;
    const bx = Math.max(8, Math.min(innerWidth - w - 8, sx - w / 2));
    const by = sy - r - 34 < 8 ? sy + r + 8 : sy - r - 34;
    ctx.fillStyle = 'rgba(10,12,16,.92)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, by, w, 26, 6) : ctx.rect(bx, by, w, 26);
    ctx.fill();
    ctx.strokeStyle = hit.color || '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(hit.label, bx + 9, by + 13.5);
    ctx.restore();
  }

  // What's on the block under the cursor.
  blockInfo(b) {
    const [x, z] = this.cursor;
    const T = this.game.turfWars;
    const lines = [`<b>${streetAt(x, z)}</b> · ${districtAt(x, z)}`];
    if (b) {
      const k = `${b.i},${b.j}`;
      const g = T.owner[k];
      const w = T.warOn(k);
      if (g) lines.push(`<span style="color:${GANGS[g].color}">${GANGS[g].name}</span> turf${T.home[g] === k ? ' · <b>home block</b>' : ''}`);
      else if (b.type === 'police' || b.type === 'hospital') lines.push('Off limits');
      else lines.push('Unclaimed');
      if (w) lines.push(`<span class="bm-war">Turf war going on here</span>`);
      else if (T.locked(k)) lines.push(`Locked for ${Math.ceil((T.lock[k] - Date.now()) / 60000)} min`);
      else if (!g && T.byKey[k]) {
        const need = T.claimNeed();
        const ok = tierOf(this.game.cred) >= need || CFG.CLAIM_IGNORE_CRED;
        lines.push(ok ? 'You can claim this block' : `Claiming needs ${CRED_TIERS[need].name} cred`);
      } else if (g && g !== 'crew') lines.push('Kill 3 of theirs here to start a war');
    }
    if (this.route) lines.push(`Waypoint ${Math.round(routeLength(this.route))} m by road`);
    return lines.map((l) => `<div>${l}</div>`).join('');
  }
}
