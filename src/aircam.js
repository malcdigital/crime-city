import * as THREE from 'three';
import { dist, lerp } from './util.js';

const W = 640;
const H = 360;
const FPS = 10;
const PRE = 6; // seconds kept before an incident
const POST = 3; // seconds recorded after it
const MAX_CLIPS = 8;
const RANGE = 200; // the helicopter only films incidents this close to it

// Police helicopter footage. While the helicopter is up and chasing, a second camera on
// its belly films the scene. The last few seconds are kept (as compressed JPEGs, made in the
// background); when something newsworthy happens nearby, those frames plus a few more
// become a clip attached to the phone news story.
export class AirCam {
  constructor(game) {
    this.game = game;
    this.rt = new THREE.WebGLRenderTarget(W, H);
    this.rt.texture.colorSpace = THREE.SRGBColorSpace; // same colors as the screen
    this.cam = new THREE.PerspectiveCamera(26, W / H, 0.5, 900);
    this.buf = new Uint8Array(W * H * 4);
    this.ring = []; // { blob } (blob fills in once encoded)
    this.t = 0;
    this.focus = null;
    this.focusUntil = 0;
    this.recording = null;
    this.lastClipT = -99;
    this.clips = [];
    // Scratch canvases: raw pixels come out upside down, so draw them flipped.
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

  heli() {
    const h = this.game.police.heli;
    return h && !h.removed && h.state === 'pursuit' ? h : null;
  }

  // Something newsworthy happened at (x, z). Returns a clip if the helicopter is up and close
  // enough to have filmed it, otherwise null.
  incident(headline, x, z) {
    const game = this.game;
    const h = this.heli();
    if (!h || dist(h.x, h.z, x, z) > RANGE) return null;
    if (this.recording || game.time - this.lastClipT < 12) return null;
    this.lastClipT = game.time;
    this.focus = [x, z];
    this.focusUntil = game.time + POST + 1;
    const clip = {
      headline,
      time: game.hud.clock(),
      frames: [...this.ring],
      post: Math.max(POST, 8 - this.ring.length / FPS), // little footage from before? film longer after
      ready: false,
      urls: null,
    };
    this.recording = clip;
    return clip;
  }

  update(dt) {
    // A finished clip is ready once all its frames are encoded.
    for (const c of this.clips) {
      if (!c.ready && c.frames.every((f) => f.blob)) {
        c.urls = c.frames.map((f) => URL.createObjectURL(f.blob));
        c.frames = null;
        c.ready = true;
        c.onReady?.();
      }
    }
    if (!this.heli() && !this.recording) {
      this.ring.length = 0;
      return;
    }
    this.t += dt;
    if (this.t < 1 / FPS) return;
    this.t = 0;
    this.capture();
  }

  capture() {
    const game = this.game;
    const h = this.heli();
    const rec = this.recording;
    if (!h) {
      // Lost the helicopter mid-clip: finish with what we have.
      if (rec) this.finish(rec);
      return;
    }
    // Never film from inside a building.
    if (game.city.los.some((b) => h.x > b.minX && h.x < b.maxX && h.z > b.minZ && h.z < b.maxZ && h.y - 2.2 < (b.h || 30))) return;
    const [px, pz] = game.player.pos();
    const [fx, fz] = this.focus && game.time < this.focusUntil ? this.focus : [px, pz];
    const cam = this.cam;
    cam.position.set(h.x, h.y - 2.2, h.z);
    this.look = this.look ? [lerp(this.look[0], fx, 0.35), lerp(this.look[1], fz, 0.35)] : [fx, fz];
    cam.lookAt(this.look[0], 1, this.look[1]);

    const r = game.renderer;
    const beamVis = h.beam.visible;
    h.beam.visible = false; // don't film through our own light cone
    const autoShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.render(game.scene, cam);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = autoShadow;
    h.beam.visible = beamVis;
    r.readRenderTargetPixels(this.rt, 0, 0, W, H, this.buf);

    // Compress to JPEG in the background.
    this.imgData.data.set(this.buf);
    this.rawCtx.putImageData(this.imgData, 0, 0);
    this.outCtx.save();
    this.outCtx.scale(1, -1);
    this.outCtx.drawImage(this.raw, 0, -H);
    this.outCtx.restore();
    const frame = { blob: null };
    this.out.toBlob((b) => (frame.blob = b || new Blob()), 'image/jpeg', 0.82);
    this.ring.push(frame);
    if (this.ring.length > PRE * FPS) this.ring.shift();

    if (rec) {
      rec.frames.push(frame);
      rec.post -= 1 / FPS;
      if (rec.post <= 0) this.finish(rec);
    }
  }

  finish(rec) {
    this.recording = null;
    if (!rec.frames.length) return;
    this.clips.push(rec);
    while (this.clips.length > MAX_CLIPS) {
      const old = this.clips.shift();
      old.urls?.forEach((u) => URL.revokeObjectURL(u));
    }
  }
}

// Full-screen player for a clip, looping, with a broadcast overlay.
export class ClipPlayer {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'clip';
    this.el.className = 'hidden police';
    this.el.innerHTML = `
      <div class="clip-box">
        <canvas width="${W}" height="${H}"></canvas>
        <div class="clip-bug"><span class="rec">●</span> POLICE AIR UNIT 1</div>
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
    this.imgs = clip.urls.map((src) => {
      const im = new Image();
      im.src = src;
      return im;
    });
    this.i = 0;
    this.acc = 0;
    this.open = true;
    this.el.classList.remove('hidden');
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
    if (im.complete && im.naturalWidth) this.ctx.drawImage(im, 0, 0, W, H);
    const secs = Math.floor(this.i / FPS);
    this.el.querySelector('.clip-time').textContent = `${this.clip.time} · 00:${String(secs).padStart(2, '0')}`;
    this.el.querySelector('.rec').style.opacity = Math.floor(performance.now() / 500) % 2 ? 1 : 0.2;
  }
}
