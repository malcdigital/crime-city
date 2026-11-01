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

// Map markers (the big map, the radar, the legend): pictograms instead of letters. A blip's
// code picks one (or any other text is drawn as it is: a gang's initial, a base's tier).
// Each is a 24 × 24 path, drawn white on the blip's color.
export const MAP_ICONS = {
  gun: 'M3 7h16.5l1 1.6v2.2h-6.6l-1 1.2h-2.2l-1.4 5.5H5.1l1.6-6.1H3z',
  hospital: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6z',
  police: 'M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z',
  chop: 'M4 12l2.2-5.2A2 2 0 0 1 8 5.6h8a2 2 0 0 1 1.8 1.2L20 12v6h-2.2v2H15v-2H9v2H6.2v-2H4zM7.4 11h9.2l-1.5-3.6H8.9zM6.5 13.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm11 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z',
  wrench: 'M21.2 6.4a5.2 5.2 0 0 1-6.9 5L7 18.8a2.1 2.1 0 0 1-3-3l7.4-7.3a5.2 5.2 0 0 1 6.2-6.7L14.5 5l.6 3.4 3.4.6z',
  safe: 'M12 3l9.5 8.2h-3V21H14v-6h-4v6H5.5v-9.8h-3z',
  home: 'M12 4l8.5 7.4h-2.6V20h-4.2v-5h-3.4v5H6.1v-8.6H3.5z',
  bank: 'M12 2.5l9.5 4.8V9h-19V7.3zM4.5 10.5h3v7.5h-3zm6 0h3v7.5h-3zm6 0h3v7.5h-3zM2.5 19.3h19V22h-19z',
  plug: 'M7.5 7V6a4.5 4.5 0 0 1 9 0v1H20l-1.2 14H5.2L4 7zm2 0h5V6a2.5 2.5 0 0 0-5 0z',
  biz: 'M9 3.5h6a1.2 1.2 0 0 1 1.2 1.2V7H21v12.5H3V7h4.8V4.7A1.2 1.2 0 0 1 9 3.5zM9.8 7h4.4V5.5H9.8zM3 12.5h18v1.5H3z',
  cash: 'M3 6h18v12H3zm9 2.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zM5.2 8.2v1.6h1.6V8.2zm12 6v1.6h1.6v-1.6z',
};
const paths = {};
export function drawMapIcon(ctx, code, x, y, size, color = '#fff') {
  const d = MAP_ICONS[code];
  if (!d) return false;
  paths[code] ??= new Path2D(d);
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(paths[code], 'evenodd');
  ctx.restore();
  return true;
}
export function iconSVG(code, px = 12) {
  const d = MAP_ICONS[code];
  return d ? `<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true"><path d="${d}" fill="#fff" fill-rule="evenodd"/></svg>` : null;
}
// (the old names)
export function drawGunGlyph(ctx, x, y, size, color = '#fff') {
  drawMapIcon(ctx, 'gun', x, y, size, color);
}
export const GUN_SVG = iconSVG('gun', 12);
// Draw a blip's text, or its icon.
export function blipText(ctx, text, x, y, size) {
  if (!drawMapIcon(ctx, text, x, y, size * 1.45)) ctx.fillText(text, x, y);
}
