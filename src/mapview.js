import { COURT_SITES } from './court.js';
import { FIELD_SITE } from './field.js';
import { PARK_SITE } from './playground.js';
import { fillTurf, strokeTurf, fillBlocks, strokeBlock } from './turfdraw.js';
const MARGIN = 0; // (the map is the whole world)
import { DISTRICTS, districtCenter } from './districts.js';
import { drawHeli, drawSearchlight } from './heliicon.js';
import { CFG, CRED_TIERS } from './config.js';
import { PHONE } from './quality.js';
import { GANGS } from './turf.js';
import { districtAt, streetAt } from './city.js';
import { clamp, dist } from './util.js';
import { tierOf } from './claim.js';
import { gpsRoute, routeLength } from './gps.js';
import { setRich, blipText, iconSVG, drawMapIcon } from './icons.js';
import { MapArt, LOD } from './mapart.js';

// Full-screen city map (touchpad / M). The game pauses while it's open.
// Left stick / WASD / mouse drag pans the cursor, R2 / L2 / wheel zoom, ✕ / click sets or
// clears a waypoint, touchpad / M / ○ / Esc closes.
// A bus stop marker: a little orange sign with a white bus front on it (map and radar).
export function drawBusStop(ctx, x, y, r = 7) {
  ctx.fillStyle = '#f39c12';
  ctx.strokeStyle = 'rgba(0,0,0,.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.35);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - r * 0.55, y - r * 0.6, r * 1.1, r * 0.95); // body
  ctx.fillStyle = '#f39c12';
  ctx.fillRect(x - r * 0.4, y - r * 0.45, r * 0.8, r * 0.35); // windscreen
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - r * 0.5, y + r * 0.35, r * 0.25, r * 0.3); // wheels
  ctx.fillRect(x + r * 0.25, y + r * 0.35, r * 0.25, r * 0.3);
}
const BUS_ICON = '<span class="lg-bus"><svg viewBox="0 0 14 14" width="14" height="14"><rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="#f39c12" stroke="rgba(0,0,0,.6)"/><rect x="3" y="2.6" width="8" height="6.6" fill="#fff"/><rect x="4" y="3.6" width="6" height="2.4" fill="#f39c12"/><rect x="3.4" y="9.4" width="1.8" height="2" fill="#fff"/><rect x="8.8" y="9.4" width="1.8" height="2" fill="#fff"/></svg></span>';

// A tiny helicopter for the legend.
const HELI_SVG = '<svg width="18" height="18" viewBox="-10 -10 20 20"><rect x="-0.9" y="2" width="1.8" height="7" fill="#1c2a44" stroke="#fff" stroke-width="1"/><rect x="-2.6" y="7.6" width="5.2" height="1.4" fill="#1c2a44" stroke="#fff" stroke-width="1"/><ellipse cx="0" cy="-0.5" rx="3.6" ry="5" fill="#1c2a44" stroke="#fff" stroke-width="1"/><circle cx="-2.2" cy="1.5" r="1.1" fill="#ff3b3b"/><circle cx="2.2" cy="1.5" r="1.1" fill="#3b7bff"/><path d="M-8 -8L8 8M-8 8L8 -8" stroke="#fff" stroke-width="1.3"/></svg>';

// Quick-find chips along the top: one tap routes to the nearest. [key, name, icon, color]
const CHIPS = [['gun', 'Gun shop', 'gun', '#c0392b'], ['safe', 'Safehouse', 'safe', '#2c3e50'], ['plug', 'Plug', 'plug', '#6c3483'], ['store', 'Store', '$', '#1f8f4e'], ['bank', 'Bank', 'bank', '#1e8449']];

// The layers you can switch off (in the legend, 1-6 on a keyboard).
const LAYERS = [['turf', 'Turf (gangs, bases, claims)'], ['shops', 'Shops (guns, garage, chop shop, stores)'], ['business', 'Business (plugs, stash, kingpins)'], ['money', 'Money (banks, ATMs, homes, companies)'], ['transit', 'Bus stops'], ['police', 'Police']];

