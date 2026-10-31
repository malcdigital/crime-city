// The paired-animation preview (tools/paired/preview.html): the two exported clips, each on its
// own character, the tackler started from the pair's alignment point.
import * as THREE from 'three';
import { makeCharacter } from '../../src/character.js';
import { applyClip, alignedOrigin } from '../../src/paired.js';
import { fbBallAt, fbBallQuat } from '../../src/footballpose.js';
// (every exported pair: its pair file and a clip per actor)
const FILES = import.meta.glob('../../src/anims/paired/*.json', { eager: true, import: 'default' });
const PAIRS = {};
for (const [path, data] of Object.entries(FILES)) {
  const [, name, part] = path.match(/([\w-]+)\.(\w+)\.json$/);
  PAIRS[name] ||= { clips: {} };
  if (part === 'pair') PAIRS[name].pair = data;
  else PAIRS[name].clips[part] = data;
}
const ORDER = ['tackle-front', 'tackle-behind', 'tackle-side', 'pbu'].filter((n) => PAIRS[n]);
const TITLES = { 'tackle-front': ['Head-on tackle', 'Tackled head on'], 'tackle-behind': ['Tackle from behind', 'Chased down'], 'tackle-side': ['Tackle from the side', 'Hit from the side'], pbu: ['Pass breakup', 'Knocked from his hands'] };
let cur = ORDER[0];
let mirror = false;
let pair = PAIRS[cur].pair;
let anchorClip = PAIRS[cur].clips[pair.actors[0]];
let partnerClip = PAIRS[cur].clips[pair.actors[1]];

const $ = (id) => document.getElementById(id);
const cv = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc4e4);
scene.fog = new THREE.Fog(0x9cc4e4, 30, 70);
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x3b5a3a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(6, 12, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
scene.add(sun);

// (turf with yard lines every 5 yards across the run, and hash marks)
{
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2f6b3f';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#2c653b' : '#327143';
    g.fillRect(0, i * 64, 512, 64);
  }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i <= 8; i += 2) g.fillRect(0, i * 64 - 2, 512, 4);
  for (let i = 0; i < 8; i++) for (const x of [180, 332]) g.fillRect(x, i * 64 + 30, 4, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(36.6, 36.6), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

const shadows = (c) => c.group.traverse((m) => m.isMesh && (m.castShadow = true));
const runner = makeCharacter({ shirt: 0x1f8a46, pants: 0xe8e8e8, skin: 0x8d5524, cap: null });
const tackler = makeCharacter({ shirt: 0x24356f, pants: 0xd9c27a, skin: 0xc68642 });
for (const c of [runner, tackler]) {
  shadows(c);
  scene.add(c.group);
}
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshLambertMaterial({ color: 0x7a3b16 }));
ball.scale.set(1, 1, 1.6);
ball.castShadow = true;
scene.add(ball);

// Where each clip starts: the anchor anywhere (here, the origin facing up the field); the
// partner from the pair's alignment.
const runnerAt = { x: 0, y: 0, z: 0, yaw: 0 };
let tacklerAt = alignedOrigin(pair, pair.actors[1], runnerAt);

// (the alignment: a ring at each start, an arrow for the facing, a line between)
const alignG = new THREE.Group();
scene.add(alignG);
const markCol = 0xffd23f;
function buildAlign() {
  alignG.clear();
for (const [o, col] of [[runnerAt, 0x4cc46f], [tacklerAt, 0x6f95ff]]) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(o.x, 0.02, o.z);
  alignG.add(ring);
  const arr = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 3), new THREE.MeshBasicMaterial({ color: col }));
  arr.rotation.set(Math.PI / 2, 0, 0);
  const a = new THREE.Group();
  a.add(arr);
  a.position.set(o.x + Math.sin(o.yaw) * 0.72, 0.03, o.z + Math.cos(o.yaw) * 0.72);
  a.rotation.y = o.yaw;
  alignG.add(a);
}
{
  const pts = [new THREE.Vector3(runnerAt.x, 0.03, runnerAt.z), new THREE.Vector3(tacklerAt.x, 0.03, tacklerAt.z)];
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: markCol, dashSize: 0.18, gapSize: 0.12 }));
  line.computeLineDistances();
  alignG.add(line);
}
}
buildAlign();

