import { mulberry32 } from "./prng.js";

/**
 * 2D value noise using a seeded permutation table.
 * Returns float in [0, 1].
 */
export function createValueNoise(seed: number): (x: number, y: number) => number {
  const rand = mulberry32(seed);
  // Build a 256-entry permutation table
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  // Fisher-Yates shuffle
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = base[i]!;
    base[i] = base[j]!;
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255]!;

  function fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  function grad(hash: number, x: number, y: number): number {
    // 4-direction gradients
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }

  return (x: number, y: number): number => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = perm[perm[xi]! + yi]!;
    const ab = perm[perm[xi]! + yi + 1]!;
    const ba = perm[perm[xi + 1]! + yi]!;
    const bb = perm[perm[xi + 1]! + yi + 1]!;

    const val = lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v,
    );
    // Map [-1, 1] → [0, 1]
    return (val + 1) * 0.5;
  };
}

/**
 * Fractal (fBm) noise — sums multiple octaves of value noise.
 * Returns float in [0, 1].
 */
export function createFractalNoise(
  seed: number,
  octaves: number = 4,
  lacunarity: number = 2.0,
  gain: number = 0.5,
): (x: number, y: number) => number {
  const noises = Array.from({ length: octaves }, (_, i) =>
    createValueNoise(seed + i * 1337),
  );

  return (x: number, y: number): number => {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += noises[i]!(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }

    return value / maxValue;
  };
}
