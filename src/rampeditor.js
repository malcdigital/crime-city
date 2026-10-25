// Interchange editor (a testing tool): reshape the ramps at the service interchanges from a
// top-down view, then rebuild the city with them and drive it.
// - One side of one interchange at a time (◀ ▶ to move between them). Each ramp is a smooth
//   curve through control points: drag a point to move it, tap a ramp to add a point there,
//   select a point and tap DELETE to remove it. The square point (where it joins the freeway)
//   stays put. Drag empty space to pan, pinch (or the + / − buttons, mouse wheel) to zoom.
// - "All" edits the design every interchange on that freeway shares; "This one" edits only
//   the side you're looking at (it takes priority).
// - SAVE & DRIVE stores the edits in the browser and reloads, starting you by this
//   interchange. COPY gives the edits as text (send them over to make them permanent).
import { EDITS, EDIT_KEY, HALVES, RAMPS, splinePts } from './fwyplan.js';

const KINDS = [
  ['off', '#ff5a4f', 'exit'],
  ['loop', '#3ddc84', 'loop entrance'],
  ['diag', '#46b4ff', 'diagonal entrance'],
];
const clone = (o) => JSON.parse(JSON.stringify(o));

export class RampEditor {
  constructor(game) {
    this.game = game;
    this.open = false;
    this.edits = clone(EDITS);
    this.edits.template ||= {};
    this.edits.halves ||= {};
    this.scope = 'all';
    this.idx = Math.max(0, HALVES.findIndex((h) => h.main === 'ring' && h.name === 'PARK AVE'));
    this.sel = null; // { kind, i }
    this.undo = [];
    this.build();
  }

