import * as THREE from 'three';
import { CFG, CRED_TIERS } from './config.js';
import { dist, rand } from './util.js';
import { streetAt } from './city.js';
import { pushCircle } from './collision.js';
import { pointInPoly } from './geom.js';
import { blockDist } from './sidewalk.js';

// Claiming an unclaimed block for Green Street. It has to be earned, in three steps:
// 1. Tag it: spray Green Street tags on three walls around the block.
// 2. Shake down the block: lean on the two shop owners until they pay. Some refuse; rough
//    them up (they call the cops) or put a gun on them (they pay quietly).
// 3. Survive the response: the nearest rival gang sends its people. Wipe out every wave.
// You need enough street cred (more the more blocks you hold), you have 12 minutes, and you
// fail if you go down or stay off the block for 20 seconds.

const TAGS = 3;
const TAG_TIME = 3;
const LEAN_TIME = 2;
const AIM_TIME = 1.5;
const LIMIT = 12 * 60;
const AWAY = 20;
const COOLDOWN = 3 * 60 * 1000; // after a failed claim, before you can try that block again
const OWNER_NAMES = ['Mr. Kim', 'Rosa', 'Big Sal', 'Mr. Patel', 'Ms. Lee', 'Tony', 'Mr. Okafor', 'Abuela Rosa', 'Dmitri', 'Mrs. Chen'];

// Cred tier needed to claim another block: Hustler for your first new block, then a tier up
// every few blocks.
export function claimTier(blocksHeld) {
  if (blocksHeld <= 6) return 1;
  if (blocksHeld <= 8) return 2;
  if (blocksHeld <= 11) return 3;
  if (blocksHeld <= 15) return 4;
  return 5;
}

let tagTex = null;
function tagTexture() {
  if (tagTex) return tagTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  g.font = 'italic 900 92px Impact, Arial Black, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.save();
  g.translate(128, 70);
  g.rotate(-0.12);
  g.lineWidth = 14;
  g.strokeStyle = '#0b0b0b';
  g.strokeText('GS', 0, 0);
  g.fillStyle = '#3dff6e';
  g.fillText('GS', 0, 0);
  g.lineWidth = 3;
  g.strokeStyle = '#eaffef';
  g.strokeText('GS', -3, -3);
  g.restore();
  // Drips.
  g.fillStyle = '#2bd659';
  for (let i = 0; i < 6; i++) {
    const x = 70 + Math.random() * 120;
    g.fillRect(x, 100, 3, 12 + Math.random() * 30);
  }
  g.font = 'bold 22px Arial Black, sans-serif';
  g.fillStyle = '#ffffff';
  g.fillText('GREEN ST', 128, 140);
  tagTex = new THREE.CanvasTexture(c);
  tagTex.colorSpace = THREE.SRGBColorSpace;
  return tagTex;
}