// ---- Playback ----
let N = pair.frames - 1;
let t = 0;
let playing = true;
let speed = 1;
let hold = 0; // (a beat on the last frame before it loops)
const flyV = new THREE.Vector3();
const flyP = new THREE.Vector3();
function pose() {
  const fr = applyClip(runner, anchorClip, t, runnerAt, mirror);
  applyClip(tackler, partnerClip, t, tacklerAt, mirror);
  runner.group.visible = $('t-runner').checked;
  tackler.group.visible = $('t-tackler').checked;
  alignG.visible = $('t-align').checked;
  // (the ball: under his arm, or in his hands till it's knocked out, then flying off the way
  // the arm went)
  const props = anchorClip.events.props || {};
  const until = props.until ? pair.events[props.until] / pair.fps : null;
  ball.visible = runner.group.visible;
  if (until != null && t > until) {
    const s = t - until;
    ball.position.copy(flyP).addScaledVector(flyV, s);
    ball.position.y = Math.max(0.12, flyP.y + flyV.y * s - 4.9 * s * s);
    ball.rotation.x += 0.4;
  } else {
    runner.group.userData.fbGrip = props.ball === 'tuck' && mirror ? 'tuckL' : props.ball || 'tuck';
    if (fbBallAt(runner, ball.position)) fbBallQuat(runner, ball.quaternion);
    flyP.copy(ball.position);
    flyV.set((mirror ? -1 : 1) * -2.2, 2.6, 2.0); // (knocked down and across, out in front)
  }
  const f = Math.round(fr);
  $('fr').textContent = `FRAME ${f} / ${N}`;
  $('tm').textContent = `${t.toFixed(2)} s · ${pair.fps} fps`;
  const near = Object.entries(pair.events).find(([, ef]) => Math.abs(ef - fr) < 1.5);
  $('ev').textContent = near ? `● ${near[0].toUpperCase()} · frame ${near[1]}` : '';
  $('scrub').value = String(fr);
}

// ---- Camera ----
let view = 'side';
let drag = null;
let orbit = null; // (a dragged view: yaw, pitch, distance round the middle of the play)
const MID = 1.6; // (the middle of the play, up the field from where the runner's clip starts)
const VIEWS = {
  side: { pos: [5.8, 1.35, MID], look: [0, 0.65, MID] },
  end: { pos: [0.6, 2.0, MID - 7], look: [0, 0.8, MID] },
  top: { pos: [0.01, 9.5, MID], look: [0, 0, MID] },
  close: { pos: [3.0, 1.4, MID + 2.4], look: [0, 0.6, MID - 0.2] },
};
function placeCamera() {
  if (orbit) {
    const { yaw, pitch, d } = orbit;
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * d, 0.8 + Math.sin(pitch) * d, MID + Math.cos(yaw) * Math.cos(pitch) * d);
    camera.lookAt(0, 0.8, MID);
    return;
  }
  const V = VIEWS[view];
  camera.position.set(...V.pos);
  camera.lookAt(...V.look);
}
for (const k of Object.keys(VIEWS)) {
  $(`v-${k}`).addEventListener('click', () => {
    view = k;
    orbit = null;
    for (const j of Object.keys(VIEWS)) $(`v-${j}`).classList.toggle('on', j === k);
  });
}
cv.addEventListener('pointerdown', (e) => {
  const p = camera.position;
  const d = Math.hypot(p.x, p.y - 0.8, p.z - MID);
  orbit ||= { yaw: Math.atan2(p.x, p.z - MID), pitch: Math.asin((p.y - 0.8) / d), d };
  drag = { x: e.clientX, y: e.clientY };
  cv.setPointerCapture(e.pointerId);
  for (const j of Object.keys(VIEWS)) $(`v-${j}`).classList.remove('on');
});
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  orbit.yaw -= (e.clientX - drag.x) * 0.008;
  orbit.pitch = Math.max(-0.05, Math.min(1.45, orbit.pitch + (e.clientY - drag.y) * 0.006));
  drag = { x: e.clientX, y: e.clientY };
});
cv.addEventListener('pointerup', () => (drag = null));
cv.addEventListener('wheel', (e) => {
  if (!orbit) return;
  e.preventDefault();
  orbit.d = Math.max(2, Math.min(14, orbit.d * (1 + e.deltaY * 0.001)));
}, { passive: false });

