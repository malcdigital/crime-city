import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pointInPoly, polyDist, closestOnPoly, bbox, obb, mulberry } from './geom.js';
// (how far in from a polygon's edge: polyDist is 0 anywhere inside)
const edgeDist = (x, z, poly) => closestOnPoly(x, z, poly).d;
import { carModel, trimMat } from './carmodels.js';
import { VTYPES } from './vehicle.js';
import { ProjectsLife } from './projectslife.js';

// The Projects' courtyards (the open ground between the brick rows, which was bare grass): what
// a housing project has out there. Each block gets a few of these, wherever there's room:
//   playground  - a rubber pad, a swing set, a slide, spring riders, a bench
//   court       - an asphalt half-court, painted lines, a hoop with a chain net, chain-link fence
//   benches     - a pair facing each other, a trash can
//   cards       - a folding table, four chairs, dominoes, a radio
//   cookout     - a picnic table, a kettle grill (smoking when it's lit), a cooler, chairs
//   clothes     - a clothesline on two T-posts, washing hanging out
//   dumpsters   - two by a building's end, bags of trash
//   parking     - a striped pad, its spaces filled by parking.js (real cars close up)
//   jacked      - a car up on stands with the hood open, a wheel off, a toolbox
// and on the buildings' end walls, the Southside Kings' tags; on one, an RIP wall with candles,
// flowers and a teddy bear. The people out there (and the Kings' lookouts and trap spot):
// projectslife.js.
//
// Everything's static and merged per block (a few draw calls a block); the solid bits (play
// equipment, tables, the fence, dumpsters, the car) are colliders.

const RADIUS = { green: 4.2, playground: 5.6, court: 7.2, benches: 2.6, cards: 2.4, cookout: 3.6, clothes: 3.4, parking: 6.6, jacked: 3.6, dumpsters: 2.4 };

// Outdoor materials: lit by the sun like the rest of the street (not the rooms' night glow).
const VCOL = new THREE.MeshLambertMaterial({ vertexColors: true });
const _c = new THREE.Color();

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Chain-link: a diamond mesh, see-through between the wires.
let CHAIN = null;
function chainMat() {
  if (CHAIN) return CHAIN;
  const t = canvasTex(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(190,196,200,1)';
    g.lineWidth = 3;
    g.beginPath();
    for (const o of [-64, -32, 0, 32, 64]) {
      g.moveTo(o, 0);
      g.lineTo(o + 64, 64);
      g.moveTo(o + 64, 0);
      g.lineTo(o, 64);
    }
    g.stroke();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  CHAIN = new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide });
  return CHAIN;
}

// The Kings' tags and the RIP wall, all on one sheet: [u0, v0, u1, v1] of each on it.
let TAGS = null;
function tagSheet() {
  if (TAGS) return TAGS;
  const rects = [];
  const t = canvasTex(1024, 1024, (g) => {
    g.clearRect(0, 0, 1024, 1024);
    const drip = (x, y, w, col) => {
      g.fillStyle = col;
      for (let k = 0; k < 7; k++) {
        const dx = x + (k / 7) * w + Math.random() * 10;
        g.fillRect(dx, y, 3, 10 + Math.random() * 30);
      }
    };
    const crown = (x, y, s, col) => {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(x - s, y + s * 0.5);
      g.lineTo(x - s, y - s * 0.3);
      g.lineTo(x - s * 0.5, y + s * 0.1);
      g.lineTo(x, y - s * 0.6);
      g.lineTo(x + s * 0.5, y + s * 0.1);
      g.lineTo(x + s, y - s * 0.3);
      g.lineTo(x + s, y + s * 0.5);
      g.closePath();
      g.fill();
    };
    const purple = ['#8e24aa', '#6a1b9a', '#ab47bc', '#7b1fa2'];
    const cell = (i, draw) => {
      const x = (i % 2) * 512;
      const y = Math.floor(i / 2) * 256;
      g.save();
      g.translate(x, y);
      draw();
      g.restore();
      rects.push([x / 1024, 1 - (y + 256) / 1024, (x + 512) / 1024, 1 - y / 1024]);
    };
    // 0: SSK bubble letters with a crown
    cell(0, () => {
      g.font = '900 150px Arial Black, Arial';
      g.textAlign = 'center';
      g.lineJoin = 'round';
      g.lineWidth = 18;
      g.strokeStyle = '#111';
      g.strokeText('SSK', 256, 180);
      g.fillStyle = purple[0];
      g.fillText('SSK', 256, 180);
      g.lineWidth = 4;
      g.strokeStyle = '#f3e5f5';
      g.strokeText('SSK', 256, 180);
      crown(256, 55, 40, '#ffd23f');
      drip(110, 190, 300, purple[0]);
    });
    // 1: KINGS in a quick hand style
    cell(1, () => {
      g.font = 'italic 900 120px Arial Black, Arial';
      g.textAlign = 'center';
      g.lineWidth = 10;
      g.strokeStyle = '#1a1a1a';
      g.strokeText('KINGS', 256, 160);
      g.fillStyle = purple[2];
      g.fillText('KINGS', 256, 160);
      crown(430, 70, 28, purple[1]);
      drip(70, 170, 360, purple[2]);
    });
    // 2: a crown and "SOUTHSIDE"
    cell(2, () => {
      crown(256, 110, 80, purple[1]);
      g.font = '900 64px Arial Black, Arial';
      g.textAlign = 'center';
      g.fillStyle = '#e1bee7';
      g.fillText('SOUTHSIDE', 256, 220);
    });
    // 3: a throw-up (fat outline letters, a fill of a different color)
    cell(3, () => {
      g.font = '900 170px Arial Black, Arial';
      g.textAlign = 'center';
      g.lineWidth = 22;
      g.strokeStyle = purple[3];
      g.strokeText('SK', 256, 190);
      g.fillStyle = '#f5f5f5';
      g.fillText('SK', 256, 190);
      g.fillStyle = '#111';
      g.font = '700 40px Arial';
      g.fillText('4LIFE', 400, 230);
    });
    // 4 + 5: the RIP wall (two cells wide: a whole row)
    {
      const y = 2 * 256 + 256;
      g.save();
      g.translate(0, y);
      g.fillStyle = '#2b2f4a';
      g.fillRect(0, 0, 1024, 256);
      const grd = g.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, '#6a1b9a');
      grd.addColorStop(1, '#1a237e');
      g.fillStyle = grd;
      g.fillRect(8, 8, 1008, 240);
      // (his portrait: a face in a circle, clouds, wings)
      g.fillStyle = '#fff';
      for (const [cx, cy, r] of [[150, 170, 60], [210, 190, 50], [90, 195, 45], [870, 170, 60], [930, 195, 45], [810, 190, 50]]) {
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#f3e5f5';
      g.beginPath();
      g.arc(512, 112, 92, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#6d4c41';
      g.beginPath();
      g.arc(512, 112, 72, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3e2723';
      g.fillRect(462, 52, 100, 26);
      g.fillStyle = '#111';
      g.fillRect(488, 100, 14, 8);
      g.fillRect(522, 100, 14, 8);
      g.fillRect(496, 140, 32, 6);
      crown(512, 30, 34, '#ffd23f');
      g.font = '900 64px Arial Black, Arial';
      g.textAlign = 'center';
      g.fillStyle = '#ffd23f';
      g.fillText('R.I.P.', 270, 90);
      g.fillText('LIL DRE', 760, 90);
      g.font = '700 28px Arial';
      g.fillStyle = '#fff';
      g.fillText('FOREVER SOUTHSIDE · 2004 - 2023', 512, 238);
      g.restore();
      rects.push([0, 1 - (y + 256) / 1024, 1, 1 - y / 1024]);
    }
  });
  TAGS = { mat: new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.08, depthWrite: true, polygonOffset: true, polygonOffsetFactor: -2 }), rects };
  return TAGS;
}

