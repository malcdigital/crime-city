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
    this.el.querySelector('.bm-help').textContent = game.input.mode === 'pad'
      ? 'Left stick: move · R2 / L2: zoom · ✕: set waypoint · Touchpad / ○: close'
      : 'Drag: move · Wheel: zoom · Click: set waypoint · M / Esc: close';
    this.legend();
    this.draw();
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  legend() {
    const row = (c, t) => `<div><span style="background:${c}"></span>${t}</div>`;
    this.el.querySelector('.bm-legend').innerHTML = [
      ...Object.values(GANGS).filter((g) => !g.hidden).map((g) => row(g.color, g.id === 'crew' ? `${g.name} (you)` : g.name)),
      row('#555', 'Unclaimed'),
      row('#ffd23f', 'Waypoint'),
    ].join('');
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
    const mx = a.moveX;
    const my = -a.moveY;
    if (mx || my) {
      this.mouse = null;
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
    this.info.innerHTML = this.blockInfo(hb);
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
