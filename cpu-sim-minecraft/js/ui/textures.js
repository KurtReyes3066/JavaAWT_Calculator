/**
 * Procedural pixel textures for the blocky theme (dirt, grass, deepslate, noise…).
 * Everything is drawn here at start-up from small colour palettes and a seeded
 * random generator, so the look is the same on every load and no image files
 * are shipped. Each texture is exposed as a CSS custom property on <html>
 * (e.g. --tx-dirt-night: url(data:…)); styles.css falls back to flat colours
 * until they are set.
 */

/** Small, fast seeded PRNG (mulberry32). Returns a function giving [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Multiplies a hex colour's channels (0..1 darkens, >1 lightens) and returns [r,g,b]. */
export function shade(h, k) {
  return hex(h).map((c) => Math.max(0, Math.min(255, Math.round(c * k))));
}

/** Palettes shared with the canvas scene so the page and the scene match. */
export const PAL = {
  dirt: ['#866043', '#79553a', '#966c4a', '#6c4b33', '#5d4029', '#9b7653'],
  grass: ['#5d9c35', '#6aad3d', '#4f8a2c', '#79c04a', '#588f31'],
  stone: ['#7d7d7d', '#737373', '#868686', '#6a6a6a', '#8f8f8f', '#5f5f5f'],
  deepslate: ['#4a4a4f', '#3e3e43', '#55555a', '#36363a', '#2e2e32'],
  planks: ['#a2824e', '#9b7a48', '#b08f59', '#8e6f40'],
};

const pick = (r, list) => list[Math.floor(r() * list.length)];

function texture(size, seed, paint) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = rng(seed);
  const set = (x, y, rgb, a = 255) => {
    const i = (y * size + x) * 4;
    img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = a;
  };
  paint(set, r);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Dirt: speckled browns. `k` darkens it (the page background is a dimmed dirt wall). */
const dirt = (k, seed) => texture(16, seed, (set, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) set(x, y, shade(pick(r, PAL.dirt), k * (0.92 + r() * 0.16)));
});

/** Grass block side: a jagged green fringe on top of dirt. */
const grassSide = (k, seed) => texture(16, seed, (set, r) => {
  const depth = Array.from({ length: 16 }, () => 3 + Math.floor(r() * 3));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const green = y < depth[x];
      set(x, y, shade(pick(r, green ? PAL.grass : PAL.dirt), k * (0.92 + r() * 0.16)));
    }
  }
});

/** Deepslate: dark grey with horizontal streaks. */
const deepslate = (seed) => texture(16, seed, (set, r) => {
  for (let y = 0; y < 16; y++) {
    const rowK = 0.9 + r() * 0.2;
    for (let x = 0; x < 16; x++) set(x, y, shade(pick(r, PAL.deepslate), rowK * (0.94 + r() * 0.12)));
  }
});

/** Transparent black/white speckle laid over flat colours (buttons, Gantt blocks, panels). */
const noise = (strength, seed) => texture(16, seed, (set, r) => {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const light = r() < 0.5;
      set(x, y, light ? [255, 255, 255] : [0, 0, 0], Math.round((0.25 + r() * 0.75) * strength * 255));
    }
  }
});

/** IDLE: pixel diagonal stripes. */
const stripes = (a, b, seed) => texture(16, seed, (set, r) => {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) set(x, y, shade((x + y) % 8 < 4 ? a : b, 0.96 + r() * 0.08));
  }
});

export function installTextures(root = document.documentElement) {
  let tx;
  try {
    tx = {
      'dirt-day': dirt(0.62, 11),
      'dirt-night': dirt(0.3, 11),
      'grass-day': grassSide(0.6, 23),
      'grass-night': grassSide(0.38, 23),
      deepslate: deepslate(37),
      noise: noise(0.16, 41),
      'noise-soft': noise(0.05, 43),
      'idle-day': stripes('#9a9a9a', '#b4b4b4', 53),
      'idle-night': stripes('#2c2c30', '#3b3b40', 53),
    };
  } catch {
    return; // Canvas unavailable: the flat fallback colours in styles.css stay in place.
  }
  Object.entries(tx).forEach(([name, url]) => root.style.setProperty(`--tx-${name}`, `url("${url}")`));
}

installTextures();