  build() {
    const el = document.createElement('div');
    el.id = 'rampedit';
    el.className = 'hidden';
    el.innerHTML = `
      <canvas></canvas>
      <div class="re-bar">
        <button data-a="prev">◀</button><div class="re-name"></div><button data-a="next">▶</button>
        <button data-a="scope" class="re-scope"></button>
      </div>
      <div class="re-tools">
        <button data-a="zin">+</button><button data-a="zout">−</button>
        <button data-a="undo">UNDO</button><button data-a="del">DELETE</button>
        <button data-a="reset">RESET</button>
      </div>
      <div class="re-go">
        <button data-a="copy">COPY</button><button data-a="close">CLOSE</button><button data-a="save" class="re-save">SAVE &amp; DRIVE</button>
      </div>
      <div class="re-help">Drag a dot to move it · tap a ramp to add a dot · square dots stay put</div>
      <div class="re-legend">${KINDS.map(([, c, label]) => `<span><i style="background:${c}"></i>${label}</span>`).join('')}</div>
      <textarea class="re-text hidden" readonly></textarea>`;
    document.body.appendChild(el);
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.action(b.dataset.a);
    }));
    // Pointers: drag a point, pan, pinch.
    const ptrs = new Map();
    let drag = null;
    let pinch = null;
    const pos = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // (fine without)
      }
      const p = pos(e);
      ptrs.set(e.pointerId, p);
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), scale: this.scale };
        drag = null;
        return;
      }
      const hit = this.hitPoint(p);
      if (hit && !hit.locked) {
        this.pushUndo();
        this.sel = hit;
        drag = { type: 'point', hit, start: p, moved: false };
      } else {
        drag = { type: 'pan', start: p, last: p, moved: false, hit };
      }
      this.draw();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const p = pos(e);
      ptrs.set(e.pointerId, p);
      if (pinch && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.scale = Math.max(0.4, Math.min(12, (pinch.scale * d) / (pinch.d || 1)));
        this.draw();
        return;
      }
      if (!drag) return;
      if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) > 6) drag.moved = true;
      if (drag.type === 'point') {
        const [x, z] = this.toWorld(p);
        const ctrl = this.ctrlOf(drag.hit.kind);
        ctrl[drag.hit.i] = this.half().W.inv(x, z).map((v) => Math.round(v * 10) / 10);
        this.setCtrl(drag.hit.kind, ctrl);
      } else if (drag.moved) {
        this.cx -= (p[0] - drag.last[0]) / this.scale;
        this.cz -= (p[1] - drag.last[1]) / this.scale;
        drag.last = p;
      }
      this.draw();
    });
    const up = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (drag && !drag.moved) {
        if (drag.type === 'point') {
          this.undo.pop(); // (just selected it)
        } else if (drag.hit?.locked) {
          this.sel = null;
        } else {
          // A tap: on a ramp, add a point there; elsewhere, clear the selection.
          const ins = this.hitCurve(drag.start);
          if (ins) {
            this.pushUndo();
            const ctrl = this.ctrlOf(ins.kind);
            ctrl.splice(ins.i + 1, 0, this.half().W.inv(...this.toWorld(drag.start)).map((v) => Math.round(v * 10) / 10));
            this.setCtrl(ins.kind, ctrl);
            this.sel = { kind: ins.kind, i: ins.i + 1 };
          } else this.sel = null;
        }
      }
      drag = null;
      this.draw();
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scale = Math.max(0.4, Math.min(12, this.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      this.draw();
    }, { passive: false });
    addEventListener('resize', () => this.open && this.draw());
  }

  half() {
    return HALVES[this.idx];
  }

  // The control points for a ramp of the current side (this side's own edit, the shared design,
  // or the default), as a fresh copy.
  ctrlOf(kind) {
    const h = this.half();
    const own = this.edits.halves[h.id]?.[kind];
    const tpl = this.edits.template[h.main]?.[kind];
    const r = h.ramps[kind];
    return clone(own || tpl || r.defCtrl);
  }

  setCtrl(kind, ctrl) {
    const h = this.half();
    if (this.scope === 'one') (this.edits.halves[h.id] ||= {})[kind] = ctrl;
    else {
      (this.edits.template[h.main] ||= {})[kind] = ctrl;
      // (the shared design is what you see: drop this side's own edit of the same ramp)
      if (this.edits.halves[h.id]) delete this.edits.halves[h.id][kind];
    }
  }

  isLocked(kind, i, n) {
    return kind === 'off' ? i === 0 : i === n - 1;
  }

  pushUndo() {
    this.undo.push(clone({ t: this.edits.template, h: this.edits.halves }));
    if (this.undo.length > 60) this.undo.shift();
  }

  action(a) {
    const h = this.half();
    if (a === 'prev' || a === 'next') {
      this.idx = (this.idx + (a === 'next' ? 1 : -1) + HALVES.length) % HALVES.length;
      this.sel = null;
      this.center();
    } else if (a === 'scope') {
      this.scope = this.scope === 'all' ? 'one' : 'all';
    } else if (a === 'zin' || a === 'zout') {
      this.scale = Math.max(0.4, Math.min(12, this.scale * (a === 'zin' ? 1.3 : 1 / 1.3)));
    } else if (a === 'undo') {
      const u = this.undo.pop();
      if (u) {
        this.edits.template = u.t;
        this.edits.halves = u.h;
      }
    } else if (a === 'del') {
      if (this.sel) {
        const ctrl = this.ctrlOf(this.sel.kind);
        if (ctrl.length > 2 && !this.isLocked(this.sel.kind, this.sel.i, ctrl.length)) {
          this.pushUndo();
          ctrl.splice(this.sel.i, 1);
          this.setCtrl(this.sel.kind, ctrl);
        }
        this.sel = null;
      }
    } else if (a === 'reset') {
      // Back to the default shape: this side (in "This one") or the shared design (in "All").
      this.pushUndo();
      if (this.scope === 'one') delete this.edits.halves[h.id];
      else {
        delete this.edits.template[h.main];
        delete this.edits.halves[h.id];
      }
      this.sel = null;
    } else if (a === 'copy') {
      const text = JSON.stringify(this.edits);
      const ta = this.el.querySelector('.re-text');
      ta.value = text;
      ta.classList.remove('hidden');
      ta.focus();
      ta.select();
      try {
        navigator.clipboard?.writeText(text).then(() => this.game.hud.toast('Edits copied', '#3dff6e')).catch(() => {});
      } catch {
        // (select the text and copy it by hand)
      }
    } else if (a === 'close') {
      this.hide();
      return;
    } else if (a === 'save') {
      try {
        localStorage.setItem(EDIT_KEY, JSON.stringify(this.edits));
        // Start by this interchange, on the cross street, facing it.
        const [x, z] = h.W(0, 70);
        const [fx, fz] = h.W(0, 0);
        const deg = (Math.atan2(fx - x, fz - z) * 180) / Math.PI;
        localStorage.setItem('crimecity.startAt', JSON.stringify([...h.W(3.4, 70), deg])); // (the lane heading toward the freeway)
      } catch {
        // (storage blocked)
      }
      location.reload();
      return;
    }
    this.draw();
  }

  show() {
    this.open = true;
    // (let go of the mouse if the game had it captured)
    try {
      this.game.input.unlock?.();
      document.exitPointerLock?.();
    } catch {
      // (nothing to release)
    }
    this.el.classList.remove('hidden');
    this.el.querySelector('.re-text').classList.add('hidden');
    this.center();
    this.draw();
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  // Frame this side's ramps (the part off the freeway).
  center() {
    const h = this.half();
    const pts = [];
    for (const [kind] of KINDS) for (const [u, v] of this.ctrlOf(kind)) if (u > -75 && u < 75) pts.push(h.W(u, v));
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    this.cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    this.cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const W = this.canvas.clientWidth || innerWidth;
    const Hh = this.canvas.clientHeight || innerHeight;
    this.scale = Math.max(0.4, Math.min((W - 120) / (Math.max(...xs) - Math.min(...xs) + 20), (Hh - 110) / (Math.max(...zs) - Math.min(...zs) + 20)));
  }

  toScreen(x, z) {
    return [(x - this.cx) * this.scale + this.w / 2, (z - this.cz) * this.scale + this.h / 2];
  }

  toWorld([sx, sy]) {
    return [(sx - this.w / 2) / this.scale + this.cx, (sy - this.h / 2) / this.scale + this.cz];
  }

  // A control point near the screen point.
  hitPoint(p) {
    const h = this.half();
    let best = null;
    let bd = 24;
    for (const [kind] of KINDS) {
      const ctrl = this.ctrlOf(kind);
      ctrl.forEach(([u, v], i) => {
        const [sx, sy] = this.toScreen(...h.W(u, v));
        const d = Math.hypot(sx - p[0], sy - p[1]);
        if (d < bd) {
          bd = d;
          best = { kind, i, locked: this.isLocked(kind, i, ctrl.length) };
        }
      });
    }
    return best;
  }

  // A ramp curve near the screen point: which control segment it's on.
  hitCurve(p) {
    const h = this.half();
    let best = null;
    let bd = 16;
    for (const [kind] of KINDS) {
      const ctrl = this.ctrlOf(kind);
      for (let i = 0; i + 1 < ctrl.length; i++) {
        const seg = splinePts([ctrl[Math.max(0, i - 1)], ctrl[i], ctrl[i + 1], ctrl[Math.min(ctrl.length - 1, i + 2)]], 2);
        for (const q of seg) {
          const [sx, sy] = this.toScreen(...h.W(q[0], q[1]));
          const d = Math.hypot(sx - p[0], sy - p[1]);
          if (d < bd) {
            bd = d;
            best = { kind, i };
          }
        }
      }
    }
    return best;
  }

  draw() {
    if (!this.open) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const c = this.canvas;
    this.w = c.clientWidth;
    this.h = c.clientHeight;
    if (c.width !== Math.round(this.w * dpr) || c.height !== Math.round(this.h * dpr)) {
      c.width = Math.round(this.w * dpr);
      c.height = Math.round(this.h * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#2f4a2c';
    g.fillRect(0, 0, this.w, this.h);
    const s = this.scale;
    const line = (pts, width, color, dash) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.setLineDash(dash || []);
      g.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = this.toScreen(p[0], p[1]);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
      g.setLineDash([]);
    };
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // Streets.
    for (const e of this.game.city.edges) {
      if (e.street?.stub !== undefined) continue;
      line([[e.a.x, e.a.z], [e.b.x, e.b.z]], e.w * s, '#55585e');
    }
    // Freeways (and every other ramp, faint).
    const hw = this.game.highway;
    const h = this.half();
    for (const sf of hw.surfaces) {
      if (sf.ramp && sf.ramp.half === h.id) continue;
      line(sf.pts, sf.hw * 2 * s, sf.ramp ? 'rgba(160,160,170,.45)' : '#8a8d92');
    }
    // This side's ramps: the curve through the control points (as it will be built).
    for (const [kind, color] of KINDS) {
      const ctrl = this.ctrlOf(kind);
      const pts = splinePts(ctrl, 2).map(([u, v]) => h.W(u, v));
      line(pts, 7.2 * s, 'rgba(60,62,68,.95)');
      line(pts, Math.max(2, 1.2 * s), color);
    }
    for (const [kind, color] of KINDS) {
      const ctrl = this.ctrlOf(kind);
      ctrl.forEach(([u, v], i) => {
        const [x, y] = this.toScreen(...h.W(u, v));
        const locked = this.isLocked(kind, i, ctrl.length);
        const sel = this.sel && this.sel.kind === kind && this.sel.i === i;
        g.fillStyle = sel ? '#fff' : color;
        g.strokeStyle = '#000';
        g.lineWidth = 2;
        g.beginPath();
        if (locked) g.rect(x - 7, y - 7, 14, 14);
        else g.arc(x, y, sel ? 11 : 9, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
    }
    // Labels.
    const edited = !!(this.edits.halves[h.id] && Object.keys(this.edits.halves[h.id]).length);
    this.el.querySelector('.re-name').textContent = `${h.name} · ${h.main === 'ring' ? 'Ring' : 'Crosstown'} · ${h.toward}${edited ? ' · own edits' : ''}`;
    this.el.querySelector('.re-scope').textContent = this.scope === 'all' ? `EDITING: ALL ${h.main === 'ring' ? 'RING' : 'CROSSTOWN'} INTERCHANGES` : 'EDITING: THIS ONE ONLY';
  }
}

// Where to start after SAVE & DRIVE (used once).
export function takeStartAt() {
  try {
    const s = JSON.parse(localStorage.getItem('crimecity.startAt') || 'null');
    localStorage.removeItem('crimecity.startAt');
    return Array.isArray(s) && s.length === 3 ? s : null;
  } catch {
    return null;
  }
}

export { RAMPS };
