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

export const METER_STYLES = { arc: 'Arc', needle: 'Bar + needle', golf: 'Golf swing' };
// How fast the power fills, by the throw's length (the moves list's "Meter speed", saved with
// your style): a short throw's green is down at the start of the meter, so at one speed you'd
// have to let go almost as soon as you'd pressed.
//   slowShort  long throws as they were; short ones slower, down to 45% of the speed (8 yards
//              and in), easing back to full speed by 30 yards
//   both       short ones slower (half speed at 8 yards and in), long ones faster (135% at 30
//              yards and out), eased between
//   orig       one speed for every throw (as it was)
export const METER_SPEEDS = { slowShort: 'Slower on short', both: 'Slow short · fast long', orig: 'Original' };
export function meterRate(speed, yards) {
  const k = Math.max(0, Math.min(1, (yards - 8) / (30 - 8)));
  const s = k * k * (3 - 2 * k);
  if (speed === 'both') return 0.5 + 0.85 * s;
  if (speed === 'orig') return 1;
  return 0.45 + 0.55 * s;
}
export const PERFECT = 0.035; // (either side of the middle: a perfect tap)
const GOOD = 0.1;
const LINE = 0.12; // (golf: the accuracy line, up from the bottom of the bar)
const NOTCH = 0.06; // (arc: the release notch, along the arc)

const f1 = (v) => v.toFixed(1);

export class ThrowMeter {
  constructor(attach = true) {
    const el = (this.el = document.createElement('div'));
    el.id = attach ? 'throw-meter' : '';
    el.className = attach ? 'hidden' : 'tm-preview';
    if (attach) document.body.appendChild(el);
    this.html = '';
    this.fxKey = null;
  }

  // A still picture of a meter (the moves list's setting shows the one you've picked).
  static preview(style) {
    const t = new ThrowMeter(false);
    t.show(null, { style, v: 0.62, lo: 0.56, hi: 0.68, n: 0.4, tap: null, label: '' });
    return t.el.innerHTML;
  }

  hide() {
    this.el.classList.add('hidden');
  }