export class MapView {
  constructor(game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'bigmap';
    this.el.className = 'hidden';
    this.el.innerHTML = `
      <canvas></canvas>
      <div class="bm-info"></div>
      <div class="bm-legend"><div class="bm-sheet-head"><span>Legend</span><button class="bm-sheet-x" aria-label="Close legend">✕</button></div><div class="bm-legend-list"></div></div>
      <div class="bm-legend-tab">Legend ▸</div>
      <div class="bm-chips">${CHIPS.map(([k, name, ic, col]) => `<button class="bm-chip" data-k="${k}"><span class="bm-chip-ic" style="background:${col}">${iconSVG(ic, 13) || ic}</span>${name}</button>`).join('')}</div>
      <div class="bm-corner">
        <button class="bm-btn bm-close" aria-label="Close map">✕</button>
        <button class="bm-btn bm-me" aria-label="Center on me"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg></button>
        <button class="bm-btn bm-leg" aria-label="Legend"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r="1.3" fill="currentColor"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor"/><circle cx="4.5" cy="17.5" r="1.3" fill="currentColor"/></svg></button>
      </div>
      <div class="bm-card hidden"></div>
      <div class="bm-help"></div>`;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    // The map itself (mapart.js); the radar gets the same picture, sharper.
    this.art = new MapArt(game);
    {
      const bg = game.hud.mapBg;
      bg.width = bg.height = PHONE ? 1536 : 2048;
      const g = bg.getContext('2d');
      const k = bg.width / 1600;
      g.save();
      g.scale(k, k);
      this.art.draw(g, k, { lod: 1 });
      g.restore();
    }
    // Layers you can switch off (the legend's first rows; 1-6 on a keyboard): remembered.
    this.layers = { turf: true, shops: true, business: true, money: true, transit: true, police: true };
    try {
      Object.assign(this.layers, JSON.parse(localStorage.getItem('crimecity.maplayers') || '{}'));
    } catch {
      // Storage unavailable.
    }
    // The legend can be opened and closed (L / △, or click the tab); remembered between visits.
    try {
      this.legendOpen = localStorage.getItem('crimecity.legend') !== 'closed';
    } catch {
      this.legendOpen = true;
    }
    this.el.querySelector('.bm-legend-tab').addEventListener('click', () => this.toggleLegend());
    this.el.querySelector('.bm-sheet-x').addEventListener('click', () => this.legendOpen && this.toggleLegend());
    this.el.querySelector('.bm-close').addEventListener('click', () => this.hide());
    this.el.querySelector('.bm-me').addEventListener('click', () => this.recenter());
    this.el.querySelector('.bm-leg').addEventListener('click', () => this.toggleLegend());
    this.el.querySelector('.bm-chips').addEventListener('click', (e) => {
      const b = e.target.closest('.bm-chip');
      if (b) this.quickFind(b.dataset.k);
    });
    this.el.querySelector('.bm-card').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) this.cardAction(b.dataset.a);
    });
    this.ctx = this.canvas.getContext('2d');
    this.info = this.el.querySelector('.bm-info');
    this.open = false;
    this.waypoint = null;
    // Mouse: drag to pan, wheel to zoom, click to set a waypoint.
    let drag = null;
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.game.input.touchMode) return; // (touch has its own handling below)
      drag = { x: e.clientX, y: e.clientY, moved: false };
      this.tween = null;
    });
    addEventListener('mousemove', (e) => {
      if (!this.open || (!e.movementX && !e.movementY)) return;
      this.mouse = [e.clientX, e.clientY];
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) {
        this.tween = null;
        this.cx -= dx / this.scale;
        this.cz -= dy / this.scale;
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    });
    addEventListener('mouseup', (e) => {
      if (!this.open || !drag) return;
      if (!drag.moved && e.target === this.canvas) this.tapAt(e.clientX, e.clientY, 15);
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
      if (r && +r.dataset.i >= 0) {
        const e = this.pickable?.[+r.dataset.i];
        if (e?.kind === 'layer') this.toggleLayer(e.key);
        else if (e?.kind === 'heat') this.cycleHeat();
        else {
          this.jumpTo(+r.dataset.i);
          // (on a phone the sheet covers the map: it slides away and the place's card comes up)
          if (this.compact && e) {
            this.toggleLegend();
            if (e.kind !== 'you') this.openCard(e);
          }
        }
      }
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
      this.tween = null;
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
        const x = e.clientX;
        const y = e.clientY;
        const last = this.lastTap;
        if (this.picker) this.tapAt(x, y, 28);
        else if (last && e.timeStamp - last.t < 320 && Math.hypot(x - last.x, y - last.y) < 40) {
          // Double-tap: zoom in there (all the way in: back out to the neighborhood).
          clearTimeout(this.tapTimer);
          this.lastTap = null;
          this.doubleTap(x, y);
        } else {
          this.lastTap = { x, y, t: e.timeStamp };
          clearTimeout(this.tapTimer);
          this.tapTimer = setTimeout(() => {
            this.lastTap = null;
            if (this.open) this.tapAt(x, y, 26);
          }, 260);
        }
      }
      tapStart = null;
    };
    this.canvas.addEventListener('pointerup', lift);
    this.canvas.addEventListener('pointercancel', lift);
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.tween = null;
      this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    }, { passive: false });
  }

  fit() {
    return Math.min(innerWidth, innerHeight) * 0.9 / (1600 + MARGIN * 2);
  }

  maxScale() {
    return Math.max(this.fit() * 6, 6);
  }

  // Neighborhood level: about 300 m across the short side of the screen (street and place names
  // showing).
  hood() {
    return clamp(Math.min(innerWidth, innerHeight) / 300, 1.45, this.maxScale());
  }

  // Phones, tablets and small windows: the map gets the whole screen (the legend's a sheet that
  // slides up, three small buttons in the corner).
  get compact() {
    return this.game.input.touchMode || innerWidth < 900 || innerHeight < 500;
  }

  show() {
    const game = this.game;
    this.open = true;
    this.el.classList.remove('hidden');
    this.art.buildBuildings(); // (in case any were moved or taken down: city.editBuilding)
    const [px, pz] = game.mapPos();
    // (open on you, at neighborhood level: pinch / wheel / R2 L2 out for the whole city)
    this.scale = this.hood();
    this.cx = px;
    this.cz = pz;
    this.tween = null;
    this.cursor = [px, pz]; // cursor starts on you
    this.mouse = null;
    this.closeCard();
    this.chip = -1;
    if (game.input.locked) game.input.unlock();
    this.el.classList.toggle('compact', this.compact);
    if (this.compact) this.legendOpen = false; // (on a phone the legend waits behind its button)
    else {
      try {
        this.legendOpen = localStorage.getItem('crimecity.legend') !== 'closed';
      } catch {
        // Storage unavailable.
      }
    }
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
    if (!this.compact) {
      try {
        localStorage.setItem('crimecity.legend', this.legendOpen ? 'open' : 'closed');
      } catch {
        // Storage unavailable.
      }
    } else if (this.legendOpen) this.closeCard(); // (one sheet at a time)
    this.applyLegend();
    this.setHelp();
  }

  applyLegend() {
    const lg = this.el.querySelector('.bm-legend');
    // (a phone: the sheet slides up and down; otherwise the panel down the side shows or hides)
    lg.classList.toggle('sheet', this.compact);
    lg.classList.toggle('hidden', !this.legendOpen && !this.compact);
    lg.classList.toggle('shut', !this.legendOpen);
    this.el.querySelector('.bm-leg').classList.toggle('on', this.legendOpen);
    const tab = this.el.querySelector('.bm-legend-tab');
    tab.textContent = this.legendOpen ? 'Hide legend ▴' : 'Legend ▾';
    tab.classList.toggle('open', this.legendOpen);
  }

  setHelp() {
    const pad = this.game.input.mode === 'pad';
    if (this.picker) {
      setRich(this.el.querySelector('.bm-help'), pad
        ? 'Pick a bus stop · Left stick: move · D-pad ↑↓: next stop · ✕: ride there · ○: cancel'
        : this.game.input.touchMode ? 'Pick a bus stop · Tap a stop to ride there · Drag: move · Pinch: zoom · ✕: cancel'
          : 'Pick a bus stop · Click a stop to ride there · ↑↓: next stop · Drag / WASD: move · Wheel: zoom · Esc: cancel');
      return;
    }
    const heat = this.heat ? `${this.heat} prices` : 'prices';
    if (this.card) {
      setRich(this.el.querySelector('.bm-help'), pad ? '✕: waypoint · □: bus · △: taxi · ○: back' : 'Enter: waypoint · B: bus · T: taxi · Esc: back');
      return;
    }
    setRich(this.el.querySelector('.bm-help'), pad
      ? `Left stick: move · D-pad ↑↓: places · ◀▶: nearest shop, plug, bank · △: legend · □: ${heat} · R2 / L2: zoom · R3: you · ✕: options · ○: close`
      : this.game.input.touchMode ? 'Drag: move · Pinch or double-tap: zoom · Tap a place: options · Tap the map: waypoint'
        : `WASD / drag: move · ↑↓: places · ←→: nearest shop, plug, bank · 1-6: layers · L: legend · H: ${heat} · C: you · Wheel: zoom · Click: options / waypoint · M: close`);
  }

  hide() {
    this.open = false;
    this.picker = null;
    clearTimeout(this.tapTimer);
    this.closeCard();
    this.el.classList.add('hidden');
  }

  // ○ / Esc: the card or the legend sheet first, then the map. True if it closed something.
  back() {
    if (this.card) {
      this.closeCard();
      return true;
    }
    if (this.compact && this.legendOpen) {
      this.toggleLegend();
      return true;
    }
    return false;
  }

  // Glide the view to a spot (re-center, double-tap, a quick-find).
  glide(cx, cz, scale) {
    // (a fixed third of a second, eased, however fast the frames come)
    this.tween = { cx, cz, scale: clamp(scale, this.fit(), this.maxScale()), from: [this.cx, this.cz, this.scale], t0: performance.now() };
  }

  recenter() {
    const [px, pz] = this.game.mapPos();
    this.cursor = [px, pz];
    this.mouse = null;
    this.glide(px, pz, Math.max(this.scale, this.hood()));
  }

  doubleTap(sx, sy) {
    const [wx, wz] = this.toWorld(sx, sy);
    const max = this.maxScale();
    const s = this.scale >= max * 0.98 ? this.hood() : Math.min(max, this.scale * 2.2);
    // (the point tapped stays under your finger)
    this.glide(wx - (sx - innerWidth / 2) / s, wz - (sy - innerHeight / 2) / s, s);
  }

  // What's on the map at a point on screen (a finger's reach): a legend entry, or a cluster.
  hitAt(sx, sy, reach) {
    let best = null;
    let bd = reach;
    for (const m of this.placedMarks || []) {
      const d = Math.hypot(m.sx - sx, m.sy - sy) - (m.r - 8);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best && best.count > 1) return { cluster: best };
    const want = best ? `${Math.round(best.x)},${Math.round(best.z)}` : null;
    let hit = null;
    let hd = reach;
    for (const e of this.entries || []) {
      if (e.head || e.x == null || e.kind === 'layer' || e.kind === 'heat' || e.kind === 'you') continue;
      if (want && `${Math.round(e.x)},${Math.round(e.z)}` === want) return e;
      const [x, y] = this.toScreen(e.x, e.z);
      const d = Math.hypot(x - sx, y - sy) + (e.kind === 'swatch' ? 10 : 0);
      if (d < hd) {
        hd = d;
        hit = e;
      }
    }
    return hit;
  }

  // A tap or click on the map: a place opens its card, a cluster zooms in on it, the open
  // map drops (or lifts) the waypoint.
  tapAt(sx, sy, reach) {
    const [x, z] = this.toWorld(sx, sy);
    if (this.picker) return this.pickAt(x, z);
    const hit = this.hitAt(sx, sy, reach);
    if (hit?.cluster) {
      const c = hit.cluster;
      const [wx, wz] = this.toWorld(c.sx, c.sy);
      this.glide(wx, wz, Math.max(this.scale * 2.5, 1.5));
      return;
    }
    if (hit) {
      this.cursor = [hit.x, hit.z];
      this.openCard(hit);
      return;
    }
    if (this.card || (this.compact && this.legendOpen)) {
      this.back(); // (a tap off the card just puts it away)
      return;
    }
    this.cursor = [x, z];
    this.toggleWaypoint(x, z);
  }

  // ---- The place card: what it is, how far, and how to get there ----
  openCard(e) {
    if (!e || e.x == null) return;
    const game = this.game;
    const [px, pz] = game.mapPos();
    const route = gpsRoute(game.city, px, pz, e.x, e.z);
    const m = route ? routeLength(route) : dist(px, pz, e.x, e.z) * 1.3;
    this.card = { ...e, m };
    if (this.compact && this.legendOpen) this.toggleLegend();
    this.renderCard();
    this.setHelp();
  }

  closeCard() {
    if (!this.card) return;
    this.card = null;
    this.el.querySelector('.bm-card').classList.add('hidden');
    this.setHelp();
  }

  renderCard() {
    const c = this.card;
    const game = this.game;
    const box = this.el.querySelector('.bm-card');
    const fmtD = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);
    const fmtT = (sec) => (sec < 60 ? `${Math.max(5, Math.round(sec / 5) * 5)} s` : `${Math.round(sec / 60)} min`);
    const icon = c.kind === 'swatch' ? `<span class="bc-ic sq" style="background:${c.color}"></span>`
      : c.kind === 'text' ? `<span class="bc-ic" style="background:#1d2b1f;color:${c.color}">${c.text}</span>`
        : c.kind === 'pin' ? '<span class="bc-ic" style="background:#ffd23f;color:#111">★</span>'
          : c.kind === 'bus' ? `<span class="bc-ic">${BUS_ICON}</span>`
            : c.kind === 'heli' ? `<span class="bc-ic" style="background:#1c2a44">${HELI_SVG}</span>`
              : `<span class="bc-ic" style="background:${c.color}">${iconSVG(c.text, 16) || c.text || ''}</span>`;
    const w = this.waypoint;
    const pinned = w && dist(w[0], w[1], c.x, c.z) < 3;
    const pad = game.input.mode === 'pad' && !game.input.touchMode;
    const kb = !pad && !game.input.touchMode;
    const k = (p, b) => (pad ? `<i>${p}</i>` : kb ? `<i>${b}</i>` : '');
    const fare = game.travel?.taxiFare?.(c.x, c.z);
    const name = c.label.replace(/\s*\((rob it|guns, range|mods, respray|sell cars)\)/, '');
    box.innerHTML = (`<div class="bc-top">${icon}<div class="bc-name"><div class="bc-t">${name}</div><div class="bc-s">${streetAt(c.x, c.z)} · ${districtAt(c.x, c.z)}</div></div><button class="bc-x" data-a="close" aria-label="Close">✕</button></div>
      <div class="bc-d"><b>${fmtD(c.m)}</b> · ${fmtT(c.m / 5.5)} on foot · ${fmtT(c.m / 16)} driving</div>
      <div class="bc-b"><button data-a="pin" class="${pinned ? 'on' : ''}">${k('✕', 'Enter')}${pinned ? 'Clear waypoint' : 'Set waypoint'}</button><button data-a="bus">${k('□', 'B')}Bus · $5</button><button data-a="taxi">${k('△', 'T')}Taxi${fare ? ` · $${fare}` : ''}</button></div>`);
    box.classList.remove('hidden');
  }

  cardAction(a) {
    const c = this.card;
    if (!c) return;
    const game = this.game;
    if (a === 'close') return this.closeCard();
    if (a === 'pin') {
      const w = this.waypoint;
      this.waypoint = w && dist(w[0], w[1], c.x, c.z) < 3 ? null : [c.x, c.z];
      this.renderCard();
      return;
    }
    const label = c.label.replace(/\s*\(.*\)$/, '').replace(/ · .*$/, '');
    // (the bus: off to the nearest stop, and on to the one nearest the place; a taxi: called
    // to the curb, and off you go)
    const ok = a === 'bus' ? game.travel.busTo(c.x, c.z, label) : game.travel.taxiTo(c.x, c.z, label);
    if (ok) this.hide();
  }

  // Quick-find (the chips along the top; ◀▶ / ←→): the nearest one, routed and framed with you.
  nearest(k) {
    const game = this.game;
    const [px, pz] = game.mapPos();
    const S = game.shops;
    const best = (list, f) => [...list].filter(f || (() => true)).sort((a, b) => dist(a.x, a.z, px, pz) - dist(b.x, b.z, px, pz))[0];
    if (k === 'gun') {
      const g = best(S.gunShops);
      return g && { kind: 'blip', color: g.color, text: 'gun', label: `${g.name} (guns, range)`, x: g.x, z: g.z };
    }
    if (k === 'safe') return { kind: 'blip', color: S.safehouse ? '#2c3e50' : '#7f8c8d', text: 'safe', label: S.safehouse ? 'Your safehouse' : 'Safehouse (for sale)', x: S.safe.x, z: S.safe.z };
    if (k === 'plug') {
      const p = best(game.drugs.plugs, (q) => !q.dead);
      return p && { kind: 'blip', color: '#6c3483', text: 'plug', label: `Plug: ${p.name} (${p.product})`, x: p.x, z: p.z };
    }
    if (k === 'store') {
      const st = best(game.city.stores, (q) => !(q.cooldown > 0)) || best(game.city.stores);
      return st && { kind: 'text', color: st.cooldown > 0 ? '#777' : '#2ecc71', text: '$', label: `${st.name}${st.cooldown > 0 ? ' · robbed' : ''}`, x: st.x, z: st.z };
    }
    if (k === 'bank') {
      const b = best(game.bank.banks || []);
      const open = game.bank.open();
      return b && { kind: 'blip', color: open ? '#1e8449' : '#566573', text: 'bank', label: `${b.name} (${open ? 'open' : 'closed'})`, x: b.x, z: b.z };
    }
    return null;
  }

  quickFind(k) {
    const e = this.nearest(k);
    if (!e) {
      this.game.hud.toast('None on the map right now', '#9fc3ff');
      return;
    }
    this.chip = CHIPS.findIndex((c) => c[0] === k);
    this.el.querySelectorAll('.bm-chip').forEach((b, i) => b.classList.toggle('on', i === this.chip));
    this.waypoint = [e.x, e.z];
    this.cursor = [e.x, e.z];
    this.mouse = null;
    this.openCard(e);
    // (frame you and it, clear of the chips up top and the card below)
    const [px, pz] = this.game.mapPos();
    // (top: the chips and the waypoint's distance tag over the pin; bottom: the card)
    const card = this.el.querySelector('.bm-card');
    const top = 96;
    const bottom = (card.offsetHeight || 130) + (this.compact ? 20 : 64);
    const room = Math.max(70, innerHeight - top - bottom);
    const s = Math.min((innerWidth - 140) / Math.max(40, Math.abs(e.x - px)), room / Math.max(40, Math.abs(e.z - pz)), this.hood() * 1.3);
    const sc = clamp(s, this.fit(), this.maxScale());
    this.glide((px + e.x) / 2, (pz + e.z) / 2 + (bottom - top) / 2 / sc, sc);
  }

  cycleHeat() {
    const order = [null, 'weed', 'pills', 'coke'];
    this.heat = order[(order.indexOf(this.heat || null) + 1) % order.length];
    this.legendHtml = '';
    this.setHelp();
  }

  // Everything on the map, grouped. Each entry has a place: picking it in the legend (D-pad
  // ↑ ↓ / arrow keys, or a click) moves the cursor there.
  legendEntries() {
    const game = this.game;
    const city = game.city;
    const T = game.turfWars;
    const S = game.shops;
    const D = game.drugs;
    const [px, pz] = game.mapPos();
    const out = [];
    const head = (t) => out.push({ head: t });
    const add = (kind, color, text, label, x, z) => out.push({ kind, color, text, label, x, z });
    head('Layers');
    for (const [k, name] of LAYERS) out.push({ kind: 'layer', key: k, on: this.layers[k], label: name, x: null, z: null });
    out.push({ kind: 'heat', label: `Drug prices: ${this.heat ? `${this.heat} (tap for the next)` : 'off'}`, x: null, z: null });
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
    const free = T.blocks.filter((b) => !T.owner[b.key]).sort((a, b) => dist(a.cx, a.cz, px, pz) - dist(b.cx, b.cz, px, pz));
    if (free.length) add('swatch', '#555', '', `Unclaimed · ${free.length} blocks (nearest)`, free[0].cx, free[0].cz);
    for (const w of T.wars) if (w.state === 'active') add('swatch', '#ff4d4d', '', `Turf war · ${w.street}`, w.block.cx, w.block.cz);
    head('Places');
    add('blip', '#2e7d32', 'G', 'Green Street hangout', city.crewHome.x, city.crewHome.z);
    add('blip', '#8e24aa', 'K', `${GANGS.kings.name} hangout`, city.gangHome.x, city.gangHome.z);
    const vh = T.homeBlock('vipers');
    if (vh) add('blip', '#ff7a1a', 'V', `${GANGS.vipers.name} home`, vh.cx, vh.cz);
    add('blip', '#2e6fd8', 'police', 'Police station', city.station.x, city.station.z);
    add('blip', '#d63031', 'hospital', 'Hospital', city.hospital.x, city.hospital.z);
    add('blip', '#e67e22', 'chop', 'Chop shop (sell cars)', city.chop.x, city.chop.z);
    for (const g of S.gunShops) add('blip', g.color, 'gun', `${g.name} (guns, range)`, g.x, g.z);
    add('blip', S.garage.color, 'wrench', `${S.garage.name} (mods, respray)`, S.garage.x, S.garage.z);
    add('blip', S.safehouse ? '#2c3e50' : '#7f8c8d', 'safe', S.safehouse ? 'Your safehouse' : 'Safehouse (for sale)', S.safe.x, S.safe.z);
    const stops = [...game.transit.shelters()].sort((p, q) => dist(p.sx, p.sz, px, pz) - dist(q.sx, q.sz, px, pz));
    COURT_SITES.forEach((c, i) => add('swatch', '#365f8f', '', `${c.name} (basketball${i ? '' : ', parking'})`, c.x, c.z));
    if (game.city.footballField) add('swatch', '#4a8a42', '', 'Harbor Field (football, parking)', FIELD_SITE.x, FIELD_SITE.z);
    add('swatch', '#5f8f4e', '', `${PARK_SITE.name} (playground)`, PARK_SITE.x, PARK_SITE.z);
    add('swatch', '#7a5a32', '', `${PARK_SITE.statue.name} (statue)`, PARK_SITE.statue.x, PARK_SITE.statue.z);
    if (stops.length) add('bus', '#f39c12', '', `Bus stops · ${stops.length} (nearest)`, stops[0].sx, stops[0].sz);
    head('Money');
    game.bank.legend(add);
    game.economy.legend(add);
    head('Gang bases');
    game.bases.legend(add);
    head('Business');
    if (S.stash > 0) add('blip', '#27ae60', 'cash', `Turf stash · $${S.stash.toLocaleString('en-US')}`, S.stashAt.x, S.stashAt.z);
    for (const p of D.plugs) add('blip', p.dead ? '#555' : '#6c3483', 'plug', p.dead ? `Plug (${p.product}): dead, replaced soon` : `Plug: ${p.name} (${p.product})`, p.x, p.z);
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
    const pickable = entries.filter((e) => !e.head && (e.x !== null || e.kind === 'layer' || e.kind === 'heat'));
    this.entries = entries;
    this.legendSel = Math.min(this.legendSel ?? 0, pickable.length - 1);
    const sel = pickable[this.legendSel];
    const icon = (e) => {
      if (e.kind === 'swatch') return `<span class="lg-sw" style="background:${e.color}"></span>`;
      if (e.kind === 'dot') return `<span class="lg-dot" style="background:${e.color}"></span>`;
      if (e.kind === 'text') return `<span class="lg-tx" style="color:${e.color}">${e.text}</span>`;
      if (e.kind === 'pin') return '<span class="lg-pin"></span>';
      if (e.kind === 'heli') return '<span class="lg-heli">' + HELI_SVG + '</span>';
      if (e.kind === 'bus') return BUS_ICON;
      if (e.kind === 'you') return '<span class="lg-you">▲</span>';
      if (e.kind === 'layer') return `<span class="lg-chk${e.on ? ' on' : ''}">${e.on ? '✓' : ''}</span>`;
      if (e.kind === 'heat') return `<span class="lg-heat${this.heat ? ' on' : ''}"></span>`;
      return `<span class="lg-bl" style="background:${e.color}">${iconSVG(e.text, 12) || e.text}</span>`;
    };
    const html = entries.map((e) => {
      if (e.head) return `<div class="lg-head">${e.head}</div>`;
      const i = pickable.indexOf(e);
      return `<div class="lg-row${e === sel && this.legendActive ? ' sel' : ''}${i < 0 ? ' off' : ''}${e.kind === 'layer' ? ` layer${e.on ? '' : ' hid'}` : ''}${e.kind === 'heat' ? ' layer' : ''}" data-i="${i}">${icon(e)}<span class="lg-l">${e.label}</span></div>`;
    }).join('');
    if (html !== this.legendHtml) {
      this.legendHtml = html;
      const box = this.el.querySelector('.bm-legend-list');
      box.innerHTML = html;
      box.querySelector('.lg-row.sel')?.scrollIntoView({ block: 'nearest' });
    }
    this.pickable = pickable;
  }

  // Turf's stripes in a gang's color (the same size on screen at any zoom).
  hatch(color, s) {
    this.hatches ??= new Map();
    let p = this.hatches.get(color);
    if (!p) {
      const c = document.createElement('canvas');
      c.width = c.height = 10;
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.globalAlpha = 0.16;
      g.fillRect(0, 0, 10, 10);
      g.globalAlpha = 0.5;
      g.strokeStyle = color;
      g.lineWidth = 2.2;
      g.beginPath();
      for (const o of [-10, 0, 10]) {
        g.moveTo(o, 10);
        g.lineTo(o + 10, 0);
      }
      g.stroke();
      p = this.ctx.createPattern(c, 'repeat');
      this.hatches.set(color, p);
    }
    p.setTransform?.(new DOMMatrix().scale(1 / s));
    return p;
  }

  // A layer on or off (the legend's Layers rows; 1-6 on a keyboard).
  toggleLayer(k) {
    this.layers[k] = !this.layers[k];
    try {
      localStorage.setItem('crimecity.maplayers', JSON.stringify(this.layers));
    } catch {
      // Storage unavailable.
    }
    this.legendHtml = '';
  }

  // Jump the cursor (and the view) to a legend entry.
  jumpTo(i) {
    const e = this.pickable && this.pickable[i];
    if (!e) return;
    this.legendSel = i;
    this.legendActive = true;
    if (e.kind === 'layer') return;
    this.cursor = [e.x, e.z];
    this.cx = e.x;
    this.cz = e.z;
    this.mouse = null;
  }

  // Keep the city centered on screen when it fits; when zoomed in, don't scroll past its edges.
  clampView() {
    const lo = -MARGIN;
    const hi = 1600 + MARGIN;
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
    this.scale = clamp(this.scale * f, this.fit(), this.maxScale()); // (close enough for every building)
    // Keep the point under the mouse where it was.
    this.cx = wx - (sx - innerWidth / 2) / this.scale;
    this.cz = wz - (sy - innerHeight / 2) / this.scale;
  }

  // Picking a bus stop to ride to: the map opens with the stops picked out; tap / click / ✕ on
  // one to go there. ↑↓ (D-pad) steps through them.
  pickStop(picker) {
    this.show();
    this.picker = { ...picker, t: performance.now(), sel: -1 };
    this.setHelp();
    this.draw();
  }

  // The stop nearest a point on screen (within reach of a finger).
  stopNear(sx, sy, reach = 28) {
    let best = null;
    let bd = reach;
    for (const s of this.picker.stops) {
      const [x, y] = this.toScreen(s.sx, s.sz);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  pickAt(x, z) {
    const pk = this.picker;
    if (performance.now() - pk.t < 300) return; // the press that opened the map
    const s = this.stopNear(...this.toScreen(x, z));
    if (!s) {
      const [fx, fy] = pk.from ? this.toScreen(pk.from.sx, pk.from.sz) : [-1e9, -1e9];
      const [tx, ty] = this.toScreen(x, z);
      this.game.hud.toast(Math.hypot(fx - tx, fy - ty) < 28 ? "You're at this stop" : 'Pick one of the bus stops', '#9fc3ff');
      return;
    }
    this.picker = null;
    this.hide();
    pk.onPick(s);
  }

  toggleWaypoint(x, z) {
    if (this.picker) return this.pickAt(x, z);
    const w = this.waypoint;
    if (w && dist(w[0], w[1], x, z) < 20 / Math.max(0.5, this.scale)) this.waypoint = null;
    else this.waypoint = [clamp(x, -MARGIN, 1600 + MARGIN), clamp(z, -MARGIN, 1600 + MARGIN)];
  }

  update(dt, a) {
    const game = this.game;
    if (this.tween) {
      const t = this.tween;
      const u = Math.min(1, (performance.now() - t.t0) / 350);
      const k = 1 - (1 - u) ** 3;
      const [fx, fz, fs] = t.from;
      this.scale = fs * Math.exp(Math.log(t.scale / fs) * k);
      this.cx = fx + (t.cx - fx) * k;
      this.cz = fz + (t.cz - fz) * k;
      if (u >= 1) this.tween = null;
    }
    if (this.el.classList.contains('compact') !== this.compact) {
      // (the window changed size, or touch came in: the other layout)
      this.el.classList.toggle('compact', this.compact);
      if (this.compact) this.legendOpen = false; // (the sheet starts shut)
      this.applyLegend();
      this.setHelp();
    }
    // The place card's buttons: ✕ / Enter waypoint, □ / B the bus, △ / T a taxi.
    if (this.card) {
      if (a.mapWaypoint) return this.cardAction('pin'), this.draw();
      if (game.input.hit?.('KeyB') || (a.mapHeat && !game.input.hit?.('KeyH'))) return this.cardAction('bus'), this.open && this.draw();
      if (game.input.hit?.('KeyT') || (a.mapLegend && !game.input.hit?.('KeyL'))) return this.cardAction('taxi'), this.open && this.draw();
    }
    // ◀ ▶ / ← →: the quick-find chips, in turn.
    if (!this.picker && (a.phoneLeft || a.phoneRight)) {
      const n = CHIPS.length;
      const i = this.chip < 0 ? (a.phoneRight ? 0 : n - 1) : (this.chip + (a.phoneRight ? 1 : -1) + n) % n;
      this.quickFind(CHIPS[i][0]);
    }
    if (game.input.hit?.('KeyC') || game.input.btnHit?.(11)) this.recenter(); // (C / R3: back to you)
    // Cursor: the stick (or WASD) moves it; the view follows when it nears the edge.
    if (this.mouse && game.input.mode !== 'pad') this.cursor = this.toWorld(...this.mouse);
    // The legend: step through the places on the map; the cursor jumps to each.
    if (this.picker && (a.phoneUp || a.phoneDown)) {
      const pk = this.picker;
      const n = pk.stops.length;
      pk.sel = pk.sel < 0 ? 0 : (pk.sel + (a.phoneDown ? 1 : -1) + n) % n;
      const s = pk.stops[pk.sel];
      this.mouse = null;
      this.cursor = [s.sx, s.sz];
      this.cx = s.sx;
      this.cz = s.sz;
    } else if (a.phoneUp || a.phoneDown) {
      if (!this.legendOpen) this.toggleLegend(); // stepping through places opens it
      const n = (this.pickable || []).length;
      if (n) this.jumpTo(this.legendActive ? (this.legendSel + (a.phoneDown ? 1 : -1) + n) % n : 0);
    }
    const mx = a.moveX;
    const my = -(a.moveY - (a.arrowY || 0)); // arrow keys are for the legend here
    if (mx || my) {
      this.mouse = null;
      this.tween = null;
      this.legendActive = false;
      const sp = 520 / this.scale; // screen pixels per second, in world units
      this.cursor[0] = clamp(this.cursor[0] + mx * sp * dt, -MARGIN, 1600 + MARGIN);
      this.cursor[1] = clamp(this.cursor[1] + my * sp * dt, -MARGIN, 1600 + MARGIN);
      const [sx, sy] = this.toScreen(...this.cursor);
      const m = 120;
      if (sx < m) this.cx -= (m - sx) / this.scale;
      if (sx > innerWidth - m) this.cx += (sx - innerWidth + m) / this.scale;
      if (sy < m) this.cz -= (m - sy) / this.scale;
      if (sy > innerHeight - m) this.cz += (sy - innerHeight + m) / this.scale;
    }
    if (a.mapLegend) this.toggleLegend();
    // □ / H: cycle the drug price heat map (off → weed → pills → coke).
    if (a.mapHeat) this.cycleHeat();
    const zoom = game.input.btnVal(7) - game.input.btnVal(6);
    if (Math.abs(zoom) > 0.1) {
      this.tween = null;
      this.zoomAt(Math.exp(zoom * dt * 2), ...this.toScreen(...this.cursor));
    }
    const selK = this.legendActive && this.pickable?.[this.legendSel]?.kind;
    const selLayer = selK === 'layer' || selK === 'heat' ? this.pickable[this.legendSel] : null;
    if (a.mapWaypoint) {
      if (selLayer) {
        if (selLayer.kind === 'heat') this.cycleHeat();
        else this.toggleLayer(selLayer.key);
      } else if (this.picker) this.toggleWaypoint(...this.cursor);
      else if (this.hovered && this.hovered.kind !== 'you' && this.hovered.x != null) this.openCard(this.hovered); // (✕ on a place: its card)
      else this.toggleWaypoint(...this.cursor);
    }
    LAYERS.forEach(([k], i) => game.input.hit?.(`Digit${i + 1}`) && this.toggleLayer(k));
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
    // The city (mapart.js): more of it the closer you zoom.
    const lod = LOD(s);
    this.art.draw(ctx, s, { lod });
    const L = this.layers;
    // Turf: each gang's blocks striped in its color, with a solid edge (the streets show
    // through).
    if (L.turf) {
      for (const t of game.turfWars.view()) {
        ctx.fillStyle = this.hatch(t.color, s);
        fillTurf(ctx, t.blocks);
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 2.5 / s;
        strokeTurf(ctx, t.blocks, game.city.blocks);
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 0.55;
      for (const w of game.turfWars.wars) {
        const b = w.block;
        const def = w.defender || w.responder;
        ctx.fillStyle = Math.floor(performance.now() / 300) % 2 ? GANGS[w.attacker].color : def ? GANGS[def].color : '#fff';
        fillBlocks(ctx, [b]);
      }
      ctx.globalAlpha = 1;
    }
    // Drug price heat (cycle with □ / H): blue = cheap there, red = sells high.
    const heat = this.heat ? game.market : null;
    if (heat) {
      for (const b of game.turfWars.blocks) {
        const m = heat.mult(districtAt(b.cx, b.cz), this.heat);
        const k = clamp((m - 0.6) / 1.1, 0, 1);
        ctx.fillStyle = `hsla(${Math.round(220 - k * 220)}, 90%, 50%, 0.62)`;
        fillBlocks(ctx, [b]);
      }
    }
    // Hovered block outline.
    const hb = game.turfWars.blockAt(...this.cursor);
    if (hb) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / s;
      ctx.setLineDash([6 / s, 4 / s]);
      strokeBlock(ctx, hb);
      ctx.setLineDash([]);
    }
    // Police search area.
    if (L.police && game.stars > 0 && game.searching && game.lastKnown) {
      ctx.fillStyle = 'rgba(255,80,80,.15)';
      ctx.strokeStyle = 'rgba(255,80,80,.8)';
      ctx.lineWidth = 2 / s;
      ctx.beginPath();
      ctx.arc(game.lastKnown[0], game.lastKnown[1], game.searchRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // Markers, drawn at screen size. Each has an importance (3: always, big; 2: places; 1: the
    // small stuff, only once you're in a little) and a layer. Zoomed out, the ones crowded
    // together become one with a count; zoomed in they're nudged apart and named.
    const dot = (x, z, r, fill) => {
      const [sx, sy] = this.toScreen(x, z);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const marks = [];
    const mark = (x, z, color, text, imp = 2, layer = null) => {
      if (layer && !L[layer]) return;
      if (imp === 1 && lod === 0) return;
      marks.push({ x, z, color, text, imp, r: imp === 3 ? 13 : imp === 2 ? 11 : 8 });
    };
    mark(city.chop.x, city.chop.z, '#e67e22', 'chop', 2, 'shops');
    mark(city.station.x, city.station.z, '#2e6fd8', 'police', 2, 'police');
    mark(city.hospital.x, city.hospital.z, '#d63031', 'hospital', 2);
    mark(city.gangHome.x, city.gangHome.z, '#8e24aa', 'K', 3, 'turf');
    mark(city.crewHome.x, city.crewHome.z, '#2e7d32', 'G', 3);
    const vh = game.turfWars.homeBlock('vipers');
    if (vh) mark(vh.cx, vh.cz, '#ff7a1a', 'V', 3, 'turf');
    for (const [x, z, col, txt] of game.turfWars.claimMarks()) mark(x, z, col, txt, 3);
    for (const [x, z, col, txt] of game.shops.blips()) mark(x, z, col, txt, txt === 'safe' ? 3 : 2, txt === 'safe' ? null : txt === 'cash' ? 'business' : 'shops');
    for (const [x, z, col, txt] of game.drugs.blips()) mark(x, z, col, txt, 2, 'business');
    for (const [x, z, col, txt] of game.bank.blips()) mark(x, z, col, txt, txt === 'home' ? 1 : 2, 'money');
    for (const [x, z, col, txt] of game.economy.blips()) mark(x, z, col, txt, 1, 'money');
    for (const [x, z, col, txt] of game.bases.blips()) mark(x, z, col, txt, 2, 'turf');
    for (const k of game.market.kingpinSpots()) mark(k.x, k.z, '#111', '♛', 2, 'business');
    const tc = game.testCar;
    if (tc && !tc.removed && !tc.exploded && game.player.vehicle !== tc) mark(tc.x, tc.z, '#1e88e5', 'V', 1);
    for (const v of game.backup.cars()) mark(v.x, v.z, '#2ecc71', 'B', 2);
    // (names for them, from the legend: shown beside them close up)
    const names = new Map();
    for (const e of this.entries || []) if (e.x != null && e.label) names.set(`${Math.round(e.x)},${Math.round(e.z)}`, e.label.replace(/\s*\(.*\)$/, '').replace(/ · .*$/, ''));
    // (place them: most important first)
    marks.sort((p, q) => q.imp - p.imp);
    const placed = [];
    const mergeR = lod === 0 ? 24 : lod === 1 ? 14 : 0;
    for (const m of marks) {
      let [sx, sy] = this.toScreen(m.x, m.z);
      if (sx < -30 || sx > innerWidth + 30 || sy < -30 || sy > innerHeight + 30) continue;
      const near = placed.find((o) => Math.hypot(o.sx - sx, o.sy - sy) < Math.max(mergeR, (o.r + m.r) * (mergeR ? 0.9 : 0)));
      if (near && m.imp < 3 && near.imp >= m.imp && mergeR) {
        near.count = (near.count || 1) + 1;
        continue;
      }
      // (close up: nudged round so they don't sit on each other)
      for (let k = 0; k < 6 && placed.some((o) => Math.hypot(o.sx - sx, o.sy - sy) < o.r + m.r); k++) {
        const a = k * 2.1;
        sx += Math.cos(a) * (m.r + 4);
        sy += Math.sin(a) * (m.r + 4);
      }
      placed.push({ ...m, sx, sy, name: names.get(`${Math.round(m.x)},${Math.round(m.z)}`) });
    }
    // The small things: stores (shops), ATMs (money), bus stops (transit), not from far off.
    if (lod >= 1) {
      ctx.font = 'bold 15px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (L.shops) {
        for (const st of city.stores) {
          const [sx, sy] = this.toScreen(st.x, st.z);
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,.7)';
          ctx.strokeText('$', sx, sy);
          ctx.fillStyle = st.cooldown > 0 ? '#888' : '#2ecc71';
          ctx.fillText('$', sx, sy);
        }
      }
      if (L.money) for (const t of game.bank.atmSpots()) dot(t.x, t.z, 4, '#5dade2');
    }
    if (!this.picker && L.transit && lod >= 1) for (const st of game.transit.shelters()) drawBusStop(ctx, ...this.toScreen(st.sx, st.sz), lod >= 2 ? 8 : 6);
    // (the markers, a count on the merged ones; their names close up)
    this.placedMarks = placed;
    const taken = [];
    for (const m of placed) {
      ctx.fillStyle = m.color;
      ctx.strokeStyle = 'rgba(0,0,0,.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.sx, m.sy, m.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (m.imp === 3) {
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(m.r * 1.1)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      blipText(ctx, m.text, m.sx, m.sy + 0.5, m.r * 1.1);
      if (m.count > 1) {
        const bx = m.sx + m.r * 0.8;
        const by = m.sy - m.r * 0.8;
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.font = 'bold 10px Arial';
        ctx.fillText(`${m.count}`, bx, by + 0.5);
      }
      taken.push([m.sx - m.r, m.sy - m.r, m.sx + m.r, m.sy + m.r]);
    }
    if (lod >= 2) {
      ctx.textAlign = 'left';
      const fs = this.game.input.touchMode ? 13 : 11; // (bigger on a phone)
      for (const m of placed) {
        if (!m.name) continue;
        ctx.font = `700 ${fs}px Arial`;
        const w = ctx.measureText(m.name).width;
        const box = [m.sx + m.r + 3, m.sy - fs * 0.75, m.sx + m.r + 7 + w, m.sy + fs * 0.75];
        if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10,12,16,.9)';
        ctx.strokeText(m.name, box[0] + 2, m.sy + 0.5);
        ctx.fillStyle = '#fff';
        ctx.fillText(m.name, box[0] + 2, m.sy + 0.5);
        taken.push(box);
      }
      ctx.textAlign = 'center';
    }
    // Street, freeway and district names, round everything above (mapart.js).
    if (!heat) this.art.labels(ctx, s, (x, z) => this.toScreen(x, z), innerWidth, innerHeight, taken, this.game.input.touchMode ? 1.2 : 1);
    // Moving things: your crew, the cops, the gangs chasing you.
    for (const m of game.crew.following) if (m.alive && m.state !== 'inCar') dot(m.x, m.z, 4, '#7ee081');
    const flash = Math.floor(performance.now() / 250) % 2 === 0;
    if (L.police) for (const u of game.police.units) dot(u.car.x, u.car.z, u.kind === 'swat' ? 6 : 5, flash ? '#ff3b3b' : '#3b7bff');
    for (const r of game.turfWars.rides) {
      if (r.mode !== 'chase' || r.done) continue;
      const g = r.riders[0] && GANGS[r.riders[0].gangId];
      dot(r.car.x, r.car.z, 6, g ? g.color : '#fff');
    }
    // GPS route, then the waypoint pin.
    this.route = this.waypoint ? gpsRoute(city, ...game.mapPos(), ...this.waypoint) : null;
    if (this.route) {
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      this.route.forEach(([x, z], i) => {
        const [sx, sy] = this.toScreen(x, z);
        if (i) ctx.lineTo(sx, sy);
        else ctx.moveTo(sx, sy);
      });
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = Math.min(11, Math.max(6, s * 4 + 3));
      ctx.stroke();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = Math.min(7, Math.max(3.5, s * 4));
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
      // (how far by road, and about how long: driving or on foot)
      if (this.route) {
        const m = routeLength(this.route);
        const sp = game.player.vehicle ? 16 : 5.5;
        const sec = m / sp;
        const t = `${m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`} · ${sec < 60 ? `${Math.max(5, Math.round(sec / 5) * 5)} s` : `${Math.round(sec / 60)} min`}`;
        ctx.font = '800 12px Arial';
        const w = ctx.measureText(t).width + 14;
        ctx.fillStyle = 'rgba(10,12,16,.88)';
        ctx.beginPath();
        ctx.roundRect(wx - w / 2, wy - 50, w, 20, 6);
        ctx.fill();
        ctx.fillStyle = '#ffd23f';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t, wx, wy - 39.5);
      }
    }
    // You: the way you're looking, lit up, and an arrow pointing the way you face.
    {
      const [px, pz] = game.mapPos();
      const v = game.player.vehicle;
      const h = v ? v.heading : game.player.heading;
      const [sx, sy] = this.toScreen(px, pz);
      ctx.save();
      ctx.translate(sx, sy);
      const look = v ? v.heading : game.camYaw ?? h;
      ctx.rotate(-look + Math.PI);
      const cone = ctx.createRadialGradient(0, 0, 4, 0, 0, 46);
      cone.addColorStop(0, 'rgba(255,255,255,.4)');
      cone.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 46, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(look - h);
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
    if (heli && !heli.removed && this.layers.police) {
      const [hx, hy] = this.toScreen(heli.x, heli.z);
      if (heli.beam && heli.beam.visible) {
        const [sx, sy] = this.toScreen(heli.aim[0], heli.aim[1]);
        drawSearchlight(ctx, hx, hy, sx, sy, Math.max(4, 5 * this.scale), heli.sees);
      }
      drawHeli(ctx, hx, hy, Math.PI - heli.heading, Math.max(1.5, Math.min(2.4, this.scale * 2)));
    }
    // Cursor (not on a touch screen: you point with your finger).
    if (!this.game.input.touchMode) {
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
    if (this.card) {
      const [sx, sy] = this.toScreen(this.card.x, this.card.z);
      const pulse = 19 + Math.sin(performance.now() / 180) * 2;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (!(this.compact && this.card)) this.drawCompass(ctx);
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
    if (this.picker) this.drawPicker(ctx);
    else if (!this.game.input.touchMode || this.card) this.drawHover(ctx);
    this.info.classList.toggle('hidden', !!(this.compact && (this.card || this.legendOpen)));
  }

  // North (up the map) and a scale bar, down in the corner.
  drawCompass(ctx) {
    const touch = this.game.input.touchMode;
    // (down in the corner; up by the legend's tab when the legend's down the left side)
    const lr = this.legendOpen && !this.compact ? this.el.querySelector('.bm-legend').getBoundingClientRect() : null;
    const top = lr && lr.left < 120 && lr.width > 0;
    const x = top ? 136 : 34;
    const y = top ? 31 : innerHeight - (this.compact ? (touch ? 34 : 64) : touch ? 96 : 70);
    ctx.save();
    if (top) {
      ctx.translate(x, y);
      ctx.scale(0.7, 0.7);
      ctx.translate(-x, -y);
    }
    ctx.fillStyle = 'rgba(10,12,16,.82)';
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.moveTo(x, y - 15);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#dfe3e8';
    ctx.beginPath();
    ctx.moveTo(x, y + 15);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '900 10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', x, y - 27);
    // (a bar a round number of meters long, about 90 px)
    const nice = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
    const m = nice.find((n) => n * this.scale >= 70) || 1000;
    const w = m * this.scale;
    const bx = x + 32;
    const by = y + 8;
    ctx.fillStyle = 'rgba(10,12,16,.82)';
    ctx.fillRect(bx - 6, by - 20, w + 12, 28);
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx, by, w, 3);
    ctx.fillRect(bx, by - 5, 2, 8);
    ctx.fillRect(bx + w - 2, by - 5, 2, 8);
    ctx.font = '700 11px Arial';
    ctx.fillText(m >= 1000 ? '1 km' : `${m} m`, bx + w / 2, by - 9);
    ctx.restore();
  }

  // Picking a stop: the map dims, the stops stand out, and the one under the cursor is labeled.
  drawPicker(ctx) {
    const pk = this.picker;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    if (pk.from) {
      const [x, y] = this.toScreen(pk.from.sx, pk.from.sz);
      ctx.strokeStyle = '#7ee081';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.stroke();
      drawBusStop(ctx, x, y, 8);
      ctx.font = '600 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7ee081';
      ctx.fillText('You are here', x, y + 28);
    }
    const [mx, my] = this.mouse || this.toScreen(...this.cursor);
    const hit = this.stopNear(mx, my);
    for (const s of pk.stops) {
      const [x, y] = this.toScreen(s.sx, s.sz);
      if (s === hit) continue;
      drawBusStop(ctx, x, y, 11);
    }
    if (hit) {
      const [x, y] = this.toScreen(hit.sx, hit.sz);
      ctx.shadowColor = 'rgba(0,0,0,.6)';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      drawBusStop(ctx, x, y, 15);
      const label = pk.info(hit);
      ctx.font = '600 13px Arial';
      const w = ctx.measureText(label).width + 18;
      const bx = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2));
      const by = y - 58 < 8 ? y + 26 : y - 58;
      ctx.fillStyle = 'rgba(10,12,16,.92)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, w, 26, 6) : ctx.rect(bx, by, w, 26);
      ctx.fill();
      ctx.strokeStyle = '#f39c12';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 9, by + 13.5);
    }
    ctx.restore();
  }

  // Hovering a marker (the mouse, or the controller's cursor) or a legend row: the marker grows
  // and a label says what it is.
  drawHover(ctx) {
    const entries = (this.entries || []).filter((e) => !e.head && e.x != null);
    let hit = null;
    if (this.rowHover != null && this.pickable && this.pickable[this.rowHover]) hit = this.pickable[this.rowHover];
    else if (this.card) hit = this.card;
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
    blipText(ctx, glyph, sx, sy + 1, 16);
    // The label, above the marker (kept on screen).
    ctx.font = '600 13px Arial';
    const w = ctx.measureText(hit.label).width + 18;
    const bx = Math.max(8, Math.min(innerWidth - w - 8, sx - w / 2));
    const by = sy - r - 34 < 56 ? sy + r + 8 : sy - r - 34; // (not up under the chips)
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
      const k = b.key;
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
