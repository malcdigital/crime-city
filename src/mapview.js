import { CFG, CRED_TIERS } from './config.js';
import { GANGS } from './turf.js';
import { districtAt, streetAt } from './city.js';
import { clamp, dist } from './util.js';
import { tierOf } from './claim.js';
import { gpsRoute, routeLength } from './gps.js';

// Full-screen city map (touchpad / M). The game pauses while it's open.
// Left stick / WASD / mouse drag pans the cursor, R2 / L2 / wheel zoom, ✕ / click sets or
// clears a waypoint, touchpad / M / ○ / Esc closes.
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
      <div class="bm-help"></div>`;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.info = this.el.querySelector('.bm-info');
    this.open = false;
    this.waypoint = null;
    // Mouse: drag to pan, wheel to zoom, click to set a waypoint.
    let drag = null;
    this.canvas.addEventListener('mousedown', (e) => {
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
    this.el.querySelector('.bm-legend').addEventListener('click', (e) => {
      const r = e.target.closest('.lg-row');
      if (r && +r.dataset.i >= 0) this.jumpTo(+r.dataset.i);
    });
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
    this.setHelp();
    this.legendSel = 0;
    this.legendActive = false;
    this.legendHtml = '';
    this.legend();
    this.draw();
  }

  setHelp() {
    const pad = this.game.input.mode === 'pad';
    const heat = this.heat ? `${this.heat} prices` : 'prices';
    this.el.querySelector('.bm-help').textContent = pad
      ? `Left stick: move · D-pad ↑↓: go to a place · □: ${heat} · R2 / L2: zoom · ✕: waypoint · ○: close`
      : `WASD / drag: move · ↑↓ / legend: go to a place · H: ${heat} · Wheel: zoom · Enter / click: waypoint · M / Esc: close`;
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
    if (heli && !heli.removed) add('blip', '#3b7bff', '✦', 'Police helicopter', heli.x, heli.z);
    return out;
  }

  legend() {
    const entries = this.legendEntries();
    const pickable = entries.filter((e) => !e.head && e.x !== null);
    this.legendSel = Math.min(this.legendSel ?? 0, pickable.length - 1);
    const sel = pickable[this.legendSel];
    const icon = (e) => {
      if (e.kind === 'swatch') return `<span class="lg-sw" style="background:${e.color}"></span>`;
      if (e.kind === 'dot') return `<span class="lg-dot" style="background:${e.color}"></span>`;
      if (e.kind === 'text') return `<span class="lg-tx" style="color:${e.color}">${e.text}</span>`;
      if (e.kind === 'pin') return '<span class="lg-pin"></span>';
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
    for (const [x, z, col, txt] of [...game.shops.blips(), ...game.drugs.blips()]) blip(x, z, col, txt);
    for (const k of game.market.kingpinSpots()) blip(k.x, k.z, '#111', '♛', 10);
    const tc = game.testCar;
    if (tc && !tc.removed && !tc.exploded && game.player.vehicle !== tc) blip(tc.x, tc.z, '#1e88e5', 'V', 9);
    for (const m of game.crew.following) if (m.alive && m.state !== 'inCar') dot(m.x, m.z, 4, '#7ee081');
    const flash = Math.floor(performance.now() / 250) % 2 === 0;
    for (const u of game.police.units) dot(u.car.x, u.car.z, u.kind === 'swat' ? 6 : 5, flash ? '#ff3b3b' : '#3b7bff');
    for (const r of game.turfWars.rides) {
      if (r.mode !== 'chase' || r.done) continue;
      const g = r.riders[0] && GANGS[r.riders[0].gangId];
      dot(r.car.x, r.car.z, 6, g ? g.color : '#fff');
    }
    const heli = game.police.heli;
    if (heli && !heli.removed) blip(heli.x, heli.z, flash ? '#fff' : '#3b7bff', '✦', 8);
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
    if (heat) {
      const base = { weed: 40, pills: 85, coke: 190 }[this.heat];
      ctx.font = 'bold 15px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const d of ['Downtown', 'Hillcrest', 'Southgate', 'Eastside', 'Harbor']) {
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
