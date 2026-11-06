import { DISTRICTS, districtCenter } from './districts.js';
import { coastZ, MAP } from './worldplan.js';
import { RING, XT } from './fwyplan.js';
import { pointInPoly } from './geom.js';

// The city drawn as a map (the big map, mapview.js; the radar's picture, hud.js), from the
// city's own plan: the streets at their real widths by class, the freeways over them, the
// blocks, and (zoomed in) sidewalks, building footprints and the courts, field and park.
// Built once into paths in world meters; drawn each frame at any zoom, so it stays sharp and
// shows more the closer you get. Labels (street names, freeway names, districts) are placed on
// screen, the bigger roads first, never over each other.
//
// Zoom levels by s, screen pixels per meter: far (< 0.6: the whole city), mid (0.6 - 1.4),
// close (1.4 and up). LOD(s) gives 0, 1 or 2.
export const LOD = (s) => (s < 0.6 ? 0 : s < 1.4 ? 1 : 2);

// The colors: a calm dark map, the roads light, the freeways amber.
const C = {
  land: '#232b25',
  water: '#1d3a57',
  waterEdge: '#2c5378',
  block: '#353a42',
  lot: '#2c3037',
  sidewalk: '#4a4f57',
  building: '#4d5461',
  buildingEdge: '#22262c',
  park: '#35603a',
  plaza: '#4a4943',
  roads: { local: '#6f747c', hills: '#6f747c', pier: '#76705f', collector: '#8d929a', under: '#7f848c', arterial: '#c4c8ce', roundabout: '#c4c8ce' },
  fwy: '#e3a33a',
  fwyEdge: '#3a2808',
  ramp: '#b98a43',
};
const SHADE = { 'The Heights': '#36423a', 'Financial District': '#2f3a47', 'Government District': '#3c3d39', 'The Projects': '#3b3330', 'The Strip': '#383145', 'The Docks': '#33373c', Downtown: '#31363d', Midtown: '#30353b' };
const TYPE = { park: C.park, ramps: '#2f4f31', plaza: C.plaza, police: '#2b3f66', chop: '#5b3c1d', hospital: '#5d2b2b', cityhall: '#4a4840', place: '#45423b' };
// (road classes: drawn narrow to wide, and the smallest name labels need the most zoom)
const ORDER = ['local', 'hills', 'pier', 'under', 'collector', 'arterial', 'roundabout'];
const NAME_AT = { arterial: 0.5, roundabout: 0.9, collector: 0.95, under: 1.1, local: 1.5, hills: 1.5, pier: 1.5 };

