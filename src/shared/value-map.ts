/**
 * Value map for compositional control of bristle rendering.
 * A continuous scalar field (0-1) that drives color selection, mark density,
 * and mark size. Extracted from impressionist-dabs-v2 experiment.
 */

export interface ValueMapConfig {
  /** Canvas width. */
  width: number;
  /** Canvas height. */
  height: number;
  /** Number of FBM noise octaves (1-8). Default 5. */
  octaves: number;
  /** Base noise frequency. Default 0.003. */
  frequency: number;
  /** FBM lacunarity (frequency multiplier per octave). Default 2.0. */
  lacunarity: number;
  /** FBM persistence (amplitude decay per octave). Default 0.5. */
  persistence: number;
  /** Noise seed. Default 0. */
  seed: number;
}

export const DEFAULT_VALUE_MAP: ValueMapConfig = {
  width: 600,
  height: 600,
  octaves: 5,
  frequency: 0.003,
  lacunarity: 2.0,
  persistence: 0.5,
  seed: 0,
};

/**
 * Simple hash-based noise for value map generation.
 * Uses a seeded approach for deterministic output without external dependencies.
 */
function hash2d(x: number, y: number, seed: number): number {
  let h = seed;
  h = Math.imul(h ^ (x * 374761393), 1103515245);
  h = Math.imul(h ^ (y * 668265263), 1103515245);
  h ^= h >>> 13;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2d(ix, iy, seed);
  const n10 = hash2d(ix + 1, iy, seed);
  const n01 = hash2d(ix, iy + 1, seed);
  const n11 = hash2d(ix + 1, iy + 1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function fbm(x: number, y: number, config: ValueMapConfig): number {
  let value = 0, amplitude = 1, totalAmp = 0;
  let freq = config.frequency;
  for (let i = 0; i < config.octaves; i++) {
    value += smoothNoise(x * freq, y * freq, config.seed + i * 127) * amplitude;
    totalAmp += amplitude;
    freq *= config.lacunarity;
    amplitude *= config.persistence;
  }
  return value / totalAmp;
}

export interface ValueMap {
  /** Sample value at pixel coordinates. Returns 0-1. */
  valueAt(x: number, y: number): number;
  /** Sample depth (normalized Y position). Returns 0-1 where 0 = top, 1 = bottom. */
  depthAt(y: number): number;
}

/**
 * Create a value map from configuration.
 * The value map provides a continuous 0-1 scalar field for driving
 * color selection, density, and mark size across the canvas.
 */
export function createValueMap(config: Partial<ValueMapConfig> = {}): ValueMap {
  const cfg = { ...DEFAULT_VALUE_MAP, ...config };

  return {
    valueAt(x: number, y: number): number {
      return Math.max(0, Math.min(1, fbm(x, y, cfg)));
    },
    depthAt(y: number): number {
      return Math.max(0, Math.min(1, y / cfg.height));
    },
  };
}