export class Projects {
  constructor(game) {
    this.game = game;
    const city = game.city;
    this.city = city;
    this.blocks = [];
    this.parkSpots = []; // (parking.js fills these)
    city.projectSpots = this.parkSpots;
    const proj = city.blocks.filter((b) => b.district === 'The Projects' && (b.type === 'normal' || b.type === 'store') && b.inner);
    const home = city.gangHome;
    // (the block nearest the Kings' corner gets the RIP wall)
    const ripBlock = proj.reduce((best, b) => (!best || Math.hypot(b.cx - home.x, b.cz - home.z) < Math.hypot(best.cx - home.x, best.cz - home.z) ? b : best), null);
    proj.forEach((b, i) => this.blocks.push(this.build(b, i, b === ripBlock)));
    this.life = new ProjectsLife(game, this);
  }

  // Is (x, z) open ground on this block: inside it, off the sidewalk, clear of the buildings,
  // the reserved ground (courts, lots, park), the gang hangouts?
  free(b, x, z, pad = 0) {
    const city = this.city;
    if (!pointInPoly(x, z, b.inner) || edgeDist(x, z, b.inner) < 2.2 + pad) return false;
    for (const o of b.buildings) {
      if (o.removed || !o.R) continue;
      if (pointInPoly(x, z, o.R) || polyDist(x, z, o.R) < 2.4 + pad) return false;
    }
    for (const [x0, z0, x1, z1] of city.reserved || []) if (x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad) return false;
    for (const h of [city.gangHome, city.crewHome]) if (h && Math.hypot(h.x - x, h.z - z) < 14 + pad) return false;
    for (const s of this.taken) if (Math.hypot(s[0] - x, s[1] - z) < s[2] + pad) return false;
    return true;
  }