  // at: the screen point beside you ({ x, y }); s: { style, v: power 0..1, lo, hi (the green),
  // n: the needle 0..1 or null (still holding), tap: where you tapped or null, label }.
  show(at, s) {
    const el = this.el;
    if (el.classList.contains('hidden')) {
      // (popping in: style.css tm-in, on the box itself so it isn't restarted by the redraws)
      el.classList.remove('tm-in');
      void el.offsetWidth;
      el.classList.add('tm-in');
    }
    el.classList.remove('hidden');
    if (at) {
      el.style.left = `${Math.round(at.x)}px`;
      el.style.top = `${Math.round(at.y)}px`;
    }
    // The animations (restarted each time their key changes): fx is a list of 'pw-ok' /
    // 'pw-perfect' (the power let go in the green / dead on it), 'acc-ok' / 'acc-perfect' (the
    // tap), 'miss', and 'pass-perfect' (both dead on: the big one).
    const fk = s.fx ? `${s.fx.join(' ')}@${s.fxKey}` : '';
    if (fk !== this.fxKey) {
      this.fxKey = fk;
      el.classList.remove('pw-ok', 'pw-perfect', 'acc-ok', 'acc-perfect', 'miss', 'pass-perfect');
      this.html = ''; // (fresh inner elements: their animations start over)
      if (s.fx?.length) {
        void el.offsetWidth;
        el.classList.add(...s.fx);
      }
    }
    const svg = s.style === 'golf' ? this.golf(s) : s.style === 'arc' ? this.arc(s) : this.needle(s);
    const lab = s.label ? `<div class="tm-label ${s.labelClass || ''}">${s.label}</div>` : '';
    // (behind the meter: the rays and the ring for a perfect pass; the sparks)
    const fx = '<div class="tm-rays"></div><div class="tm-ring"></div><div class="tm-ring r2"></div>' + Array.from({ length: 10 }, (_, i) => `<i class="tm-spark" style="--a:${i * 36}deg"></i>`).join('');
    const html = `${fx}<svg viewBox="0 0 140 196" width="140" height="196">${svg}</svg>${lab}`;
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
      <rect class="tm-green" x="${x}" y="${f1(fy(s.hi))}" width="${w}" height="${f1(Math.max(2, fy(s.lo) - fy(s.hi)))}" fill="rgba(62,220,120,.45)" stroke="#3ddc78" stroke-width="1.5"/>
      <rect class="tm-fill${inG ? ' in' : ''}" x="${x + 3}" y="${f1(fy(s.v))}" width="${w - 6}" height="${f1(y + h - fy(s.v))}" rx="2" fill="${inG ? '#3ddc78' : '#ffd23f'}"/>`;
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
        <rect class="tm-notch" x="${f1(nx(0.5 - PERFECT))}" y="${y}" width="${f1(W * PERFECT * 2)}" height="16" fill="rgba(62,220,120,.6)"/>
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
    out += `<rect class="tm-notch" x="${x - 8}" y="${f1(fy(LINE + band))}" width="${w + 16}" height="${f1(Math.max(2, h * band * 2))}" fill="rgba(62,220,120,.6)"/>
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
    const cy = 104;
    const r = 54;
    const now = performance.now() / 1000;
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const live = !calm && (!s.fx || s.n != null); // (still holding or tapping: the pulses run; a result sits still)
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
    const v = Math.max(0, Math.min(1, s.v));
    const inG = s.v >= s.lo && s.v <= s.hi;
    const over = s.v > s.hi && s.n == null && !s.fx; // (held past the green: it's getting away from you)
    const pulse = (hz, lo, hi) => (live ? lo + (hi - lo) * (0.5 + 0.5 * Math.sin(now * hz * Math.PI * 2)) : hi);
    // (the defs: the fill's heat gradient, the backdrop)
    let out = `<defs>
      <linearGradient id="tmHeat" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ffe680"/><stop offset=".55" stop-color="#ffb347"/><stop offset="1" stop-color="#ff6a3d"/></linearGradient>
      <radialGradient id="tmBack"><stop offset=".55" stop-color="rgba(14,18,28,.88)"/><stop offset="1" stop-color="rgba(6,8,14,.55)"/></radialGradient>
    </defs>`;
    // (over the top: a little shake)
    const jx = over ? Math.sin(now * 70) * 1.3 : 0;
    const jy = over ? Math.cos(now * 55) * 0.9 : 0;
    out += `<g transform="translate(${f1(jx)} ${f1(jy)})">`;
    out += `<circle cx="${cx}" cy="${cy}" r="${r + 17}" fill="url(#tmBack)" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/>`;
    // (ticks round the outside: every tenth, the half a bit longer)
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const [x0, y0] = pt(u, r + 10);
      const [x1, y1] = pt(u, r + (i % 5 === 0 ? 15 : 13));
      out += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${u <= v ? 'rgba(255,220,120,.9)' : 'rgba(255,255,255,.3)'}" stroke-width="${i % 5 === 0 ? 2 : 1.3}" stroke-linecap="round"/>`;
    }
    // (the track, with a thin inner line for depth)
    out += `<path d="${arcPath(0, 1)}" stroke="#1d222c" stroke-width="17" fill="none" stroke-linecap="round"/>
      <path d="${arcPath(0, 1, r - 7)}" stroke="rgba(255,255,255,.07)" stroke-width="1" fill="none"/>`;
    // (the green: breathing while you hold, bright edges)
    const g0 = Math.max(0, s.lo);
    const g1 = Math.min(1, s.hi);
    const gOp = s.n == null && !s.fx ? pulse(1.6, 0.4, 0.7) : 0.6;
    out += `<path class="tm-green" d="${arcPath(g0, g1)}" stroke="rgba(62,220,120,${gOp.toFixed(2)})" stroke-width="17" fill="none"/>`;
    for (const u of [g0, g1]) {
      const [x0, y0] = pt(u, r - 9);
      const [x1, y1] = pt(u, r + 9);
      out += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="#7dffae" stroke-width="2"/>`;
    }
    // (the fill: hot gradient, green and glowing in the zone, red past it; a bright head)
    if (v > 0.005) {
      const col = inG ? '#3ddc78' : over ? '#ff4d4d' : 'url(#tmHeat)';
      const glow = inG ? '#3ddc78' : over ? '#ff4d4d' : '#ffb347';
      out += `<path d="${arcPath(0, v)}" stroke="${glow}" stroke-opacity="${(inG ? pulse(3, 0.25, 0.5) : 0.18).toFixed(2)}" stroke-width="20" fill="none" stroke-linecap="round"/>
        <path class="tm-fill${inG ? ' in' : ''}" d="${arcPath(0, v)}" stroke="${col}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
      if (s.n == null && !s.fx) {
        const [hx, hy] = pt(v);
        out += `<circle cx="${f1(hx)}" cy="${f1(hy)}" r="${f1(pulse(4, 7, 10))}" fill="${glow}" opacity=".35"/><circle cx="${f1(hx)}" cy="${f1(hy)}" r="4.5" fill="#fff"/>`;
      }
    }
    // (the notch at the release point: breathing while the needle comes round)
    const band = (Math.max(0.05, s.v - NOTCH) / 0.5) * PERFECT;
    const nOut = s.n != null && !s.fx ? pulse(2.5, 12, 16) : 12;
    const [nx0, ny0] = pt(NOTCH - band, r + nOut);
    const [nx1, ny1] = pt(NOTCH + band, r + nOut);
    const [ix0, iy0] = pt(NOTCH, r - 12);
    const nOp = s.n != null && !s.fx ? pulse(2.5, 0.6, 1) : 0.8;
    out += `<path class="tm-notch" d="M${f1(ix0)} ${f1(iy0)} L${f1(nx0)} ${f1(ny0)} L${f1(nx1)} ${f1(ny1)} Z" fill="rgba(62,220,120,${nOp.toFixed(2)})" stroke="#b6ffd0" stroke-width="1"/>`;
    // (the needle swinging back through the notch, with a fading trail behind it)
    if (s.n != null || s.tap != null) {
      const n = s.tap ?? s.n;
      const uAt = (nn) => s.v + (NOTCH - s.v) * (nn / 0.5);
      const u = uAt(n);
      const c = s.tap != null ? tapColor(s.tap) : '#fff';
      if (s.tap == null) {
        for (let k = 4; k >= 1; k--) {
          const [tx, ty] = pt(uAt(Math.max(0, n - k * 0.025)), r + 12);
          out += `<line x1="${cx}" y1="${cy}" x2="${f1(tx)}" y2="${f1(ty)}" stroke="#fff" stroke-opacity="${(0.32 - k * 0.07).toFixed(2)}" stroke-width="${5 - k * 0.6}" stroke-linecap="round"/>`;
        }
      }
      const [ex, ey] = pt(u, r + 14);
      out += `<g class="tm-needle"><line x1="${cx}" y1="${cy}" x2="${f1(ex)}" y2="${f1(ey)}" stroke="${c}" stroke-width="4" stroke-linecap="round"/><circle cx="${f1(ex)}" cy="${f1(ey)}" r="3.5" fill="${c}"/></g>`;
    }
    // (the hub: the throw you're making)
    const K = { bullet: ['□', '#ff6fb5'], touch: ['✕', '#6fa8ff'], lob: ['△', '#3ddc97'] }[s.kind];
    out += `<circle cx="${cx}" cy="${cy}" r="14" fill="#10141c" stroke="${K ? K[1] : '#3a4150'}" stroke-width="2"/>`;
    if (K) out += `<text x="${cx}" y="${cy + 5.5}" text-anchor="middle" font-size="15" font-weight="900" fill="${K[1]}">${K[0]}</text><text x="${cx}" y="${cy + 29}" text-anchor="middle" font-size="9" font-weight="800" letter-spacing="1.5" fill="rgba(255,255,255,.75)">${s.kind.toUpperCase()}</text>`;
    out += '</g>';
    return out;
  }
}

// (a tap's color: green perfect, amber close, red way off)
function tapColor(n) {
  const d = Math.abs(n - 0.5);
  return d <= PERFECT ? '#3ddc78' : d <= GOOD ? '#ffd23f' : '#ff5c5c';
}
