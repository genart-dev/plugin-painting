import { createFractalNoise } from "./shared/noise.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorSample {
  dx: number;       // normalized direction x [-1, 1]
  dy: number;       // normalized direction y [-1, 1]
  magnitude: number; // flow strength [0, 1]
}

/** 2D grid of flow samples. Index: samples[row * cols + col]. */
export interface VectorField {
  cols: number;
  rows: number;
  samples: VectorSample[];
}

// ---------------------------------------------------------------------------
// Bilinear interpolation
// ---------------------------------------------------------------------------

/**
 * Sample the field at normalized canvas coordinates (nx, ny) in [0, 1].
 * Uses bilinear interpolation between the 4 surrounding grid cells.
 */
export function sampleField(field: VectorField, nx: number, ny: number): VectorSample {
  const { cols, rows, samples } = field;

  // Map [0,1] to grid coordinates
  const gx = nx * (cols - 1);
  const gy = ny * (rows - 1);

  const x0 = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const tx = gx - x0;
  const ty = gy - y0;

  const s00 = samples[y0 * cols + x0]!;
  const s10 = samples[y0 * cols + x1]!;
  const s01 = samples[y1 * cols + x0]!;
  const s11 = samples[y1 * cols + x1]!;

  function bilerp(a: number, b: number, c: number, d: number): number {
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  return {
    dx: bilerp(s00.dx, s10.dx, s01.dx, s11.dx),
    dy: bilerp(s00.dy, s10.dy, s01.dy, s11.dy),
    magnitude: bilerp(s00.magnitude, s10.magnitude, s01.magnitude, s11.magnitude),
  };
}

// ---------------------------------------------------------------------------
// Derived quantities (finite-difference approximations over the grid)
// ---------------------------------------------------------------------------

/**
 * Compute divergence (∂dx/∂x + ∂dy/∂y) at a grid cell.
 * Positive = outward bloom; negative = inward pooling.
 */
export function divergenceAt(field: VectorField, col: number, row: number): number {
  const { cols, rows, samples } = field;

  // Clamp neighbors
  const c0 = Math.max(0, col - 1);
  const c2 = Math.min(cols - 1, col + 1);
  const r0 = Math.max(0, row - 1);
  const r2 = Math.min(rows - 1, row + 1);
  const dcX = c2 - c0;
  const drY = r2 - r0;

  const dxLeft = samples[row * cols + c0]!.dx;
  const dxRight = samples[row * cols + c2]!.dx;
  const dyTop = samples[r0 * cols + col]!.dy;
  const dyBottom = samples[r2 * cols + col]!.dy;

  const dDxDx = dcX > 0 ? (dxRight - dxLeft) / dcX : 0;
  const dDyDy = drY > 0 ? (dyBottom - dyTop) / drY : 0;

  return dDxDx + dDyDy;
}

/**
 * Compute curl (∂dy/∂x - ∂dx/∂y) at a grid cell.
 * Positive = counterclockwise vorticity.
 */
export function curlAt(field: VectorField, col: number, row: number): number {
  const { cols, rows, samples } = field;

  const c0 = Math.max(0, col - 1);
  const c2 = Math.min(cols - 1, col + 1);
  const r0 = Math.max(0, row - 1);
  const r2 = Math.min(rows - 1, row + 1);
  const dcX = c2 - c0;
  const drY = r2 - r0;

  const dyLeft = samples[row * cols + c0]!.dy;
  const dyRight = samples[row * cols + c2]!.dy;
  const dxTop = samples[r0 * cols + col]!.dx;
  const dxBottom = samples[r2 * cols + col]!.dx;

  const dDyDx = dcX > 0 ? (dyRight - dyLeft) / dcX : 0;
  const dDxDy = drY > 0 ? (dxBottom - dxTop) / drY : 0;

  return dDyDx - dDxDy;
}

// ---------------------------------------------------------------------------
// Field generators
// ---------------------------------------------------------------------------

/**
 * Fractal noise-derived flow field — organic, turbulent.
 * Direction is derived from the gradient of a noise function.
 */
export function noiseField(
  seed: number = 0,
  scale: number = 0.1,
  octaves: number = 3,
  cols: number = 20,
  rows: number = 20,
): VectorField {
  const noiseAngle = createFractalNoise(seed, octaves);
  const noiseMag = createFractalNoise(seed + 9999, Math.max(1, octaves - 1));
  const samples: VectorSample[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nx = (col / (cols - 1)) / scale;
      const ny = (row / (rows - 1)) / scale;
      // Map noise [0,1] to angle [0, 2π] for full 360° flow
      const angle = noiseAngle(nx, ny) * Math.PI * 4;
      const magnitude = noiseMag(nx * 0.5, ny * 0.5);
      samples.push({
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        magnitude,
      });
    }
  }

  return { cols, rows, samples };
}

/**
 * Uniform directional flow at a fixed angle (degrees) and magnitude.
 */
export function linearField(
  angleDeg: number = 0,
  magnitude: number = 1.0,
  cols: number = 20,
  rows: number = 20,
): VectorField {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const samples: VectorSample[] = [];
  const count = cols * rows;
  for (let i = 0; i < count; i++) {
    samples.push({ dx, dy, magnitude });
  }
  return { cols, rows, samples };
}

/**
 * Radial flow diverging outward from (cx, cy) or converging inward.
 * cx, cy are normalized [0, 1] canvas coordinates.
 */
