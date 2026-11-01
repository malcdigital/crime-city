// Our own direction icons (left, right, up, down), drawn as SVG so they look the same everywhere.
// The ◀ ▶ ▲ ▼ characters (and ← → ↑ ↓) turn into colored emoji on an iPhone, so anything that
// puts one on screen goes through here instead:
//   dirIcon('left' | 'right' | 'up' | 'down', size)   the icon's SVG markup
//   iconize(text)       plain text → safe HTML, every arrow character swapped for its icon
//   iconizeHTML(html)   the same for markup that's already escaped
//   setRich(el, text)   el shows text, arrows as icons (plain textContent when there are none)
// The icon is a rounded triangle (a D-pad press), in the text's own color, sized to the text.

const ROT = { up: 0, right: 90, down: 180, left: 270 };
const CHARS = { '◀': 'left', '▶': 'right', '▲': 'up', '▼': 'down', '←': 'left', '→': 'right', '↑': 'up', '↓': 'down', '◄': 'left', '►': 'right' };
const RE = /[◀▶▲▼←→↑↓◄►]️?/g;

export function dirIcon(dir, size = '1em') {
  const r = ROT[dir] ?? 0;
  return `<svg class="dir-ic" viewBox="0 0 24 24" width="${size}" height="${size}" aria-label="${dir}" role="img"><path transform="rotate(${r} 12 12)" d="M12 4.5 L20 17.5 H4 Z" fill="currentColor" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round"/></svg>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function hasArrows(text) {
  RE.lastIndex = 0;
  return typeof text === 'string' && RE.test(text);
}

export function iconizeHTML(html) {
  return String(html).replace(RE, (c) => dirIcon(CHARS[c[0]]));
}

export function iconize(text) {
  return iconizeHTML(esc(text));
}

export function setRich(el, text) {
  if (!el) return;
  if (hasArrows(text)) el.innerHTML = iconize(text);
  else el.textContent = text;
}

// The gun shops' map marker (each has its range inside): a pistol, not a letter. Blips that say
// 'gun' get it (the map, the radar, the legend); drawn white on the blip's color.
const GUN_PATH = 'M3 7h16.5l1 1.6v2.2h-6.6l-1 1.2h-2.2l-1.4 5.5H5.1l1.6-6.1H3z';
let gunPath = null;
export function drawGunGlyph(ctx, x, y, size, color = '#fff') {
  gunPath ??= new Path2D(GUN_PATH);
  ctx.save();
  ctx.translate(x - (11.75 * size) / 24, y - (12.2 * size) / 24);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(gunPath);
  ctx.restore();
}
// (for HTML: the legend)
export const GUN_SVG = `<svg viewBox="2 4 20 16" width="12" height="12" aria-hidden="true"><path d="${GUN_PATH}" fill="#fff"/></svg>`;
// Draw a blip's text, or its icon.
export function blipText(ctx, text, x, y, size) {
  if (text === 'gun') drawGunGlyph(ctx, x, y, size * 1.5);
  else ctx.fillText(text, x, y);
}
