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