export function radialField(
  cx: number = 0.5,
  cy: number = 0.5,
  mode: "diverge" | "converge" = "diverge",
  cols: number = 20,
  rows: number = 20,
): VectorField {
  const sign = mode === "diverge" ? 1 : -1;
  const samples: VectorSample[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nx = col / (cols - 1);
      const ny = row / (rows - 1);
      const px = nx - cx;
      const py = ny - cy;
      const dist = Math.sqrt(px * px + py * py);

      if (dist < 1e-6) {
        samples.push({ dx: 0, dy: 0, magnitude: 1 });
      } else {
        // Magnitude falls off with distance; peak at center, 0 at corner (~0.707)
        const magnitude = Math.max(0, 1 - dist / 0.71);
        samples.push({
          dx: (sign * px) / dist,
          dy: (sign * py) / dist,
          magnitude,
        });
      }
    }
  }

  return { cols, rows, samples };
}

/**
 * Rotational (vortex) field spiraling around (cx, cy).
 * Magnitude peaks at the given radius and falls off inside and outside.
 */
export function vortexField(
  cx: number = 0.5,
  cy: number = 0.5,
  radius: number = 0.3,
  cols: number = 20,
  rows: number = 20,
): VectorField {
  const samples: VectorSample[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nx = col / (cols - 1);
      const ny = row / (rows - 1);
      const px = nx - cx;
      const py = ny - cy;
      const dist = Math.sqrt(px * px + py * py);

      if (dist < 1e-6) {
        samples.push({ dx: 0, dy: 0, magnitude: 0 });
      } else {
        // Tangent direction (clockwise: perpendicular to radial)
        const dx = -py / dist;
        const dy = px / dist;
        // Magnitude: Gaussian peak at the target radius
        const diff = dist - radius;
        const sigma = radius * 0.5;
        const magnitude = Math.exp(-(diff * diff) / (2 * sigma * sigma));
        samples.push({ dx, dy, magnitude });
      }
    }
  }

  return { cols, rows, samples };
}

// ---------------------------------------------------------------------------
// Mask utilities
// ---------------------------------------------------------------------------

/**
 * Multiply an existing field's magnitude by a vertical Gaussian envelope.
 * centerY and spread are normalized [0, 1] canvas coordinates.
 *
 * Use this to confine a layer's paint intensity to a horizontal zone while
 * rendering the layer at full canvas bounds — eliminating rectangular clip edges.
 *
 * @param field   The source field (not mutated).
 * @param centerY Normalized Y center of the zone, e.g. 0.3 for top-third.
 * @param spread  Gaussian sigma in normalized units, e.g. 0.15 for a medium band.
 * @returns A new VectorField with magnitudes modulated by the Gaussian envelope.
 */
export function applyVerticalMask(
  field: VectorField,
  centerY: number,
  spread: number,
): VectorField {
  const { cols, rows, samples } = field;
  const sigma2 = 2 * spread * spread;
  const newSamples = samples.map((s, i) => {
    const row = Math.floor(i / cols);
    const ny = rows > 1 ? row / (rows - 1) : 0;
    const dy = ny - centerY;
    const envelope = Math.exp(-(dy * dy) / sigma2);
    return { dx: s.dx, dy: s.dy, magnitude: s.magnitude * envelope };
  });
  return { cols, rows, samples: newSamples };
}

// ---------------------------------------------------------------------------
// Shorthand parser (for stored property strings per ADR 031)
// ---------------------------------------------------------------------------

/**
 * Parse a shorthand field string or full JSON into a VectorField.
 * Shorthands:
 *   "noise:42:0.1:3"         → noiseField(42, 0.1, 3)
 *   "linear:45:0.8"          → linearField(45, 0.8)
 *   "radial:0.5:0.5:diverge" → radialField(0.5, 0.5, "diverge")
 *   "vortex:0.5:0.5:0.3"     → vortexField(0.5, 0.5, 0.3)
 */
export function parseField(
  fieldStr: string,
  cols: number = 20,
  rows: number = 20,
): VectorField {
  if (fieldStr.startsWith("{")) {
    return JSON.parse(fieldStr) as VectorField;
  }

  const parts = fieldStr.split(":");
  const type = parts[0];

  switch (type) {
    case "noise": {
      const seed = parseFloat(parts[1] ?? "0");
      const scale = parseFloat(parts[2] ?? "0.1");
      const octaves = parseInt(parts[3] ?? "3", 10);
      return noiseField(seed, scale, octaves, cols, rows);
    }
    case "linear": {
      const angle = parseFloat(parts[1] ?? "0");
      const magnitude = parseFloat(parts[2] ?? "1");
      return linearField(angle, magnitude, cols, rows);
    }
    case "radial": {
      const rx = parseFloat(parts[1] ?? "0.5");
      const ry = parseFloat(parts[2] ?? "0.5");
      const mode = (parts[3] === "converge" ? "converge" : "diverge") as
        | "diverge"
        | "converge";
      return radialField(rx, ry, mode, cols, rows);
    }
    case "vortex": {
      const vx = parseFloat(parts[1] ?? "0.5");
      const vy = parseFloat(parts[2] ?? "0.5");
      const r = parseFloat(parts[3] ?? "0.3");
      return vortexField(vx, vy, r, cols, rows);
    }
    default:
      // Fallback: uniform noise field
      return noiseField(0, 0.1, 3, cols, rows);
  }
}
