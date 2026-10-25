// Graphics quality. Phones get "phone" quality automatically: lower render resolution, cheaper
// and shorter shadows, a shorter view distance and smaller crowds. Switch it in the pause menu
// (saved), or add ?quality=phone / ?quality=full to the address.
const KEY = 'crimecity.quality';

function detect() {
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'phone' || q === 'full') return q;
  } catch {
    // (no address to read)
  }
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'phone' || s === 'full') return s;
  } catch {
    // (storage blocked)
  }
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
    || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900);
  return mobile ? 'phone' : 'full';
}

export const QUALITY = detect();
export const PHONE = QUALITY === 'phone';

// The numbers each quality level uses.
export const GFX = PHONE
  ? { pixelRatio: 1.25, antialias: false, shadowMap: 1024, shadowRange: 60, softShadows: false, far: 300, fogNear: 90, fogFar: 290, crowd: 0.6, traffic: 0.7, parkedShow: 150 }
  : { pixelRatio: 2, antialias: true, shadowMap: 2048, shadowRange: 90, softShadows: true, far: 450, fogNear: 140, fogFar: 430, crowd: 1, traffic: 1, parkedShow: 250 };

export function setQuality(q) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // (storage blocked)
  }
  location.reload();
}
