import * as THREE from 'three';
import { lerp } from './util.js';
import { rayBox } from './weapons.js';

const W = 320;
const H = 180;
const FPS = 8;
const PRE = 6; // seconds kept before an incident
const POST = 3; // seconds recorded after it
const MAX_CLIPS = 8;

// Aerial footage of incidents. A small second camera films the action from the police
// helicopter when it's up, otherwise from a news chopper circling the scene. The last few
// seconds are always kept; when something newsworthy happens, those frames plus a few more
// become a clip attached to the phone news story.
export class AirCam {
  constructor(game) {
    this.game = game;
    this.rt = new THREE.WebGLRenderTarget(W, H);
    this.cam = new THREE.PerspectiveCamera(34, W / H, 0.5, 900);
    this.ring = []; // { px: Uint8Array, police: bool }
    this.pool = [];
    this.t = 0;
    this.orbit = Math.random() * Math.PI * 2;
    this.focus = null; // [x, z] the camera is following
    this.focusUntil = 0;
    this.recording = null; // clip collecting its post-roll
    this.lastClipT = -99;
    this.clips = [];
    this.convertQ = [];
    // Scratch canvases for turning raw frames into JPEGs.
    this.raw = document.createElement('canvas');
    this.raw.width = W;
    this.raw.height = H;
    this.rawCtx = this.raw.getContext('2d');
    this.out = document.createElement('canvas');
    this.out.width = W;
    this.out.height = H;
    this.outCtx = this.out.getContext('2d');
    this.imgData = this.rawCtx.createImageData(W, H);
  }

  // Something newsworthy happened at (x, z). Returns the clip (or null if one is already
  // being recorded or the last was too recent).
  incident(headline, x, z) {
    const game = this.game;
    if (this.recording || game.time - this.lastClipT < 12) return null;
    game.lastLoudT = game.time; // start filming now if we weren't already
    this.lastClipT = game.time;
    this.focus = [x, z];
    this.focusUntil = game.time + POST + 1;
    const clip = {
      headline,
      street: '',
      time: game.hud.clock(),
      frames: this.ring.map((f) => ({ px: f.px.slice(), police: f.police })),
      images: [],
      post: Math.max(POST, 8 - this.ring.length / FPS), // little footage from before? film longer after
      ready: false,
      police: !!(game.police.heli && game.police.heli.state === 'pursuit'),
    };
    this.recording = clip;
    return clip;
  }

  update(dt) {
    const game = this.game;
    // Convert finished clips to JPEG a few frames at a time (spreads out the work).
    for (let n = 0; n < 3 && this.convertQ.length; n++) {
      const { clip, frame } = this.convertQ.shift();
      clip.images.push(this.toJpeg(frame.px));
      frame.px = null;
      if (clip.images.length === clip.frames.length) {
        clip.frames = null;
        clip.ready = true;
        clip.onReady?.();
      }
    }
    // Only film while something is going on (wanted, recent gunfire or explosions, gang war).
    const active = game.stars > 0 || game.time - (game.lastLoudT ?? -99) < 30 || game.gang?.angry || this.recording;
    if (!active) {
      while (this.ring.length) this.pool.push(this.ring.shift().px);
      return;
    }
    this.t += dt;
    if (this.t < 1 / FPS) return;
    this.t = 0;
    this.capture();
  }