export class MapArt {
  constructor(game) {
    this.game = game;
    const city = game.city;
    const P = () => new Path2D();
    // The sea.
    this.water = P();
    this.water.moveTo(-200, coastZ(-200));
    for (let x = -200; x <= MAP + 200; x += 8) this.water.lineTo(x, coastZ(x));
    this.water.lineTo(MAP + 200, MAP + 400);
    this.water.lineTo(-200, MAP + 400);
    this.water.closePath();
    // The streets, by class: one path each, stroked at the class's width.
    this.roads = {};
    for (const e of city.edges) {
      const k = e.cls in C.roads ? e.cls : 'local';
      const r = (this.roads[k] ??= { path: P(), w: e.w });
      r.path.moveTo(e.a.x, e.a.z);
      r.path.lineTo(e.b.x, e.b.z);
    }
    this.hillRoads = P();
    this.hillW = 10;
    for (const r of city.ribbons || []) {
      r.pts.forEach(([x, z], i) => (i ? this.hillRoads.lineTo(x, z) : this.hillRoads.moveTo(x, z)));
      this.hillW = r.w;
    }
    this.piers = [];
    for (const p of city.piers || []) {
      const path = P();
      path.moveTo(p.ax, p.az);
      path.lineTo(p.bx, p.bz);
      this.piers.push({ path, w: p.hw * 2 });
    }
    // The blocks (by their color), their lots inside the sidewalks.
    this.blocks = new Map();
    this.lots = P();
    const poly = (path, pts) => {
      pts.forEach(([x, z], i) => (i ? path.lineTo(x, z) : path.moveTo(x, z)));
      path.closePath();
    };
    for (const b of city.blocks) {
      const col = TYPE[b.type] || SHADE[b.district] || C.block;
      if (!this.blocks.has(col)) this.blocks.set(col, P());
      poly(this.blocks.get(col), b.poly);
      // (its lot, inside the sidewalk: not where the inset went wrong at a sharp corner)
      if (b.inner?.length > 2 && !TYPE[b.type] && b.inner.every(([x, z]) => pointInPoly(x, z, b.poly))) poly(this.lots, b.inner);
    }
    this.buildBuildings();
    // (street names: each street's edges, longest first, for placing its labels)
    this.streets = new Map();
    for (const e of city.edges) {
      if (!e.name || e.culDeSac) continue;
      const len = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z);
      if (len < 25) continue;
      const st = this.streets.get(e.name) || { name: e.name, cls: e.cls, rank: e.rank || 1, edges: [] };
      if ((e.rank || 1) > st.rank) {
        st.rank = e.rank;
        st.cls = e.cls;
      }
      st.edges.push({ ax: e.a.x, az: e.a.z, bx: e.b.x, bz: e.b.z, len });
      this.streets.set(e.name, st);
    }
    for (const st of this.streets.values()) st.edges.sort((p, q) => q.len - p.len);
    this.streetList = [...this.streets.values()].sort((p, q) => q.rank - p.rank);
  }

  // Building footprints (again after buildings change: city.editBuilding).
  buildBuildings() {
    this.buildings = new Path2D();
    this.shops = new Path2D();
    for (const r of this.game.city.buildings || []) {
      if (r.removed) continue;
      const c = Math.cos(r.ang);
      const s = Math.sin(r.ang);
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [r.cx + (c * i * r.w - s * j * r.d) / 2, r.cz + (s * i * r.w + c * j * r.d) / 2]);
      const path = r.shop !== undefined ? this.shops : this.buildings;
      pts.forEach(([x, z], i) => (i ? path.lineTo(x, z) : path.moveTo(x, z)));
      path.closePath();
    }
  }

  // The base map, in world meters (ctx already scaled by s, pixels per meter). The freeways:
  // fwy, the highway (game.highway.surfaces).
  draw(ctx, s, { lod = LOD(s), terrain = true } = {}) {
    const city = this.game.city;
    const px = (n) => n / s; // (n screen pixels, in meters)
    // Land, hills (the terrain picture, faint), the sea.
    ctx.fillStyle = C.land;
    ctx.fillRect(-400, -400, MAP + 800, MAP + 800);
    if (terrain && city.terrainImg) {
      ctx.globalAlpha = 0.55;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(city.terrainImg, 0, 0, MAP, MAP);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = C.water;
    ctx.fill(this.water);
    ctx.strokeStyle = C.waterEdge;
    ctx.lineWidth = px(2);
    ctx.stroke(this.water);
    // Streets: narrow to wide; never thinner than a pixel or two, so the big ones read.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const minPx = { local: 1, hills: 1, pier: 1, under: 1.6, collector: 1.8, arterial: 3, roundabout: 3 };
    for (const k of ORDER) {
      const r = this.roads[k];
      if (!r) continue;
      ctx.strokeStyle = lod === 0 && (k === 'local' || k === 'hills') ? '#4f545b' : C.roads[k];
      ctx.lineWidth = Math.max(r.w, px(minPx[k]));
      ctx.stroke(r.path);
    }
    ctx.strokeStyle = C.roads.hills;
    ctx.lineWidth = Math.max(this.hillW, px(1));
    ctx.stroke(this.hillRoads);
    ctx.strokeStyle = C.roads.pier;
    for (const p of this.piers) {
      ctx.lineWidth = Math.max(p.w, px(1));
      ctx.stroke(p.path);
    }
    // Blocks over the street edges (they start at the curb); closer, the sidewalks round
    // their lots, the footprints of the buildings on them, the courts, field and park.
    for (const [col, path] of this.blocks) {
      ctx.fillStyle = lod >= 2 && !Object.values(TYPE).includes(col) ? C.sidewalk : col;
      ctx.fill(path);
    }
    if (lod >= 2) {
      ctx.fillStyle = C.lot;
      ctx.fill(this.lots);
    }
    if (lod >= 1) {
      ctx.fillStyle = C.building;
      ctx.fill(this.buildings);
      ctx.fillStyle = '#6b3a34'; // (the gun shops' buildings)
      ctx.fill(this.shops);
      if (lod >= 2) {
        ctx.strokeStyle = C.buildingEdge;
        ctx.lineWidth = px(1);
        ctx.stroke(this.buildings);
        ctx.stroke(this.shops);
      }
      city.drawSites?.(ctx, 1);
    }
    // The freeways on top: a dark edge, then the deck; the ramps thinner and duller (and only
    // faintly from far off, so the loops don't take over).
    const hw = this.game.highway;
    if (hw?.surfaces) {
      for (const pass of [0, 1]) {
        for (const sf of hw.surfaces) {
          if (sf.ramp && lod === 0 && pass === 0) continue;
          const w = sf.hw * 2 * (sf.ramp ? 0.75 : 0.95);
          ctx.globalAlpha = sf.ramp && lod === 0 ? 0.45 : 1;
          ctx.strokeStyle = pass ? (sf.ramp ? C.ramp : C.fwy) : C.fwyEdge;
          ctx.lineWidth = pass ? Math.max(w, px(sf.ramp ? 1.2 : 3)) : Math.max(w, px(sf.ramp ? 1.2 : 3)) + px(sf.ramp ? 1.5 : 2.5);
          ctx.beginPath();
          sf.pts.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // Labels, on screen (toScreen(x, z) -> [sx, sy]): the districts, the freeways, the streets
  // the zoom allows, the bigger roads first; none over another. taken: boxes already used
  // (icons, other labels): [x0, y0, x1, y1].
  labels(ctx, s, toScreen, W, H, taken = [], big = 1) {
    const lod = LOD(s);
    const hit = (b) => taken.some((t) => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1]);
    const halo = (text, x, y, font, fill, stroke = 'rgba(10,12,16,.85)', lw = 3) => {
      ctx.font = font;
      ctx.lineWidth = lw;
      ctx.strokeStyle = stroke;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // Districts: in the background (faint, no halo to speak of), big from far off, fading as you
    // come in; moved up or down off any icon, left out if there's no room.
    const da = lod === 0 ? 0.42 : lod === 1 ? 0.24 : 0;
    if (da > 0) {
      const size = Math.round(Math.max(12, Math.min(22, s * 32)) * big);
      for (const d of DISTRICTS) {
        const [cx, cy] = toScreen(...districtCenter(d));
        const t = d.toUpperCase().split('').join(' ');
        ctx.font = `900 ${size}px Arial`;
        const w = ctx.measureText(t).width;
        if (cx < -w || cx > W + w || cy < -20 || cy > H + 20) continue;
        for (const dy of [0, -1.2, 1.2, -2.4, 2.4]) {
          const sy = cy + dy * size;
          const box = [cx - w / 2, sy - size / 2, cx + w / 2, sy + size / 2];
          if (hit(box)) continue;
          halo(t, cx, sy, `900 ${size}px Arial`, `rgba(235,238,242,${da})`, `rgba(10,12,16,${da * 0.45})`, 3);
          taken.push(box);
          break;
        }
      }
    }
    // Freeway names: a shield on each side of the ring, the crosstown at its ends.
    const shields = [
      [(RING.x0 + RING.x1) / 2, RING.z0, 'RING FWY'], [(RING.x0 + RING.x1) / 2, RING.z1, 'RING FWY'],
      [RING.x0, (RING.z0 + RING.z1) / 2, 'RING FWY'], [RING.x1, (RING.z0 + RING.z1) / 2, 'RING FWY'],
      [XT.x, (XT.z0 + XT.end0) / 2 + 40, 'CROSSTOWN'], [XT.x, (XT.end1 + XT.z1) / 2, 'CROSSTOWN'],
    ];
    if (lod >= 1) {
      for (const [x, z, t] of shields) {
        const [sx, sy] = toScreen(x, z);
        if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
        ctx.font = '900 10px Arial';
        const w = ctx.measureText(t).width + 12;
        const box = [sx - w / 2, sy - 9, sx + w / 2, sy + 9];
        if (hit(box)) continue;
        ctx.fillStyle = '#1f4fa3';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(box[0], box[1], w, 18, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(t, sx, sy + 0.5);
        taken.push(box);
      }
    }
    // Street names along the streets, the important ones first, a few times each when there's
    // room, upright, never over anything else.
    const size = Math.round((lod >= 2 ? 12 : 11) * big);
    for (const st of this.streetList) {
      if (s < (NAME_AT[st.cls] ?? 1.5)) continue;
      const font = `${st.rank >= 5 ? 800 : 700} ${size}px Arial`;
      ctx.font = font;
      const tw = ctx.measureText(st.name).width;
      const placed = [];
      for (const e of st.edges) {
        if (e.len * s < tw + 24) break; // (the rest are shorter)
        const [ax, ay] = toScreen(e.ax, e.az);
        const [bx, by] = toScreen(e.bx, e.bz);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        if (mx < 20 || mx > W - 20 || my < 20 || my > H - 20) continue;
        if (placed.some(([x, y]) => Math.hypot(x - mx, y - my) < 320)) continue;
        let ang = Math.atan2(by - ay, bx - ax);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        const hx = (Math.abs(Math.cos(ang)) * tw + Math.abs(Math.sin(ang)) * size) / 2 + 3;
        const hy = (Math.abs(Math.sin(ang)) * tw + Math.abs(Math.cos(ang)) * size) / 2 + 3;
        const box = [mx - hx, my - hy, mx + hx, my + hy];
        if (hit(box)) continue;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        halo(st.name, 0, 0.5, font, st.rank >= 5 ? '#ffffff' : '#e3e6ea', 'rgba(14,16,20,.9)', 3);
        ctx.restore();
        taken.push(box);
        placed.push([mx, my]);
        if (placed.length >= 3) break;
      }
    }
    return taken;
  }
}