// ---- Controls ----
const setPlaying = (v) => {
  playing = v;
  $('play').textContent = v ? 'PAUSE' : 'PLAY';
};
$('play').addEventListener('click', () => {
  if (!playing && t >= pair.length - 1e-3) t = 0;
  setPlaying(!playing);
});
const step = (d) => {
  setPlaying(false);
  t = Math.max(0, Math.min(pair.length, (Math.round(t * pair.fps) + d) / pair.fps));
};
$('back').addEventListener('click', () => step(-1));
$('fwd').addEventListener('click', () => step(1));
$('scrub').addEventListener('input', (e) => {
  setPlaying(false);
  t = Number(e.target.value) / pair.fps;
});
for (const [id, s] of [['s1', 1], ['s2', 0.5], ['s4', 0.25]]) {
  $(id).addEventListener('click', () => {
    speed = s;
    for (const j of ['s1', 's2', 's4']) $(j).classList.toggle('on', j === id);
  });
}
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'range') return;
  if (e.code === 'Space') {
    e.preventDefault();
    $('play').click();
  } else if (e.code === 'ArrowLeft') step(-1);
  else if (e.code === 'ArrowRight') step(1);
});
// ---- The picker, the scrub bar's ticks, what was exported ----
function ticks() {
  $('scrub').max = String(N);
  const T = $('ticks');
  let h = '';
  for (let f = 0; f <= N; f += 5) h += `<i style="left:${(f / N) * 100}%"></i>`;
  for (const [k, f] of Object.entries(pair.events)) if (k !== 'touch') h += `<em style="left:${(f / N) * 100}%">${k.toUpperCase()} ${f}</em>`;
  T.innerHTML = h;
}
function cards() {
  const [A0, A1] = pair.actors;
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  const deg = (r) => `${Math.round((r * 180) / Math.PI)}°`;
  const A = pair.align[A1];
  const x = mirror ? -A.pos[0] : A.pos[0];
  const yaw = mirror ? -A.yaw : A.yaw;
  const facing = Math.abs(Math.abs(yaw) - Math.PI) < 0.05 ? `${deg(Math.abs(yaw))} (toward him)` : Math.abs(yaw) < 0.05 ? '0° (the same way)' : `${deg(yaw)} (across him)`;
  const card = (title, col, rows, note) => `<div class="card"><h2><span class="dot" style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block"></span>${title}</h2><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${note ? `<p>${note}</p>` : ''}</div>`;
  const clipRows = (C, file) => [['File', file], ['Frames', `${C.frames} (0–${C.frames - 1})`], ['Rate', `${C.fps} fps · ${C.length.toFixed(2)} s`], ['Tracks', `root + ${C.joints.length} joints`]];
  const evRows = Object.entries(pair.events).map(([k, f]) => [k === 'touch' ? 'First touch' : cap(k), `frame ${f}`]);
  const ahead = A.pos[2];
  $('cards').innerHTML =
    card(`${cap(A0)} clip`, 'var(--runner)', clipRows(anchorClip, pair.clips[A0]), `The anchor: starts wherever the ${A0} is. Root motion is stored relative to his own first frame.`) +
    card(`${cap(A1)} clip`, 'var(--tackler)', clipRows(partnerClip, pair.clips[A1]), `Same length and frame timing as the ${A0}’s. Its root motion is relative to its own first frame too.`) +
    card('Alignment point', 'var(--mark)', [[ahead >= 0 ? `Ahead of ${A0}` : `Behind ${A0}`, `${Math.abs(ahead).toFixed(2)} m`], [x >= 0 ? 'To his left' : 'To his right', `${Math.abs(x).toFixed(2)} m`], ['Facing', facing], ...evRows], `Stored in ${pair.name}.pair.json: where the ${A1}’s root starts, relative to the ${A0}’s, at frame 0.${mirror ? ' Shown mirrored: the same clips played left for right.' : ''}`) +
    (pair.contact ? card('Contact check', 'var(--runner)', [['Deepest overlap', `${pair.contact.worstCm.toFixed(1)} cm (frame ${pair.contact.atFrame})`], ['Frames over', `${pair.contact.framesOver} (tolerance ${pair.contact.tolCm} cm)`], ['Under the turf', Object.entries(pair.contact.underTurfCm).map(([k, v]) => `${k} ${v.toFixed(1)} cm`).join(' · ')]], `Checked on export: every box of one body against every box of the other, each frame, and both against the turf. The ${A1} is pushed clear before his hands are placed, so they still land where they should.`) : '');
}
function choose(name) {
  cur = name;
  pair = PAIRS[name].pair;
  anchorClip = PAIRS[name].clips[pair.actors[0]];
  partnerClip = PAIRS[name].clips[pair.actors[1]];
  if (name !== 'tackle-side') mirror = false;
  $('mirror-wrap').hidden = name !== 'tackle-side';
  $('t-mirror').checked = mirror;
  tacklerAt = alignedOrigin(pair, pair.actors[1], runnerAt, mirror);
  buildAlign();
  N = pair.frames - 1;
  t = 0;
  hold = 0;
  setPlaying(true);
  const [title, sub] = TITLES[name] || [name, ''];
  $('title').innerHTML = `${title} · <span>paired</span>`;
  document.title = `${title} · Paired`;
  void sub;
  $('lab-a').textContent = `${pair.actors[0][0].toUpperCase()}${pair.actors[0].slice(1)} clip`;
  $('lab-b').textContent = `${pair.actors[1][0].toUpperCase()}${pair.actors[1].slice(1)} clip`;
  for (const n of ORDER) $(`p-${n}`).classList.toggle('on', n === name);
  ticks();
  cards();
}
$('picker').innerHTML = ORDER.map((n) => `<button id="p-${n}">${TITLES[n]?.[0] || n}</button>`).join('');
for (const n of ORDER) $(`p-${n}`).addEventListener('click', () => choose(n));
$('t-mirror').addEventListener('change', (e) => {
  mirror = e.target.checked;
  tacklerAt = alignedOrigin(pair, pair.actors[1], runnerAt, mirror);
  buildAlign();
  cards();
});
choose(cur);

// ---- Loop ----
function resize() {
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * renderer.getPixelRatio()) || cv.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (playing) {
    if (t >= pair.length) {
      hold += dt;
      if (hold > 0.9) {
        t = 0;
        hold = 0;
      }
    } else t = Math.min(pair.length, t + dt * speed);
  }
  resize();
  pose();
  placeCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
window.__preview = { setT: (v) => { setPlaying(false); t = v; }, choose, mirror: (v) => { $('t-mirror').checked = v; $('t-mirror').dispatchEvent(new Event('change')); } };
requestAnimationFrame(frame);