  capture() {
    const game = this.game;
    const [px, pz] = game.player.pos();
    let [fx, fz] = this.focus && game.time < this.focusUntil ? this.focus : [px, pz];
    const heli = game.police.heli;
    const police = !!(heli && heli.state === 'pursuit');
    const cam = this.cam;
    if (police) {
      cam.position.set(heli.x, heli.y - 1.6, heli.z);
      cam.fov = 30;
    } else {
      // News chopper: slow circle high above the scene, cutting to another angle if a
      // building is in the way.
      this.orbit += 0.04;
      const H = 85, R = 48;
      for (let k = 0; k < 9; k++) {
        const a = this.orbit + k * 0.7;
        const x = fx + Math.cos(a) * R, z = fz + Math.sin(a) * R;
        if (k === 8 || !this.blocked(x, H, z, fx, 1, fz)) {
          this.orbit = a;
          cam.position.set(x, H, z);
          break;
        }
      }
      cam.fov = 24;
    }
    // Smoothly track the focus point.
    this.look = this.look ? [lerp(this.look[0], fx, 0.35), lerp(this.look[1], fz, 0.35)] : [fx, fz];
    cam.lookAt(this.look[0], 1, this.look[1]);
    cam.updateProjectionMatrix();

    const r = game.renderer;
    const beam = heli && heli.beam;
    const beamVis = beam && beam.visible;
    if (beam) beam.visible = false; // don't film through our own light cone
    const autoShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.render(game.scene, cam);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = autoShadow;
    if (beam) beam.visible = beamVis;

    const buf = this.pool.pop() || new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(this.rt, 0, 0, W, H, buf);
    const frame = { px: buf, police };
    this.ring.push(frame);
    if (this.ring.length > PRE * FPS) this.pool.push(this.ring.shift().px);

    const rec = this.recording;
    if (rec) {
      rec.frames.push({ px: buf.slice(), police });
      rec.post -= 1 / FPS;
      if (rec.post <= 0) {
        this.recording = null;
        for (const f of rec.frames) this.convertQ.push({ clip: rec, frame: f });
        this.clips.push(rec);
        while (this.clips.length > MAX_CLIPS) this.clips.shift();
      }
    }
  }

  blocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    for (const b of this.game.city.los) {
      if (Math.abs((b.minX + b.maxX) / 2 - (ax + bx) / 2) > 70 || Math.abs((b.minZ + b.maxZ) / 2 - (az + bz) / 2) > 70) continue;
      const t = rayBox(ax, ay, az, dx / len, dy / len, dz / len, b.minX, 0, b.minZ, b.maxX, b.h || 30, b.maxZ);
      if (t !== null && t < len - 2) return true;
    }
    return false;
  }

  // Raw pixels (bottom row first) to an upright JPEG.
  toJpeg(px) {
    this.imgData.data.set(px);
    this.rawCtx.putImageData(this.imgData, 0, 0);
    this.outCtx.save();
    this.outCtx.scale(1, -1);
    this.outCtx.drawImage(this.raw, 0, -H);
    this.outCtx.restore();
    return this.out.toDataURL('image/jpeg', 0.72);
  }
}

// Full-screen player for a clip, looping, with a broadcast overlay.
export class ClipPlayer {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'clip';
    this.el.className = 'hidden';
    this.el.innerHTML = `
      <div class="clip-box">
        <canvas width="${W}" height="${H}"></canvas>
        <div class="clip-bug"><span class="rec">●</span> <span class="src"></span></div>
        <div class="clip-time"></div>
        <div class="clip-reticle"></div>
        <div class="clip-lower"><div class="clip-tag">BREAKING</div><div class="clip-head"></div></div>
        <button class="clip-close" aria-label="Close">✕</button>
      </div>
      <div class="clip-hint">Esc / ○ to close</div>`;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.el.querySelector('.clip-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    this.open = false;
  }

  play(clip) {
    if (!clip || !clip.ready) return;
    this.clip = clip;
    this.imgs = clip.images.map((src) => {
      const im = new Image();
      im.src = src;
      return im;
    });
    this.i = 0;
    this.acc = 0;
    this.open = true;
    this.el.classList.remove('hidden');
    this.el.classList.toggle('police', clip.police);
    this.el.querySelector('.src').textContent = clip.police ? 'POLICE AIR UNIT 1' : 'CH 6 NEWS CHOPPER';
    this.el.querySelector('.clip-head').textContent = clip.headline;
  }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  update(dt) {
    if (!this.open) return;
    this.acc += dt;
    while (this.acc >= 1 / FPS) {
      this.acc -= 1 / FPS;
      this.i = (this.i + 1) % this.imgs.length;
    }
    const im = this.imgs[this.i];
    if (im.complete) this.ctx.drawImage(im, 0, 0);
    const secs = this.i / FPS;
    this.el.querySelector('.clip-time').textContent = `${this.clip.time} · 00:0${Math.floor(secs)}`;
    this.el.querySelector('.rec').style.opacity = Math.floor(performance.now() / 500) % 2 ? 1 : 0.2;
  }
}

