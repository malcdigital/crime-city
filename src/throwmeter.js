// The throwing meter beside you when you play catch (fieldmodes.js): hold a throw button to fill
// the power (the green zone is the power his distance needs), let go, then tap the same button
// again as the arm comes through, in slow motion, for accuracy. Three looks (the pause menu's
// "Throw meter" button picks one, saved with your style):
//   needle  the upright power bar, and an accuracy strip under it with a needle sweeping left to
//           right: tap on the white center line (early pulls it left, late pushes it right)
//   golf    one bar: the power fills up it; let go and a marker drops back down; tap as it crosses
//           the accuracy line near the bottom
//   arc     a curved arc: the power fills along it; a needle swings back through the notch at the
//           release point; tap in the notch
// The accuracy timing is the same in all three: the needle runs 0 → 1 over the window and the
// perfect tap is at 0.5 (the moment the ball leaves the hand).

export const METER_STYLES = { needle: 'Bar + needle', golf: 'Golf swing', arc: 'Arc' };
export const PERFECT = 0.035; // (either side of the middle: a perfect tap)
const GOOD = 0.1;
const LINE = 0.12; // (golf: the accuracy line, up from the bottom of the bar)
const NOTCH = 0.06; // (arc: the release notch, along the arc)

const f1 = (v) => v.toFixed(1);

export class ThrowMeter {
  constructor() {
    const el = (this.el = document.createElement('div'));
    el.id = 'throw-meter';
    el.className = 'hidden';
    document.body.appendChild(el);
    this.html = '';
  }

  hide() {
    this.el.classList.add('hidden');
  }

  // at: the screen point beside you ({ x, y }); s: { style, v: power 0..1, lo, hi (the green),
  // n: the needle 0..1 or null (still holding), tap: where you tapped or null, label }.
  show(at, s) {
    const el = this.el;
    el.classList.remove('hidden');
    el.style.left = `${Math.round(at.x)}px`;
    el.style.top = `${Math.round(at.y)}px`;
    const svg = s.style === 'golf' ? this.golf(s) : s.style === 'arc' ? this.arc(s) : this.needle(s);
    const lab = s.label ? `<div class="tm-label ${s.labelClass || ''}">${s.label}</div>` : '';
    const html = `<svg viewBox="0 0 140 196" width="140" height="196">${svg}</svg>${lab}`;
    if (html !== this.html) {
      this.html = html;
      el.innerHTML = html;
    }
  }

  // (the shared pieces)
  powerBar(x, y, w, h, s) {
    const fy = (v) => y + h * (1 - Math.max(0, Math.min(1, v)));
    const inG = s.v >= s.lo && s.v <= s.hi;
    return `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="5" fill="rgba(8,12,18,.78)" stroke="#2b303b" stroke-width="2"/>
      <rect x="${x}" y="${f1(fy(s.hi))}" width="${w}" height="${f1(Math.max(2, fy(s.lo) - fy(s.hi)))}" fill="rgba(62,220,120,.45)" stroke="#3ddc78" stroke-width="1.5"/>
      <rect x="${x + 3}" y="${f1(fy(s.v))}" width="${w - 6}" height="${f1(y + h - fy(s.v))}" rx="2" fill="${inG ? '#3ddc78' : '#ffd23f'}"/>`;
  }

  needle(s) {
    let out = this.powerBar(62, 8, 16, 140, s);
    if (s.n != null || s.tap != null) {
      const x0 = 10;
      const W = 120;
      const y = 166;
      const nx = (n) => x0 + W * Math.max(0, Math.min(1, n));
      out += `<rect x="${x0 - 3}" y="${y - 3}" width="${W + 6}" height="22" rx="5" fill="rgba(8,12,18,.78)" stroke="#2b303b" stroke-width="2"/>
        <rect x="${f1(nx(0.5 - GOOD))}" y="${y}" width="${f1(W * GOOD * 2)}" height="16" fill="rgba(255,210,63,.25)"/>
        <rect x="${f1(nx(0.5 - PERFECT))}" y="${y}" width="${f1(W * PERFECT * 2)}" height="16" fill="rgba(62,220,120,.6)"/>
        <line x1="${nx(0.5)}" y1="${y - 2}" x2="${nx(0.5)}" y2="${y + 18}" stroke="#fff" stroke-width="2"/>`;
      const n = s.tap ?? s.n;
      const x = nx(n);
      out += `<path d="M${f1(x - 6)} ${y - 9} L${f1(x + 6)} ${y - 9} L${f1(x)} ${y + 1} Z" fill="${s.tap != null ? tapColor(s.tap) : '#fff'}"/><line x1="${f1(x)}" y1="${y}" x2="${f1(x)}" y2="${y + 16}" stroke="${s.tap != null ? tapColor(s.tap) : '#fff'}" stroke-width="3"/>`;
    }
    return out;
  }

