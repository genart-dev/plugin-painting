/**
 * Grid-based mark placement for bristle rendering.
 * Extracted from impressionist-dabs-v2 experiment and bristle-dab layer type.
 * Provides regular grid, jittered grid, and shuffled grid placement strategies.
 */

export interface Vec2 { x: number; y: number }

export interface GridConfig {
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Grid cell spacing in pixels. */
  spacing: number;
  /** Jitter amount 0-1 (fraction of cell size). Default 0.5. */
  jitter: number;
  /** Bleed beyond canvas bounds in pixels (to avoid edge gaps). Default 0. */
  bleed: number;
}

export interface GridPoint {
  /** X position. */
  x: number;
  /** Y position. */
  y: number;
  /** Normalized X (0-1). */
  nx: number;
  /** Normalized Y (0-1). */
  ny: number;
}

/**
 * Generate a jittered grid of placement points.
 * Points are yielded in row-major order with optional jitter.
 */
export function generateGrid(
  config: GridConfig,
  rng: () => number,
): GridPoint[] {
  const { width, height, spacing, jitter, bleed } = config;
  const cols = Math.ceil((width + bleed * 2) / spacing) + 1;
  const rows = Math.ceil((height + bleed * 2) / spacing) + 1;
  const points: GridPoint[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jx = (rng() - 0.5) * jitter * spacing;
      const jy = (rng() - 0.5) * jitter * spacing;
      const x = -bleed + (c + 0.5) * spacing + jx;
      const y = -bleed + (r + 0.5) * spacing + jy;
      points.push({
        x, y,
        nx: Math.max(0, Math.min(1, x / width)),
        ny: Math.max(0, Math.min(1, y / height)),
      });
    }
  }

  return points;
}

/**
 * Generate a jittered grid and shuffle it with Fisher-Yates.
 * Shuffling ensures that no spatial bias exists in the rendering order,
 * which matters when using transparency/alpha accumulation.
 */
export function generateShuffledGrid(
  config: GridConfig,
  rng: () => number,
): GridPoint[] {
  const points = generateGrid(config, rng);
  // Fisher-Yates shuffle
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = points[i]!;
    points[i] = points[j]!;
    points[j] = tmp;
  }
  return points;
}

/**
 * Generate a multi-scale grid for multi-pass rendering.
 * Returns an array of point arrays, one per pass, with decreasing spacing.
 * Used by impressionist-dab style 4-pass rendering (ground→form→detail→accent).
 */
export function generateMultiScaleGrid(
  config: GridConfig,
  rng: () => number,
  passes: { spacingScale: number; fraction: number }[],
): GridPoint[][] {
  return passes.map(pass => {
    const passConfig = { ...config, spacing: config.spacing * pass.spacingScale };
    const allPoints = generateShuffledGrid(passConfig, rng);
    const count = Math.floor(allPoints.length * pass.fraction);
    return allPoints.slice(0, count);
  });
}
