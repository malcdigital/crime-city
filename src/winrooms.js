// Rooms behind the windows: every window on every building (city.js's one windowed material)
// shows a room you can see into, with depth, that moves as you go past it (interior mapping:
// the ray from the camera through the glass is followed into a box behind it, no geometry).
//
// The window texture (city.js windowTexture) is a 12 m tile of 4 × 4 cells, 3 m each, a window
// in the middle of each (x 7..25, y 6..26 of the cell's 32 pixels). Behind each window: a room
// two cells wide (6 m), a storey tall (3 m), 4.2 m deep, its walls, floor, ceiling, some
// furniture and maybe blinds, each one different (hashed from where it is). The glass reflects a
// little more of the sky the flatter you look at it. By day the rooms are dim; after dark the
// lit windows (the glow map) light theirs up, the others go dark.

const VERT_PARS = /* glsl */ `
varying vec3 vWinW;
varying vec3 vWinN;
`;
const VERT = /* glsl */ `
vWinW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWinN = normalize(mat3(modelMatrix) * objectNormal);
`;
const FRAG_PARS = /* glsl */ `
varying vec3 vWinW;
varying vec3 vWinN;
float winHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
`;
const FRAG = /* glsl */ `
{
  vec2 cu = vMapUv * 4.0;
  vec2 f = fract(cu);
  float far = distance(vWinW, cameraPosition);
  if (f.x > 0.219 && f.x < 0.781 && f.y > 0.1875 && f.y < 0.8125 && abs(vWinN.y) < 0.5 && far < 260.0) {
    vec3 N = normalize(vWinN);
    vec3 Bv = vec3(0.0, 1.0, 0.0);
    vec3 T = normalize(cross(Bv, N));
    // (which way u runs along the wall: T or -T)
    vec3 dpx = dFdx(vWinW);
    vec3 dpy = dFdy(vWinW);
    if (dot(dpx, T) * dFdx(vMapUv.x) + dot(dpy, T) * dFdy(vMapUv.x) < 0.0) T = -T;
    vec3 rd = normalize(vWinW - cameraPosition);
    vec3 d = vec3(dot(rd, T), rd.y, max(0.04, -dot(rd, N)));
    // The room: where you are in it (on the glass), which one it is.
    const float RW = 6.0;
    const float RH = 3.0;
    const float RD = 4.2;
    vec2 cell = floor(cu);
    float face = fract(dot(N, vWinW) * 0.0137 + N.x * 0.31 + N.z * 0.57);
    vec3 id = vec3(floor(cell.x * 0.5), cell.y, face * 97.0);
    float h1 = winHash(id);
    float h2 = winHash(id + 11.3);
    float h3 = winHash(id + 27.1);
    float h4 = winHash(id + 41.7);
    vec2 p = vec2(fract(cu.x * 0.5) * RW, f.y * RH);
    // (the ray to the walls round it: the nearest it meets)
    float tx = d.x > 0.0 ? (RW - p.x) / d.x : (d.x < 0.0 ? -p.x / d.x : 1e4);
    float ty = d.y > 0.0 ? (RH - p.y) / d.y : (d.y < 0.0 ? -p.y / d.y : 1e4);
    float tz = RD / d.z;
    float t = min(tx, min(ty, tz));
    vec3 hp = vec3(p, 0.0) + d * t;
    vec3 wall = mix(vec3(0.78, 0.74, 0.66), vec3(0.62 + 0.3 * h2, 0.6 + 0.25 * h3, 0.55 + 0.3 * h1), 0.55);
    vec3 col;
    if (t == tz) {
      col = wall;
      // (a sofa or a desk along the back wall, a picture over it)
      float x0 = 0.4 + h3 * 2.6;
      if (hp.y < 0.85 && hp.x > x0 && hp.x < x0 + 2.4) col = mix(vec3(0.16, 0.13, 0.12), vec3(0.3, 0.2, 0.32), h4);
      else if (hp.y > 1.45 && hp.y < 2.15 && hp.x > x0 + 0.6 && hp.x < x0 + 1.6) col = vec3(0.25 + 0.6 * h4, 0.3 + 0.4 * h1, 0.35 + 0.5 * h2);
    } else if (t == tx) {
      col = wall * 0.8;
      // (a door in a side wall, sometimes)
      if (h2 > 0.55 && hp.z > 1.6 && hp.z < 2.6 && hp.y < 2.1) col = vec3(0.35, 0.25, 0.18);
    } else if (d.y < 0.0) {
      col = h1 > 0.5 ? vec3(0.36, 0.25, 0.16) : vec3(0.32, 0.32, 0.35); // (wood floor or carpet)
    } else {
      col = vec3(0.86, 0.85, 0.82); // (the ceiling)
    }
    col *= 1.0 - 0.45 * clamp(t / 7.0, 0.0, 1.0); // (darker further in)
    // Blinds, down part of the way, in some.
    float wy = (f.y - 0.1875) / 0.625;
    if (h3 < 0.3 && wy > 1.0 - (0.25 + 0.6 * h4)) col = vec3(0.78, 0.75, 0.68) * (fract(wy * 28.0) < 0.18 ? 0.8 : 1.0);
    // The light in it: dim by day; after dark, lit (the glow map) or dark.
    float night = emissive.r;
    vec3 glowS = texture2D(emissiveMap, vEmissiveMapUv).rgb;
    vec3 lightIn = vec3(0.24 * (1.0 - night)) + night * (vec3(0.03) + glowS * vec3(1.25, 1.05, 0.75));
    // The glass: more of the sky the flatter you look at it.
    float F = 0.22 + 0.6 * pow(1.0 - clamp(-dot(rd, N), 0.0, 1.0), 3.0);
    // (far off, the rooms blur into an even tone: no shimmer)
    float lod = smoothstep(40.0, 130.0, far);
    col = mix(col, vec3(0.5, 0.47, 0.43), lod);
    F = mix(F, 0.4, lod);
    diffuseColor.rgb = vec3(0.4, 0.5, 0.62) * F;
    totalEmissiveRadiance = col * lightIn * (1.0 - F);
  }
}
`;

export function windowRooms(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${VERT_PARS}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERT}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_PARS}`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG}`);
  };
  mat.customProgramCacheKey = () => 'winrooms1';
  return mat;
}