  golf(s) {
    const x = 62;
    const y = 8;
    const w = 16;
    const h = 176;
    let out = this.powerBar(x, y, w, h, s);
    const fy = (v) => y + h * (1 - v);
    // (the accuracy line near the bottom, with its perfect band)
    const band = (Math.max(0.05, s.v - LINE) / 0.5) * PERFECT; // (the marker's travel in the perfect window)
    out += `<rect x="${x - 8}" y="${f1(fy(LINE + band))}" width="${w + 16}" height="${f1(Math.max(2, h * band * 2))}" fill="rgba(62,220,120,.6)"/>
      <line x1="${x - 10}" y1="${f1(fy(LINE))}" x2="${x + w + 10}" y2="${f1(fy(LINE))}" stroke="#fff" stroke-width="2"/>`;
    if (s.n != null || s.tap != null) {
      const n = s.tap ?? s.n;
      const my = Math.max(-0.04, s.v + (LINE - s.v) * (n / 0.5)); // (from the power you let go at, down through the line)
      const c = s.tap != null ? tapColor(s.tap) : '#fff';
      out += `<rect x="${x - 12}" y="${f1(fy(my) - 2)}" width="${w + 24}" height="4" rx="2" fill="${c}"/><path d="M${x - 20} ${f1(fy(my) - 6)} L${x - 12} ${f1(fy(my))} L${x - 20} ${f1(fy(my) + 6)} Z" fill="${c}"/>`;
    }
    return out;
  }

  arc(s) {
    const cx = 70;
    const cy = 112;
    const r = 58;
    // (u along the arc: 0 at the lower left, the release point, round over the top to 1 at the
    // lower right)
    const ang = (u) => ((210 - 240 * u) * Math.PI) / 180;
    const pt = (u, rr = r) => [cx + rr * Math.cos(ang(u)), cy - rr * Math.sin(ang(u))];
    const arcPath = (u0, u1, rr = r) => {
      const [x0, y0] = pt(u0, rr);
      const [x1, y1] = pt(u1, rr);
      const large = (u1 - u0) * 240 > 180 ? 1 : 0;
      return `M${f1(x0)} ${f1(y0)} A${rr} ${rr} 0 ${large} 1 ${f1(x1)} ${f1(y1)}`;
    };
    const inG = s.v >= s.lo && s.v <= s.hi;
    let out = `<circle cx="${cx}" cy="${cy}" r="${r + 14}" fill="rgba(8,12,18,.6)"/>
      <path d="${arcPath(0, 1)}" stroke="#2b303b" stroke-width="16" fill="none" stroke-linecap="round"/>
      <path d="${arcPath(Math.max(0, s.lo), Math.min(1, s.hi))}" stroke="rgba(62,220,120,.6)" stroke-width="16" fill="none"/>`;
    if (s.v > 0.005) out += `<path d="${arcPath(0, Math.min(1, s.v))}" stroke="${inG ? '#3ddc78' : '#ffd23f'}" stroke-width="9" fill="none" stroke-linecap="round"/>`;
    // (the notch at the release point)
    const band = (Math.max(0.05, s.v - NOTCH) / 0.5) * PERFECT;
    const [nx0, ny0] = pt(NOTCH - band, r + 12);
    const [nx1, ny1] = pt(NOTCH + band, r + 12);
    const [ix0, iy0] = pt(NOTCH, r - 12);
    out += `<path d="M${f1(ix0)} ${f1(iy0)} L${f1(nx0)} ${f1(ny0)} L${f1(nx1)} ${f1(ny1)} Z" fill="rgba(62,220,120,.75)"/>`;
    if (s.n != null || s.tap != null) {
      const n = s.tap ?? s.n;
      const u = s.v + (NOTCH - s.v) * (n / 0.5); // (swinging back from the power, through the notch)
      const [ex, ey] = pt(u, r + 14);
      const c = s.tap != null ? tapColor(s.tap) : '#fff';
      out += `<line x1="${cx}" y1="${cy}" x2="${f1(ex)}" y2="${f1(ey)}" stroke="${c}" stroke-width="4" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="${c}"/>`;
    }
    return out;
  }
}

// (a tap's color: green perfect, amber close, red way off)
function tapColor(n) {
  const d = Math.abs(n - 0.5);
  return d <= PERFECT ? '#3ddc78' : d <= GOOD ? '#ffd23f' : '#ff5c5c';
}