// A spray-painted Green Street tag on a wall.
export function makeTag(scene, x, z, nx, nz) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 2),
    new THREE.MeshBasicMaterial({ map: tagTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.position.set(x + nx * 0.04, (scene.userData.groundY ? scene.userData.groundY(x + nx, z + nz) : 0.2) + 1.5, z + nz * 0.04);
  m.rotation.y = Math.atan2(nx, nz);
  scene.add(m);
  return m;
}

// Points on building walls around a block that face open ground you can stand on.
function wallSpots(game, b) {
  const solid = game.city.colliders;
  const blocked = (x, z) => {
    const r = pushCircle(x, z, 0.45, solid);
    return Math.hypot(r.x - x, r.z - z) > 0.05;
  };
  const spots = [];
  for (const w of b.buildings || []) {
    if (!w.w || !w.d || w.w < 4 || w.d < 4) continue;
    const ux = Math.cos(w.ang);
    const uz = Math.sin(w.ang);
    const vx = -uz;
    const vz = ux;
    const faces = [
      [ux, uz, w.w / 2, w.d, vx, vz],
      [-ux, -uz, w.w / 2, w.d, vx, vz],
      [vx, vz, w.d / 2, w.w, ux, uz],
      [-vx, -vz, w.d / 2, w.w, ux, uz],
    ];
    for (const [nx, nz, half, len, ax, az] of faces) {
      for (const off of [-len / 4, len / 4]) {
        const x = w.cx + nx * half + ax * off;
        const z = w.cz + nz * half + az * off;
        const sx = x + nx * 1.1;
        const sz = z + nz * 1.1;
        if (!pointInPoly(sx, sz, b.poly)) continue;
        if (blocked(sx, sz)) continue;
        spots.push({ x, z, nx, nz, sx, sz });
      }
    }
  }
  return spots;
}

// Pick n spots spread out (each as far as possible from the ones already picked).
function spread(spots, n, avoid = []) {
  const out = [];
  const taken = [...avoid];
  const pool = [...spots];
  while (out.length < n && pool.length) {
    let best = 0;
    let bestD = -1;
    pool.forEach((s, i) => {
      const d = taken.length ? Math.min(...taken.map((t) => dist(s.x, s.z, t.x, t.z))) : Math.random() * 10;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    });
    const s = pool.splice(best, 1)[0];
    out.push(s);
    taken.push(s);
  }
  return out;
}

function ring(color, r = 0.9) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.7, r, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

export class Claim {
  constructor(mgr, block) {
    this.mgr = mgr;
    this.game = mgr.game;
    this.block = block;
    this.key = block.key;
    this.street = streetAt(block.cx, block.cz);
    this.stage = 'tag';
    this.t = 0;
    this.awayT = 0;
    this.active = true;
    this.marks = [];
    const spots = wallSpots(this.game, block);
    const edge = (side) => {
      // Fallback: the sidewalk edge (no building wall there).
      const sd = block.sides[side % block.sides.length];
      const x = sd.mx - sd.nx * 3;
      const z = sd.mz - sd.nz * 3;
      return { x, z, nx: sd.nx, nz: sd.nz, sx: x + sd.nx, sz: z + sd.nz };
    };
    let tags = spread(spots, TAGS);
    for (let s = 0; tags.length < TAGS; s++) tags.push(edge(s));
    this.tags = tags.map((s) => ({ ...s, done: false, hold: 0, mark: this.mark(s.sx, s.sz, 0x3dff6e) }));
    const rest = spots.filter((s) => tags.every((t) => dist(s.x, s.z, t.x, t.z) > 8));
    let shops = spread(rest, 2, tags);
    for (let s = 3; shops.length < 2; s--) shops.push(edge(s));
    this.shopSpots = shops;
    this.owners = [];
    this.hold = 0;
    this.game.hud.toast(`Claiming ${this.street}: tag the block (0/${TAGS})`, '#3dff6e');
    this.game.hud.news(`Green Street moving on ${this.street}`, 'info');
  }

  mark(x, z, color) {
    const m = ring(color);
    m.position.set(x, this.game.city.groundY(x, z) + 0.06, z);
    this.game.scene.add(m);
    this.marks.push(m);
    return m;
  }

  unmark(m) {
    if (!m) return;
    this.game.scene.remove(m);
    m.geometry.dispose();
    m.material.dispose();
    this.marks = this.marks.filter((x) => x !== m);
  }

  // Shop owners come out to stand in front of their stores.
  startShakedown() {
    this.stage = 'shake';
    const game = this.game;
    const names = [...OWNER_NAMES].sort(() => Math.random() - 0.5);
    this.owners = this.shopSpots.map((s, i) => {
      const p = game.peds.addAt(s.sx + s.nx * 0.4, s.sz + s.nz * 0.4);
      p.shopkeeper = true;
      p.state = 'shop';
      p.heading = Math.atan2(s.nx, s.nz);
      p.shopHeading = p.heading;
      p.name = names[i];
      return { ped: p, name: names[i], refuse: Math.random() < 0.4, refused: false, paid: false, lean: 0, aim: 0, mark: null };
    });
    for (const o of this.owners) o.mark = this.mark(o.ped.x, o.ped.z, 0xffd36b);
    game.hud.toast('Now shake down the block: make the 2 shop owners pay', '#3dff6e');
  }

  startResponse() {
    const mgr = this.mgr;
    const b = this.block;
    // The closest rival gang answers.
    const rivals = ['kings', 'vipers'].filter((g) => !mgr.underground(g) && mgr.available(g).length);
    const home = (g) => mgr.homeBlock(g) || b;
    rivals.sort((p, q) => dist(home(p).cx, home(p).cz, b.cx, b.cz) - dist(home(q).cx, home(q).cz, b.cx, b.cz));
    const rival = rivals[0];
    if (!rival) {
      this.finish(true);
      return mgr.transferClaim(this);
    }
    this.stage = 'response';
    this.rival = rival;
    this.war = mgr.startWar(b, 'crew', null, true, rival);
    if (!this.war) return this.fail('the block is already in a fight');
    this.game.hud.toast(`${mgr.gangName(rival)} heard about it — they're coming. Hold the block!`, '#ff8080');
  }

  // Shown on the HUD banner.
  summary() {
    const left = Math.max(0, LIMIT - this.t);
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    let step = '';
    if (this.stage === 'tag') step = `1/3 tag the block ${this.tags.filter((t) => t.done).length}/${TAGS}`;
    else if (this.stage === 'shake') step = `2/3 shake down the shops ${this.owners.filter((o) => o.paid).length}/${this.owners.length}`;
    let text = `CLAIMING ${this.street} · ${step} · ${clock}`;
    if (this.awayT > 0) text += ` · get back on the block! ${Math.max(0, AWAY - this.awayT).toFixed(0)}s`;
    return text;
  }

  // Radar markers for what's left to do.
  radar() {
    const out = [];
    if (this.stage === 'tag') for (const t of this.tags) if (!t.done) out.push([t.sx, t.sz, '#2e7d32', 'T']);
    if (this.stage === 'shake') for (const o of this.owners) if (!o.paid) out.push([o.ped.x, o.ped.z, '#c79a1e', '$']);
    return out;
  }

  onBlock(x, z, pad = 8) {
    return blockDist(this.block, x, z) <= pad;
  }

  update(dt) {
    if (!this.active) return;
    const game = this.game;
    if (this.stage === 'response') {
      if (this.war.state !== 'active') {
        const won = this.mgr.owner[this.key] === 'crew';
        this.finish(won);
        if (!won) this.mgr.claimCooldown[this.key] = Date.now() + COOLDOWN;
      }
      return;
    }
    this.t += dt;
    if (game.wastedT > 0) return this.fail('you went down');
    if (game.bustedT > 0) return this.fail('you got busted');
    if (this.t > LIMIT) return this.fail('you ran out of time');
    if (this.mgr.owner[this.key] || this.mgr.warOn(this.key)) return this.fail('someone else moved on the block');
    const [px, pz] = game.player.pos();
    this.awayT = this.onBlock(px, pz) ? 0 : this.awayT + dt;
    if (this.awayT > AWAY) return this.fail('you left the block');
    for (const m of this.marks) m.material.opacity = 0.55 + 0.35 * Math.sin(game.time * 5);

    if (this.stage === 'shake') {
      for (const o of this.owners) {
        if (o.paid) continue;
        const p = o.ped;
        if (o.mark) o.mark.position.set(p.x, game.city.groundY(p.x, p.z) + 0.06, p.z);
        if (!p.alive || p.removed) {
          // Dead men don't pay, but the block gets the message.
          this.pay(o, 0, `${o.name} won't be refusing anyone again`);
          continue;
        }
        // Roughed up after refusing: he pays, then calls the cops.
        if (p.state === 'down' && o.refused) {
          this.pay(o, Math.round(rand(60, 150)), `${o.name} pays up after a beating — and calls the cops`);
          continue;
        }
        // A gun in his face: he pays, quietly.
        const aimed = game.aimingNow && (game.lockTarget === p || game.crosshairOffset(p) < 0.1);
        if (aimed && dist(p.x, p.z, px, pz) < 14) {
          o.aim += dt;
          game.progress = { value: Math.min(1, o.aim / AIM_TIME), label: `${o.name} has a gun on him…` };
          if (o.aim >= AIM_TIME) this.pay(o, Math.round(rand(80, 150)), `${o.name} empties the register for you`);
        } else o.aim = Math.max(0, o.aim - dt);
      }
      if (this.owners.every((o) => o.paid)) this.startResponse();
    }
  }

  pay(o, amount, msg) {
    const game = this.game;
    o.paid = true;
    this.unmark(o.mark);
    o.mark = null;
    if (amount) {
      game.cash += amount;
      game.cred += 20;
      game.sfx.cash?.();
      game.save();
      game.hud.toast(`${msg}  +$${amount}`, '#3dff6e');
    } else game.hud.toast(msg, '#ffd36b');
    if (o.ped.alive && !o.ped.removed) {
      // Done with him: back to his day.
      o.ped.shopkeeper = false;
      if (o.ped.state === 'shop') o.ped.resumeWalking();
    }
  }

  // The interact button while claiming. Returns true if it showed a prompt.
  interact(a, dt) {
    const game = this.game;
    if (this.stage === 'response' || !this.active) return false;
    const [px, pz] = game.player.pos();
    const label = game.input.label('interact');
    if (this.stage === 'tag') {
      const t = this.tags.find((s) => !s.done && dist(s.sx, s.sz, px, pz) < 1.8);
      if (!t) return false;
      if (a.interactHeld) {
        t.hold += dt;
        game.progress = { value: Math.min(1, t.hold / TAG_TIME), label: 'Tagging the wall…' };
        game.player.heading = Math.atan2(-t.nx, -t.nz);
        if (t.hold >= TAG_TIME) {
          t.done = true;
          t.decal = makeTag(game.scene, t.x, t.z, t.nx, t.nz);
          this.unmark(t.mark);
          const n = this.tags.filter((s) => s.done).length;
          if (n < TAGS) game.hud.toast(`Tagged ${n}/${TAGS}`, '#3dff6e');
          else this.startShakedown();
        }
      } else t.hold = 0;
      game.prompt = `Hold ${label} to tag this wall for Green Street`;
      return true;
    }
    // Shakedown.
    const o = this.owners.find((x) => !x.paid && x.ped.standing && dist(x.ped.x, x.ped.z, px, pz) < 2.6);
    if (!o) return false;
    if (o.refused) {
      game.prompt = `${o.name} won't pay. Rough him up, or aim your gun at him`;
      return true;
    }
    if (a.interactHeld) {
      o.lean += dt;
      game.progress = { value: Math.min(1, o.lean / LEAN_TIME), label: `Leaning on ${o.name}…` };
      if (o.lean >= LEAN_TIME) {
        if (o.refuse) {
          o.refused = true;
          game.hud.toast(`${o.name}: "I ain't paying you a dime!"`, '#ff8080');
        } else this.pay(o, Math.round(rand(50, 120)), `${o.name} pays for protection`);
      }
    } else o.lean = 0;
    game.prompt = `Hold ${label} to lean on ${o.name} for protection money`;
    return true;
  }

  fail(why) {
    this.finish(false);
    this.mgr.claimCooldown[this.key] = Date.now() + COOLDOWN;
    this.game.hud.toast(`Claim failed: ${why}`, '#ff8080');
    this.game.hud.news(`Green Street fail to claim ${this.street}`, 'info');
  }

  finish(won) {
    this.active = false;
    for (const m of [...this.marks]) this.unmark(m);
    for (const o of this.owners) {
      if (o.ped.alive && !o.ped.removed && o.ped.shopkeeper) {
        o.ped.shopkeeper = false;
        if (o.ped.state === 'shop') o.ped.resumeWalking();
      }
    }
    // Tags stay if the block is yours; otherwise they get painted over.
    const spots = this.tags.filter((t) => t.done);
    if (won) {
      this.mgr.addTags(this.key, spots.map((t) => [t.x, t.z, t.nx, t.nz]));
      this.game.cred += 150;
      this.game.save();
    }
    for (const t of spots) {
      this.game.scene.remove(t.decal);
      t.decal.geometry.dispose();
      t.decal.material.dispose();
    }
  }
}

export function tierName(i) {
  return CRED_TIERS[i].name;
}

export function tierOf(cred) {
  let i = 0;
  CRED_TIERS.forEach((t, k) => {
    if (cred >= t.min) i = k;
  });
  return i;
}

