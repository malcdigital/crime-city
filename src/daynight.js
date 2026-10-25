import * as THREE from 'three';

// Day and night, from the game clock (a full day is 48 real minutes). The sky, fog, sun and
// ambient light follow the time of day; at night building windows glow and the street lights
// come on. Dawn is around 5-7 AM, dusk around 6-8 PM.
const DAY_SKY = new THREE.Color(0x9fc3e0);
const DUSK_SKY = new THREE.Color(0xe39a6b);
const NIGHT_SKY = new THREE.Color(0x0b1426);
const DAY_SUN = new THREE.Color(0xfff1d6);
const NIGHT_SUN = new THREE.Color(0x7f95c8); // moonlight

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class DayNight {
  constructor(game) {
    this.game = game;
    this.sky = game.scene.background;
    this.night = -1;
  }

  // 0 at full day, 1 at full night.
  nightAt(m) {
    const h = m / 60;
    return 1 - smooth(5, 7, h) + smooth(18.5, 20.5, h);
  }

  update() {
    const game = this.game;
    const m = game.clockMinutes();
    const k = Math.max(0, Math.min(1, this.nightAt(m)));
    // A warm glow around dawn and dusk.
    const h = m / 60;
    const golden = Math.max(0, 1 - Math.abs(h - 6.2) / 1.2) + Math.max(0, 1 - Math.abs(h - 19.3) / 1.2);
    if (Math.abs(k - this.night) < 0.002 && golden === 0) return;
    this.night = k;
    const sky = this.sky;
    sky.copy(DAY_SKY).lerp(DUSK_SKY, Math.min(0.6, golden * 0.6)).lerp(NIGHT_SKY, k);
    game.scene.fog.color.copy(sky);
    if (game.hemi) game.hemi.intensity = 1.1 - 0.75 * k;
    game.sun.intensity = 1.8 - 1.5 * k;
    game.sun.color.copy(DAY_SUN).lerp(NIGHT_SUN, k);
    // Lit windows glow after dark.
    for (const mat of game.city.windowMats || []) mat.emissive.setRGB(1.0 * k, 0.85 * k, 0.55 * k);
    game.streets?.setNight(k);
  }
}