  // Room for something round (x, z) r meters across every way?
  fits(b, x, z, r) {
    if (!this.free(b, x, z)) return false;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      if (!this.free(b, x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
      if (!this.free(b, x + Math.cos(a) * r * 0.55, z + Math.sin(a) * r * 0.55)) return false;
    }
    return true;
  }

  build(b, bi, rip) {
    const game = this.game;
    const city = this.city;
    const rng = mulberry(9001 + bi * 131);
    this.taken = [];
    const B = { b, stations: [], group: new THREE.Group(), cx: b.cx, cz: b.cz };
    game.scene.add(B.group);
    const buckets = new Map();
    const put = (geo, m) => {
      if (geo.index) geo = geo.toNonIndexed(); // (all one kind, or the merge won't have them)
      if (typeof m === 'number') {
        _c.setHex(m);
        const n = geo.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        m = VCOL;
      }
      if (!buckets.has(m)) buckets.set(m, []);
      buckets.get(m).push(geo);
    };
    // ---- Where things go ----
    const bb = bbox(b.inner);
    const cand = [];
    for (let x = bb.minX + 4; x < bb.maxX - 4; x += 2.5) for (let z = bb.minZ + 4; z < bb.maxZ - 4; z += 2.5) cand.push([x, z]);
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    // (lined up with the nearest building, so it all sits square)
    const angleAt = (x, z) => {
      let best = null;
      let bd = Infinity;
      for (const o of b.buildings) {
        if (o.removed || !o.R) continue;
        const d = Math.hypot(o.cx - x, o.cz - z);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      return best ? best.ang : Math.atan2(b.frontSide.uz, b.frontSide.ux);
    };
    const place = (kind) => {
      const r = RADIUS[kind];
      for (const [x, z] of cand) {
        if (!this.fits(b, x, z, r)) continue;
        this.taken.push([x, z, r + 1.2]);
        const st = this.station(B, kind, x, z, angleAt(x, z) + (rng() < 0.5 ? 0 : Math.PI), put, rng);
        B.stations.push(st);
        return st;
      }
      return null;
    };
    const plan = bi % 2 ? ['court', 'playground', 'cookout', 'cards', 'benches', 'parking', 'clothes', 'benches', 'jacked'] : ['playground', 'court', 'cards', 'cookout', 'benches', 'clothes', 'parking', 'jacked', 'benches'];
    for (const kind of plan) place(kind);
    // (and the rest of the open ground: grass beds with trees in them, a few to a block)
    for (let k = 0; k < 7; k++) if (!place('green')) break;
    // ---- On the walls: dumpsters at the ends of the rows, the Kings' tags, the RIP wall ----
    const tags = tagSheet();
    let ripDone = !rip;
    for (const o of b.buildings) {
      if (o.removed || !o.R || o.w < 20) continue;
      for (const end of [-1, 1]) {
        // (the end wall: its middle, facing out along the row)
        const ox = o.cx + Math.cos(o.ang) * end * (o.w / 2);
        const oz = o.cz + Math.sin(o.ang) * end * (o.w / 2);
        const nx = Math.cos(o.ang) * end;
        const nz = Math.sin(o.ang) * end;
        const fx = ox + nx * 2.5;
        const fz = oz + nz * 2.5;
        if (!pointInPoly(fx, fz, b.inner)) continue;
        const gy = city.groundY(ox + nx * 0.2, oz + nz * 0.2);
        const face = Math.atan2(nx, nz); // (a plane facing out of the wall)
        if (!ripDone && edgeDist(fx, fz, b.inner) > 3) {
          ripDone = true;
          this.rip(B, ox + nx * 0.06, gy, oz + nz * 0.06, face, nx, nz, put, tags);
          continue;
        }
        if (rng() < 0.75) {
          const [u0, v0, u1, v1] = tags.rects[Math.floor(rng() * 4)];
          const w = 3.2 + rng() * 1.5;
          const h = w * 0.5;
          const g = new THREE.PlaneGeometry(w, h);
          const uv = g.attributes.uv;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
          g.rotateY(face);
          const side = (rng() - 0.5) * (o.d - w) * 0.6;
          g.translate(ox + nx * 0.05 - nz * side, gy + 0.9 + h / 2 + rng() * 0.6, oz + nz * 0.05 + nx * side);
          put(g, tags.mat);
        }
        // (dumpsters by some of the ends, if there's room)
        if (rng() < 0.22 && this.free(b, fx + nx * 0.5, fz + nz * 0.5, -1.2)) {
          const st = this.station(B, 'dumpsters', ox + nx * 1.7, oz + nz * 1.7, Math.atan2(nz, nx) + Math.PI / 2, put, rng);
          B.stations.push(st);
        }
      }
    }
    // ---- The Kings' spots: the corners a lookout stands on, and the trap stoop ----
    B.corners = [];
    const ring = b.poly;
    for (let k = 0; k < ring.length; k++) {
      const [x, z] = ring[k];
      const [ax, az] = ring[(k + ring.length - 1) % ring.length];
      const [bx, bz] = ring[(k + 1) % ring.length];
      const ta = Math.atan2(az - z, ax - x);
      const tb = Math.atan2(bz - z, bx - x);
      if (Math.abs(Math.atan2(Math.sin(ta - tb), Math.cos(ta - tb))) > 2.6) continue; // (not a real corner)
      const dx = b.cx - x;
      const dz = b.cz - z;
      const L = Math.hypot(dx, dz) || 1;
      const cx = x + (dx / L) * 2.2;
      const cz = z + (dz / L) * 2.2;
      B.corners.push({ x: cx, z: cz, h: Math.atan2(-dx, -dz) }); // (facing out, at the street)
    }
    B.corners = B.corners.sort(() => rng() - 0.5).slice(0, 2);
    if (rip) this.trap(B, put, rng);
    // ---- Merge it ----
    for (const [m, geos] of buckets) {
      const g = mergeGeometries(geos, false);
      for (const q of geos) q.dispose();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = m === VCOL;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      B.group.add(mesh);
    }
    return B;
  }

  // One thing in the courtyard, in its own frame: (u, v) on the ground round (cx, cz), turned a.
  station(B, kind, cx, cz, a, put, rng) {
    const game = this.game;
    const city = this.city;
    const gy = city.groundY(cx, cz);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const W = (u, v) => [cx + u * ca - v * sa, cz + u * sa + v * ca];
    const st = { kind, x: cx, z: cz, a, y: gy, W, seats: [], spots: [], solids: [] };
    // (a box, the frame's way round; solid: a collider for it)
    const box = (u0, u1, y0, y1, v0, v1, m, solid = false) => {
      const g = new THREE.BoxGeometry(u1 - u0, y1 - y0, v1 - v0);
      g.rotateY(-a);
      const [x, z] = W((u0 + u1) / 2, (v0 + v1) / 2);
      g.translate(x, gy + (y0 + y1) / 2, z);
      put(g, m);
      if (solid) {
        const c = obb(x, z, (u1 - u0) / 2, (v1 - v0) / 2, a, y1 - y0, gy + y0);
        city.colliders.push(c);
        city.los.push(c);
        st.solids.push(c);
      }
    };
    // (any shape made in the frame: turned, moved into place)
    const geo = (g, m, u = 0, y = 0, v = 0) => {
      g.rotateY(-a);
      const [x, z] = W(u, v);
      g.translate(x, gy + y, z);
      put(g, m);
    };
    const cyl = (u, v, y0, y1, r, m, seg = 8, r2 = r) => geo(new THREE.CylinderGeometry(r, r2, y1 - y0, seg).translate(0, (y0 + y1) / 2, 0), m, u, 0, v);
    // (a pole from one point to another in the frame)
    const rod = (u0, y0, v0, u1, y1, v1, r, m) => {
      const L = Math.hypot(u1 - u0, y1 - y0, v1 - v0);
      const g = new THREE.CylinderGeometry(r, r, L, 6);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(u1 - u0, y1 - y0, v1 - v0).normalize());
      g.applyQuaternion(q);
      g.translate((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
      geo(g, m);
    };
    // A bench (seat facing +v in its own turn r: 0 / PI).
    const bench = (u, v, turn = 0, len = 1.8) => {
      const s = turn ? -1 : 1;
      box(u - len / 2, u + len / 2, 0.42, 0.47, v - 0.22, v + 0.22, 0x8a5a32, true);
      box(u - len / 2, u + len / 2, 0.58, 0.88, v - s * 0.24, v - s * 0.2, 0x8a5a32);
      for (const du of [-len / 2 + 0.12, len / 2 - 0.12]) {
        box(u + du - 0.04, u + du + 0.04, 0, 0.42, v - 0.2, v + 0.2, 0x2f3338);
        box(u + du - 0.04, u + du + 0.04, 0.42, 0.88, v - s * 0.26, v - s * 0.2, 0x2f3338);
      }
      for (const du of [-len / 4, len / 4]) {
        const [x, z] = W(u + du, v + s * 0.02);
        st.seats.push({ x, z, y: gy + 0.45, h: faceH(a, s) });
      }
    };
    // (the heading of someone sitting facing +v (s = 1) or -v (s = -1) in this frame)
    function faceH(ang, s) {
      // (+v in the world is (-sin a, cos a))
      return Math.atan2(-Math.sin(ang) * s, Math.cos(ang) * s);
    }
    const chair = (u, v, s, color = 0xf2f2ee) => {
      // (a white plastic chair; s: the way it faces, +1 / -1 along v)
      box(u - 0.22, u + 0.22, 0.42, 0.46, v - 0.22, v + 0.22, color);
      box(u - 0.22, u + 0.22, 0.46, 0.85, v - s * 0.25, v - s * 0.21, color);
      for (const du of [-0.19, 0.19]) for (const dv of [-0.19, 0.19]) box(u + du - 0.02, u + du + 0.02, 0, 0.42, v + dv - 0.02, v + dv + 0.02, color);
      const [x, z] = W(u, v);
      st.seats.push({ x, z, y: gy + 0.45, h: faceH(a, s) });
    };
    // (one facing along u instead: s +1 faces +u)
    const chairU = (u, v, s, color = 0xf2f2ee) => {
      box(u - 0.22, u + 0.22, 0.42, 0.46, v - 0.22, v + 0.22, color);
      box(u - s * 0.25, u - s * 0.21, 0.46, 0.85, v - 0.22, v + 0.22, color);
      for (const du of [-0.19, 0.19]) for (const dv of [-0.19, 0.19]) box(u + du - 0.02, u + du + 0.02, 0, 0.42, v + dv - 0.02, v + dv + 0.02, color);
      const [x, z] = W(u, v);
      st.seats.push({ x, z, y: gy + 0.45, h: s > 0 ? Math.atan2(ca, sa) : Math.atan2(-ca, -sa) });
    };
    const spot = (u, v, s = 1) => {
      const [x, z] = W(u, v);
      st.spots.push({ x, z, h: faceH(a, s) });
    };

    if (kind === 'green') {
      // a grass bed behind a low curb, two trees, a few bushes
      box(-3.4, 3.4, 0, 0.06, -2.4, 2.4, 0x4c7a3c);
      for (const [u0, u1, v0, v1] of [[-3.5, 3.5, -2.5, -2.4], [-3.5, 3.5, 2.4, 2.5], [-3.5, -3.4, -2.5, 2.5], [3.4, 3.5, -2.5, 2.5]]) box(u0, u1, 0, 0.18, v0, v1, 0x8a8c8e);
      for (const [u, v] of [[-1.7 + rng() * 0.6, -0.6 + rng()], [1.4 + rng() * 0.6, 0.2 - rng()]]) {
        const h = 2.6 + rng() * 1.4;
        cyl(u, v, 0, h, 0.14, 0x5a3a22, 6, 0.18);
        const crown = new THREE.IcosahedronGeometry(1.4 + rng() * 0.5, 0);
        crown.scale(1, 0.9, 1);
        geo(crown, [0x2e6b30, 0x3a7d34, 0x285e2b][Math.floor(rng() * 3)], u, h + 0.9, v);
        const c = obb(...W(u, v), 0.2, 0.2, a, h, gy);
        city.colliders.push(c);
        st.solids.push(c);
      }
      for (let k = 0; k < 4; k++) {
        const g = new THREE.IcosahedronGeometry(0.45 + rng() * 0.25, 0);
        g.scale(1, 0.7, 1);
        geo(g, 0x3b6b2e, -3 + rng() * 6, 0.3, (rng() < 0.5 ? -1 : 1) * (1.6 + rng() * 0.5));
      }
    } else if (kind === 'playground') {
      box(-4.6, 4.6, 0, 0.035, -3.6, 3.6, 0xa0442c); // (the rubber surface)
      for (const [u0, u1, v0, v1] of [[-4.7, 4.7, -3.7, -3.6], [-4.7, 4.7, 3.6, 3.7], [-4.7, -4.6, -3.7, 3.7], [4.6, 4.7, -3.7, 3.7]]) box(u0, u1, 0, 0.12, v0, v1, 0x6d6e72); // (its curb)
      // swings: an A-frame each end, a beam, two seats on chains (pivots: projectslife.js swings them)
      const SU = [-4.0, -0.6];
      const sv = -1.4;
      for (const u of SU) {
        rod(u, 0, sv - 0.9, u, 2.35, sv, 0.05, 0x2d6cdf);
        rod(u, 0, sv + 0.9, u, 2.35, sv, 0.05, 0x2d6cdf);
      }
      st.solids.push(...[]);
      rod(SU[0], 2.35, sv, SU[1], 2.35, sv, 0.06, 0x2d6cdf);
      st.swings = [];
      for (const u of [-3.1, -1.5]) {
        const [x, z] = W(u, sv);
        const piv = new THREE.Group();
        piv.position.set(x, gy + 2.33, z);
        piv.rotation.order = 'YXZ'; // (turned to the frame, then swinging about its own beam)
        piv.rotation.y = -a;
        const ropeM = new THREE.MeshLambertMaterial({ color: 0x9a9a9a });
        for (const du of [-0.22, 0.22]) {
          const r = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.85, 0.02), ropeM);
          r.position.set(du, -0.93, 0);
          piv.add(r);
        }
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.2), new THREE.MeshLambertMaterial({ color: 0x222222 }));
        seat.position.set(0, -1.86, 0);
        piv.add(seat);
        B.group.add(piv);
        st.swings.push({ piv, x, z, y: gy + 0.47, h: faceH(a, 1), amp: 0, t: Math.random() * 6, who: null });
      }
      // the slide: a platform on posts, a ladder up one side, the chute down toward +v
      const pu = 2.4;
      const pv = -1.2;
      box(pu - 0.55, pu + 0.55, 1.45, 1.55, pv - 0.55, pv + 0.55, 0xf1c40f, true);
      for (const du of [-0.5, 0.5]) for (const dv of [-0.5, 0.5]) box(pu + du - 0.05, pu + du + 0.05, 0, 2.3, pv + dv - 0.05, pv + dv + 0.05, 0xc0392b);
      box(pu - 0.55, pu + 0.55, 2.2, 2.32, pv - 0.55, pv + 0.55, 0xc0392b); // (a little roof)
      for (const du of [-0.25, 0.25]) rod(pu + du, 0, pv - 1.5, pu + du, 1.5, pv - 0.55, 0.03, 0x7f8c8d);
      for (let k = 1; k < 5; k++) {
        const t = k / 5;
        rod(pu - 0.25, 1.5 * t, pv - 1.5 + 0.95 * t, pu + 0.25, 1.5 * t, pv - 1.5 + 0.95 * t, 0.02, 0x7f8c8d);
      }
      {
        const L = Math.hypot(2.6, 1.3);
        const g = new THREE.BoxGeometry(0.6, 0.06, L);
        g.rotateX(Math.atan2(1.3, 2.6));
        geo(g, 0x2ecc71, pu, 0.85, pv + 0.55 + 1.3);
        for (const du of [-0.3, 0.3]) {
          const s = new THREE.BoxGeometry(0.04, 0.16, L);
          s.rotateX(Math.atan2(1.3, 2.6));
          geo(s, 0x27ae60, pu + du, 0.93, pv + 0.55 + 1.3);
        }
      }
      st.slide = { ladder: W(pu, pv - 1.7), top: W(pu, pv), end: W(pu, pv + 3.0), topY: gy + 1.55, endY: gy + 0.25, h: faceH(a, 1) };
      // spring riders
      st.riders = [];
      for (const [u, v, c] of [[-2.8, 2.0, 0xe74c3c], [-0.9, 2.2, 0x9b59b6]]) {
        cyl(u, v, 0, 0.45, 0.09, 0x95a5a6, 8);
        box(u - 0.18, u + 0.18, 0.45, 0.75, v - 0.35, v + 0.35, c);
        box(u - 0.1, u + 0.1, 0.75, 0.95, v + 0.25, v + 0.36, c);
        rod(u - 0.2, 0.92, v + 0.3, u + 0.2, 0.92, v + 0.3, 0.02, 0x333333);
        const [x, z] = W(u, v);
        st.riders.push({ x, z, y: gy + 0.75, h: faceH(a, 1), who: null });
      }
      bench(3.4, 2.8, 1);
      st.pad = [-4.2, 4.2, -3.2, 3.2];
    } else if (kind === 'court') {
      const asph = 0x3b3f44;
      box(-5.2, 5.2, 0, 0.04, -4.8, 4.8, asph);
      const line = (u0, u1, v0, v1) => box(u0, u1, 0.04, 0.048, v0, v1, 0xe8e8e0);
      line(-5.1, 5.1, 4.25, 4.33); // (the baseline)
      line(-2.4, -2.32, -1.4, 4.3);
      line(2.32, 2.4, -1.4, 4.3);
      line(-2.4, 2.4, -1.48, -1.4);
      // (the three-point arc, in short pieces)
      for (let k = 0; k < 22; k++) {
        const t0 = Math.PI * (0.08 + (k / 22) * 0.84);
        const t1 = Math.PI * (0.08 + ((k + 1) / 22) * 0.84);
        const R = 5.0;
        const [u0, v0] = [Math.cos(t0) * R, 3.0 - Math.sin(t0) * R];
        const [u1, v1] = [Math.cos(t1) * R, 3.0 - Math.sin(t1) * R];
        const L = Math.hypot(u1 - u0, v1 - v0);
        const g = new THREE.BoxGeometry(L, 0.008, 0.08);
        g.rotateY(-Math.atan2(v1 - v0, u1 - u0));
        geo(g, 0xe8e8e0, (u0 + u1) / 2, 0.044, (v0 + v1) / 2);
      }
      // the hoop: a pole behind the baseline, an arm out, the board, the rim, a chain net
      cyl(0, 4.7, 0, 3.4, 0.08, 0x2f3338, 8);
      box(-0.06, 0.06, 3.0, 3.1, 3.8, 4.7, 0x2f3338);
      box(-0.9, 0.9, 2.85, 3.9, 3.72, 3.8, 0xeeeeee, true);
      box(-0.3, 0.3, 3.05, 3.08, 3.7, 3.72, 0xc0392b);
      {
        const rim = new THREE.TorusGeometry(0.23, 0.018, 6, 16);
        rim.rotateX(Math.PI / 2);
        geo(rim, 0xe67e22, 0, 3.05, 3.43);
        geo(new THREE.CylinderGeometry(0.23, 0.15, 0.4, 10, 1, true).translate(0, -0.2, 0), chainMat(), 0, 3.05, 3.43);
      }
      st.hoop = W(0, 3.43);
      st.hoopY = gy + 3.05;
      // chain-link round three sides (the front's open)
      const fence = (u0, v0, u1, v1) => {
        const L = Math.hypot(u1 - u0, v1 - v0);
        const g = new THREE.PlaneGeometry(L, 3.0);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L * 3, uv.getY(i) * 9);
        g.rotateY(-Math.atan2(v1 - v0, u1 - u0));
        geo(g, chainMat(), (u0 + u1) / 2, 1.5, (v0 + v1) / 2);
        rod(u0, 3.0, v0, u1, 3.0, v1, 0.03, 0x8a9096);
        for (let k = 0; k <= Math.round(L / 2.5); k++) {
          const t = k / Math.round(L / 2.5);
          cyl(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, 0, 3.05, 0.04, 0x8a9096, 6);
        }
        const c = obb(...W((u0 + u1) / 2, (v0 + v1) / 2), L / 2, 0.05, a + Math.atan2(v1 - v0, u1 - u0), 3, gy);
        city.colliders.push(c);
        st.solids.push(c);
      };
      fence(-5.2, 4.8, 5.2, 4.8);
      fence(-5.2, -4.8, -5.2, 4.8);
      fence(5.2, -4.8, 5.2, 4.8);
      spot(-1.5, 0.5, 1);
      spot(2.0, -0.6, 1);
      spot(3.6, 2.2, 1);
      spot(-4.4, -3.6, -1);
      st.pad = [-4.5, 4.5, -3.8, 3.8];
    } else if (kind === 'benches') {
      bench(0, -1.1, 0);
      bench(0, 1.1, 1);
      cyl(1.6, 0, 0, 0.75, 0.24, 0x3a4a3a, 10, 0.2);
      spot(-1.6, 0, 1);
    } else if (kind === 'cards') {
      box(-0.45, 0.45, 0.7, 0.74, -0.45, 0.45, 0x5d4037, true);
      for (const du of [-0.4, 0.4]) for (const dv of [-0.4, 0.4]) box(du - 0.02, du + 0.02, 0, 0.7, dv - 0.02, dv + 0.02, 0x333333);
      // dominoes: a few lines of them, the rest in a pile
      for (let k = 0; k < 9; k++) {
        const du = -0.2 + (k % 5) * 0.09;
        const dv = k < 5 ? -0.05 : 0.08;
        box(du - 0.04, du + 0.04, 0.74, 0.755, dv - 0.02, dv + 0.02, 0xf5f5f0);
      }
      for (let k = 0; k < 5; k++) box(0.22 + rng() * 0.12, 0.3 + rng() * 0.12, 0.74, 0.755, -0.3 + rng() * 0.1, -0.26 + rng() * 0.1, 0xf5f5f0);
      chair(0, -0.8, 1);
      chair(0, 0.8, -1);
      chairU(-0.8, 0, 1);
      chairU(0.8, 0, -1);
      // a boombox on the ground
      box(1.2, 1.65, 0, 0.26, -0.15, 0.1, 0x1a1a1a);
      for (const du of [1.3, 1.55]) cyl(du, -0.155, 0.1, 0.1, 0.07, 0x555555, 8);
      spot(-1.6, -1.0, 1);
    } else if (kind === 'cookout') {
      // picnic table with its benches
      box(-0.9, 0.9, 0.72, 0.77, -0.4, 0.4, 0x8a5a32, true);
      for (const s of [-1, 1]) {
        box(-0.9, 0.9, 0.42, 0.46, s * 0.62 - 0.14, s * 0.62 + 0.14, 0x8a5a32);
        for (const du of [-0.7, 0.7]) box(du - 0.04, du + 0.04, 0, 0.72, s * 0.3 - 0.04, s * 0.3 + 0.04, 0x6e4528);
        for (const du of [-0.45, 0.45]) {
          const [x, z] = W(du, s * 0.62);
          st.seats.push({ x, z, y: gy + 0.45, h: faceH(a, -s) });
        }
      }
      // a red tablecloth, plates, a bag of chips, sodas
      box(-0.88, 0.88, 0.77, 0.775, -0.38, 0.38, 0xc0392b);
      for (const du of [-0.5, 0, 0.5]) cyl(du, 0.15, 0.775, 0.79, 0.11, 0xf5f5f0, 10);
      for (const du of [-0.3, 0.2, 0.6]) cyl(du, -0.18, 0.775, 0.9, 0.035, [0xc0392b, 0x2ecc71, 0xf39c12][Math.floor(rng() * 3)], 7);
      // the kettle grill: a black bowl on legs, the lid on its hook, the coals glowing
      const gu = 2.2;
      geo(new THREE.SphereGeometry(0.32, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, 0.85, 0), 0x1a1a1a, gu, 0, 0);
      for (let k = 0; k < 3; k++) {
        const t = (k / 3) * Math.PI * 2;
        rod(gu + Math.cos(t) * 0.28, 0.6, Math.sin(t) * 0.28, gu + Math.cos(t) * 0.36, 0, Math.sin(t) * 0.36, 0.02, 0x1a1a1a);
      }
      box(gu - 0.3, gu + 0.3, 0.84, 0.86, -0.3, 0.3, 0x555555);
      const coals = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 10), new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
      const [gx, gz] = W(gu, 0);
      coals.position.set(gx, gy + 0.83, gz);
      B.group.add(coals);
      for (const k of [0, 1, 2]) {
        const [x, z] = W(gu - 0.08 + k * 0.08, 0.05 * (k - 1));
        put(new THREE.BoxGeometry(0.1, 0.02, 0.06).rotateY(-a).translate(x, gy + 0.87, z), 0x7a3b1a); // (burgers)
      }
      const gc = obb(gx, gz, 0.36, 0.36, a, 1, gy);
      city.colliders.push(gc);
      st.solids.push(gc);
      st.grill = { x: gx, z: gz, y: gy + 0.9, coals };
      // a cooler, two folding chairs
      box(-2.4, -1.85, 0, 0.42, -0.9, -0.55, 0x1f75fe);
      box(-2.42, -1.83, 0.42, 0.48, -0.92, -0.53, 0xf5f5f5);
      chair(-1.8, 1.4, -1, 0x1f618d);
      chair(-2.6, 0.7, -1, 0x1f618d);
      spot(gu, -0.75, 1); // (at the grill)
      spot(-0.4, -1.5, 1);
      spot(1.1, -1.7, 1);
      spot(-2.9, -1.6, 1);
    } else if (kind === 'clothes') {
      for (const u of [-2.8, 2.8]) {
        cyl(u, 0, 0, 2.05, 0.045, 0x7f8c8d, 6);
        box(u - 0.04, u + 0.04, 1.95, 2.02, -0.65, 0.65, 0x7f8c8d);
      }
      for (const v of [-0.5, 0, 0.5]) rod(-2.8, 1.98, v, 2.8, 1.92, v, 0.006, 0xdddddd);
      const COL = [0xf5f5f5, 0x1f75fe, 0xc0392b, 0xf1c40f, 0x2ecc71, 0x8e44ad, 0x34495e, 0xe67e22, 0xecf0f1];
      for (const v of [-0.5, 0, 0.5]) {
        let u = -2.5;
        while (u < 2.4) {
          const kind2 = rng();
          const w = kind2 < 0.25 ? 1.0 : kind2 < 0.6 ? 0.55 : 0.4;
          const h = kind2 < 0.25 ? 0.95 : kind2 < 0.6 ? 0.65 : 0.8;
          if (u + w > 2.5) break;
          const c = COL[Math.floor(rng() * COL.length)];
          const g = new THREE.BoxGeometry(w, h, 0.012);
          g.rotateY(rng() * 0.1 - 0.05);
          geo(g, c, u + w / 2, 1.93 - h / 2, v);
          if (kind2 >= 0.6) {
            // (pants: two legs)
            geo(new THREE.BoxGeometry(0.02, h * 0.6, 0.014), 0x2a2a2a, u + w / 2, 1.93 - h * 0.7, v);
          }
          u += w + 0.08 + rng() * 0.2;
        }
      }
      // a laundry basket underneath
      box(-1.0, -0.5, 0, 0.32, 0.9, 1.25, 0xf5f5f5);
      box(-0.95, -0.55, 0.32, 0.36, 0.95, 1.2, 0x1f75fe);
      spot(-0.75, 1.6, -1);
    } else if (kind === 'dumpsters') {
      for (const du of [-1.15, 1.15]) {
        box(du - 0.95, du + 0.95, 0.12, 1.25, -0.6, 0.6, 0x1e5a3a, true);
        const lid = new THREE.BoxGeometry(1.95, 0.06, 1.25);
        lid.rotateX(rng() < 0.4 ? -0.5 : -0.05);
        geo(lid, 0x163f2a, du, 1.3, -0.05);
        for (const dw of [-0.75, 0.75]) cyl(du + dw, -0.45, 0, 0.12, 0.07, 0x222222, 6);
      }
      for (let k = 0; k < 4; k++) {
        const g = new THREE.SphereGeometry(0.32, 8, 6);
        g.scale(1, 0.75, 0.9);
        geo(g, 0x111111, -2.4 + rng() * 4.8, 0.22, 0.9 + rng() * 0.5);
      }
    } else if (kind === 'parking') {
      box(-3.6, 3.6, 0, 0.03, -5.8, 5.8, 0x404448);
      // stalls across the pad: lines, wheel stops; parking.js fills about half of them
      for (let k = 0; k <= 4; k++) box(-3.4, -0.4, 0.03, 0.037, -5.4 + k * 2.7 - 0.05, -5.4 + k * 2.7 + 0.05, 0xe8e8e0);
      for (let k = 0; k < 4; k++) {
        const v = -5.4 + k * 2.7 + 1.35;
        box(-3.35, -3.15, 0.03, 0.15, v - 0.6, v + 0.6, 0xa0a0a0);
        const [x, z] = W(-1.9, v);
        if (Math.abs(city.groundY(x, z)) < 0.25 && rng() < 0.65) this.parkSpots.push({ x, z, heading: Math.atan2(-ca, -sa) }); // (nose in, toward -u)
      }
    } else if (kind === 'jacked') {
      // a car up on stands with the hood up: the parked car's stand-in shape, a wheel off
      const M = carModel('sedan', VTYPES.sedan);
      const paint = M.standin.paint.clone();
      const rest = M.standin.rest.clone();
      const color = [0x7a7f87, 0x5b1a7a, 0x2c3e50, 0x8b0000, 0xd4ac0d][Math.floor(rng() * 5)];
      for (const [g, m] of [[paint, new THREE.MeshLambertMaterial({ color })], [rest, trimMat]]) {
        g.rotateY(Math.PI / 2); // (the car's nose along +u)
        g.rotateY(-a);
        g.translate(cx, gy + 0.22, cz);
        const mesh = new THREE.Mesh(g, m);
        mesh.castShadow = true;
        B.group.add(mesh);
      }
      // the hood open, propped up
      {
        // (hinged at the windshield, the front edge up in the air)
        const g = new THREE.BoxGeometry(1.15, 0.04, 1.5);
        g.translate(0.57, 0, 0);
        g.rotateZ(0.95);
        geo(g, color, 0.95, 1.08, 0);
        rod(2.0, 0.95, 0.45, 1.6, 1.85, 0.45, 0.012, 0x888888);
      }
      for (const [du, dv] of [[1.3, -0.75], [1.3, 0.75], [-1.3, -0.75], [-1.3, 0.75]]) box(du - 0.08, du + 0.08, 0, 0.28, dv - 0.08, dv + 0.08, 0xc0392b);
      // a wheel off, leaning on the side; a toolbox; a jack
      {
        const w = new THREE.CylinderGeometry(0.33, 0.33, 0.2, 12);
        w.rotateX(Math.PI / 2);
        w.rotateX(0.25);
        geo(w, 0x1a1a1a, 1.0, 0.36, -1.35);
      }
      box(-0.3, 0.3, 0, 0.28, -1.6, -1.3, 0xc0392b);
      box(-0.28, 0.28, 0.28, 0.3, -1.58, -1.32, 0x922b21);
      box(0.6, 1.0, 0, 0.12, 1.25, 1.45, 0xd35400);
      const c = obb(cx, cz, 2.3, 0.95, a, 1.4, gy);
      city.colliders.push(c);
      city.los.push(c);
      st.solids.push(c);
      spot(2.65, 0.15, -1); // (at the open hood: facing back along it)
      st.spots[0].h = Math.atan2(-ca, -sa); // (facing the engine: -u)
    }
    return st;
  }

  // The trap: a ground-floor door on one of the rows, onto the courtyard. A stoop, the door,
  // boarded-up windows either side, a chair on the step; the dealer stands out front of it.
  trap(B, put, rng) {
    const b = B.b;
    const city = this.city;
    for (const o of b.buildings) {
      if (o.removed || !o.R || o.w < 24) continue;
      for (const sd of [1, -1]) {
        const nx = -Math.sin(o.ang) * sd;
        const nz = Math.cos(o.ang) * sd;
        const along = (rng() - 0.5) * o.w * 0.4;
        const ux = Math.cos(o.ang);
        const uz = Math.sin(o.ang);
        const wx = o.cx + ux * along + nx * (o.d / 2);
        const wz = o.cz + uz * along + nz * (o.d / 2);
        if (!this.free(b, wx + nx * 3.2, wz + nz * 3.2, -0.5)) continue;
        const gy = city.groundY(wx + nx, wz + nz);
        const a = o.ang;
        const box = (u0, u1, y0, y1, v0, v1, c) => {
          const g = new THREE.BoxGeometry(u1 - u0, y1 - y0, v1 - v0);
          g.rotateY(-a);
          const u = (u0 + u1) / 2;
          const v = (v0 + v1) / 2;
          g.translate(wx + ux * u + nx * v, gy + (y0 + y1) / 2, wz + uz * u + nz * v);
          put(g, c);
        };
        box(-1.1, 1.1, 0, 0.18, 0, 1.3, 0x8a8c8e); // (the stoop: two steps)
        box(-1.1, 1.1, 0.18, 0.34, 0, 0.75, 0x9a9c9e);
        box(-0.55, 0.55, 0.34, 2.4, -0.02, 0.06, 0x3b2a1e); // (the door)
        box(0.36, 0.44, 1.2, 1.3, 0.06, 0.1, 0xb0a070);
        for (const s of [-1, 1]) {
          // (boarded-up windows either side: plywood, a couple of planks across)
          box(s * 2.2 - 0.7, s * 2.2 + 0.7, 0.9, 2.3, 0.0, 0.05, 0xb08850);
          for (const y of [1.2, 1.9]) box(s * 2.2 - 0.85, s * 2.2 + 0.85, y - 0.08, y + 0.08, 0.05, 0.09, 0x8a6a3a);
        }
        // (a plastic chair on the step, a crate)
        box(0.75, 1.05, 0.34, 0.78, 0.15, 0.45, 0xf2f2ee);
        box(-1.05, -0.65, 0.34, 0.62, 0.2, 0.55, 0x1f4fa3);
        const fx = wx + nx * 1.8;
        const fz = wz + nz * 1.8;
        this.taken.push([fx, fz, 3]);
        B.trap = { x: fx, z: fz, h: Math.atan2(nx, nz), door: [wx + nx * 0.2, wz + nz * 0.2] };
        return;
      }
    }
  }

  // The RIP wall: the mural on the end of a row, and what people have left at the foot of it.
  rip(B, x, y, z, face, nx, nz, put, tags) {
    this.ripAt = { x, z, nx, nz, b: B };
    const [u0, v0, u1, v1] = tags.rects[4];
    const g = new THREE.PlaneGeometry(7.6, 1.9);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    g.rotateY(face);
    g.translate(x, y + 2.3, z);
    put(g, tags.mat);
    // (along the wall: tx, tz)
    const tx = -nz;
    const tz = nx;
    const flame = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    this.candles = this.candles || [];
    for (let k = 0; k < 11; k++) {
      const s = -2.6 + k * 0.5 + (Math.random() - 0.5) * 0.2;
      const d = 0.25 + Math.random() * 0.35;
      const cx = x + tx * s + nx * d;
      const cz = z + tz * s + nz * d;
      const h = 0.12 + Math.random() * 0.14;
      put(new THREE.CylinderGeometry(0.045, 0.045, h, 8).translate(cx, y + h / 2, cz), [0xf5f5f0, 0x8e24aa, 0xc0392b][k % 3]);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 6), flame);
      f.position.set(cx, y + h + 0.03, cz);
      B.group.add(f);
      this.candles.push(f);
    }
    // flowers, a teddy bear, a photo in a frame, a bottle
    for (let k = 0; k < 6; k++) {
      const s = -2.2 + k * 0.85;
      const cx = x + tx * s + nx * 0.55;
      const cz = z + tz * s + nz * 0.55;
      put(new THREE.CylinderGeometry(0.01, 0.01, 0.35, 4).translate(cx, y + 0.17, cz), 0x2e7d32);
      for (let f = 0; f < 4; f++) put(new THREE.SphereGeometry(0.05, 6, 4).translate(cx + (Math.random() - 0.5) * 0.12, y + 0.36 + Math.random() * 0.06, cz + (Math.random() - 0.5) * 0.12), [0xe91e63, 0xffeb3b, 0xffffff, 0x9c27b0][(k + f) % 4]);
    }
    {
      const cx = x + tx * 0.9 + nx * 0.3;
      const cz = z + tz * 0.9 + nz * 0.3;
      put(new THREE.SphereGeometry(0.16, 8, 6).translate(cx, y + 0.16, cz), 0x8d6e63);
      put(new THREE.SphereGeometry(0.11, 8, 6).translate(cx, y + 0.4, cz), 0x8d6e63);
      for (const s of [-1, 1]) put(new THREE.SphereGeometry(0.04, 6, 4).translate(cx + tx * s * 0.08, y + 0.5, cz + tz * s * 0.08), 0x6d4c41);
    }
    {
      const g = new THREE.BoxGeometry(0.4, 0.5, 0.03);
      g.rotateX(-0.25);
      g.rotateY(face);
      put(g.translate(x + tx * -0.9 + nx * 0.22, y + 0.25, z + tz * -0.9 + nz * 0.22), 0x3e2723);
    }
  }

  update(dt) {
    const t = this.game.time;
    if (this.candles) for (const [k, f] of this.candles.entries()) f.scale.y = 0.85 + Math.sin(t * 9 + k * 1.7) * 0.15;
    this.life.update(dt);
  }
}
