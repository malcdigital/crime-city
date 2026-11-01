import * as THREE from 'three';
import { gunModel, ammoModel, vestModel } from './gunmodels.js';
import { PHONE } from './quality.js';

// The gun shop's carousel stage (shops.js): the item you're looking at, turning slowly under a
// spotlight, in its own little renderer on the menu's canvas. A new item slides in from the side
// you went (left or right). show(preview, dir): preview is { gun }, { ammo } (a gun and a box of
// its rounds), { armor } or { crew: gun id or 'vest' }.

export class ShopPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.models = new Map();
    this.cur = null;
    this.old = null;
    this.t = 0;
    this.slide = 1;
    this.dir = 1;
  }

  init() {
    if (this.renderer) return;
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !PHONE, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, PHONE ? 1.5 : 2));
    r.setClearColor(0x000000, 0);
    this.renderer = r;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1.5, 2.5, 2.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc98a, 1.6);
    rim.position.set(-2.5, 1, -2);
    scene.add(rim);
    // (a turntable under it)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.04, 40), new THREE.MeshLambertMaterial({ color: 0x1b2230 }));
    disc.position.y = -0.36;
    scene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.008, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.338;
    scene.add(ring);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(28, 2, 0.05, 20);
    this.camera.position.set(0, 0.32, 2.5);
    this.camera.lookAt(0, -0.02, 0);
  }

  // The model for a preview, centered and scaled to fit the stage (built once each).
  model(p) {
    const key = JSON.stringify(p);
    if (this.models.has(key)) return this.models.get(key);
    const holder = new THREE.Group();
    const inner = new THREE.Group();
    holder.add(inner);
    if (p.gun) inner.add(gunModel(p.gun));
    else if (p.ammo) {
      const gm = gunModel(p.ammo);
      gm.position.set(0, 0.06, -0.05);
      gm.scale.setScalar(0.75);
      inner.add(gm);
      const box = ammoModel(p.ammo);
      const s = Math.max(1.2, 0.35 / (box.userData.length || 0.2));
      box.scale.setScalar(s * 0.6);
      box.position.set((gm.userData.length || 0.25) * 0.25, -0.06, 0.12);
      inner.add(box);
    } else if (p.armor) inner.add(vestModel());
    else if (p.crew === 'vest') {
      for (const x of [-0.22, 0.22]) {
        const v = vestModel(x < 0 ? 0x2f3b2a : 0x2b2f3a);
        v.position.x = x;
        inner.add(v);
      }
    } else if (p.crew) {
      const ids = p.crew === 'rifle' ? ['rifle', 'rifle'] : ['smg', 'shotgun'];
      ids.forEach((id, k) => {
        const m = gunModel(id);
        m.position.y = k ? -0.09 : 0.09;
        inner.add(m);
      });
    }
    // (centered on the turntable, its long side across the stage)
    const b = new THREE.Box3().setFromObject(inner);
    const size = b.getSize(new THREE.Vector3());
    const c = b.getCenter(new THREE.Vector3());
    inner.position.sub(c);
    const fit = 1.05 / Math.max(size.x, size.y * 1.8, size.z, 0.01);
    holder.scale.setScalar(fit);
    holder.userData.tilt = p.armor || p.crew === 'vest' ? 0 : 0.18;
    this.models.set(key, holder);
    return holder;
  }

  show(p, dir = 1) {
    this.init();
    const m = this.model(p);
    if (m === this.cur) return;
    if (this.old && this.old !== m) this.scene.remove(this.old);
    this.old = this.cur;
    this.cur = m;
    // (shown again: it was hidden when it slid out last time)
    m.visible = true;
    if (this.old) this.old.visible = true;
    this.scene.add(m);
    this.dir = dir;
    this.slide = 0;
    this.spin = 0.6; // (each one comes in turned a little, and turns to face you)
  }

  // Every frame while the menu's open.
  frame(dt) {
    if (!this.renderer || !this.cur) return;
    const cv = this.canvas;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * this.renderer.getPixelRatio()) || cv.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      // (a narrow stage: back off so it still fits across)
      this.camera.position.z = Math.max(2.5, 2.5 * (1.9 / this.camera.aspect));
      this.camera.updateProjectionMatrix();
    }
    this.t += dt;
    this.slide = Math.min(1, this.slide + dt * 4.5);
    const e = 1 - (1 - this.slide) ** 3;
    const span = 1.6;
    // (the new one slides in, the old one slides out the other way)
    this.cur.position.x = (1 - e) * span * this.dir;
    if (this.old) {
      this.old.position.x = -e * span * this.dir;
      this.old.visible = e < 1;
    }
    this.spin *= Math.exp(-dt * 3);
    this.cur.rotation.set(this.cur.userData.tilt * 0.4, Math.sin(this.t * 0.6) * 0.55 + this.spin + 0.25, Math.sin(this.t * 0.9) * 0.03);
    this.renderer.render(this.scene, this.camera);
  }
}
