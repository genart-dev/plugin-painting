import type { FillStrategy, FillRegion, ShadingFunction, ShadingAffect, GeneratedPath } from "./types.js";
import type { LayerBounds } from "@genart-dev/core";
import { regionBounds, regionToPolygon, pointInRegion, offsetPolygon } from "./region-utils.js";
import { buildShadingEvaluator, applyShadingToPath } from "./shading.js";
import { mulberry32 } from "../shared/prng.js";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Generate all paths for a fill layer.
 * Returns an array of GeneratedPath objects ready to be rendered as BrushStrokes.
 */
export function generateFillPaths(
  strategy: FillStrategy,
  region: FillRegion,
  shading: ShadingFunction,
  shadingAffects: ShadingAffect[],
  bounds: LayerBounds,
  seed: number,
): GeneratedPath[] {
  const rb = regionBounds(region, bounds);
  const evaluate = buildShadingEvaluator(shading, rb.x, rb.y, rb.width, rb.height);
  const rng = mulberry32(seed);

  switch (strategy.type) {
    case "hatch":
      return generateHatch(strategy.angle, strategy.spacing, 1, region, bounds, rb, evaluate, shadingAffects, rng);
    case "crosshatch":
      return generateCrosshatch(strategy, region, bounds, rb, evaluate, shadingAffects, rng);
    case "stipple":
      return generateStipple(strategy, region, bounds, rb, evaluate, shadingAffects, rng);
    case "scumble":
      return generateScumble(strategy, region, bounds, rb, evaluate, shadingAffects, rng);
    case "contour":
      return generateContour(strategy, region, bounds, rb, evaluate, shadingAffects);
  }
}

// ---------------------------------------------------------------------------
// Hatch
// ---------------------------------------------------------------------------

function generateHatch(
  angleDeg: number,
  spacing: number,
  passOpacity: number,
  region: FillRegion,
  bounds: LayerBounds,
  rb: { x: number; y: number; width: number; height: number },
  evaluate: (x: number, y: number) => number,
  shadingAffects: ShadingAffect[],
  rng: () => number,
): GeneratedPath[] {
  const paths: GeneratedPath[] = [];
  const sp = Math.max(1, spacing);

  const rad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  // Diagonal of the bounding box — overshoot for complete coverage
  const diagHalf = Math.sqrt(rb.width * rb.width + rb.height * rb.height) / 2 + sp * 2;
  const cx = rb.x + rb.width / 2;
  const cy = rb.y + rb.height / 2;

  // Perpendicular direction to the line angle
  const perpX = -sinA;
  const perpY =  cosA;

  // Number of lines needed to cover the region
  const lineCount = Math.ceil((diagHalf * 2) / sp) + 1;
  const startOffset = -diagHalf;

  for (let i = 0; i < lineCount; i++) {
    const offset = startOffset + i * sp;
    const lx = cx + perpX * offset;
    const ly = cy + perpY * offset;

    // Line endpoints (overshooted along the angle direction)
    const x0 = lx - cosA * diagHalf;
    const y0 = ly - sinA * diagHalf;
    const x1 = lx + cosA * diagHalf;
    const y1 = ly + sinA * diagHalf;

    // Evaluate shading at line midpoint
    const shadingValue = evaluate(lx, ly);

    // Density culling: skip line probabilistically based on shading value
    if (shadingAffects.includes("density")) {
      if (rng() > shadingValue) continue;
    }

    const { opacityScale, sizeScale } = applyShadingToPath(shadingValue, shadingAffects);

    paths.push({
      points: [{ x: x0, y: y0 }, { x: x1, y: y1 }],
      opacityScale: opacityScale * passOpacity,
      sizeScale,
    });
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Crosshatch
// ---------------------------------------------------------------------------

function generateCrosshatch(
  strategy: { angles: number[]; spacing: number; passDecay: number },
  region: FillRegion,
  bounds: LayerBounds,
  rb: { x: number; y: number; width: number; height: number },
  evaluate: (x: number, y: number) => number,
  shadingAffects: ShadingAffect[],
  rng: () => number,
): GeneratedPath[] {
  const paths: GeneratedPath[] = [];
  const angles = strategy.angles.length > 0 ? strategy.angles : [45, 135];

  for (let passIdx = 0; passIdx < angles.length; passIdx++) {
    const passOpacity = Math.pow(strategy.passDecay, passIdx);
    const hatchPaths = generateHatch(
      angles[passIdx]!,
      strategy.spacing,
      passOpacity,
      region,
      bounds,
      rb,
      evaluate,
      shadingAffects,
      rng,
    );
    paths.push(...hatchPaths);
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Stipple
// ---------------------------------------------------------------------------

function generateStipple(
  strategy: { density: number; distribution: "random" | "poisson" | "jittered-grid" },
  region: FillRegion,
  bounds: LayerBounds,
  rb: { x: number; y: number; width: number; height: number },
  evaluate: (x: number, y: number) => number,
  shadingAffects: ShadingAffect[],
  rng: () => number,
): GeneratedPath[] {
  const paths: GeneratedPath[] = [];
  const area = rb.width * rb.height;
  const totalDots = Math.round((strategy.density / 10000) * area);
  if (totalDots <= 0) return paths;

  let candidates: Array<{ x: number; y: number }>;

  switch (strategy.distribution) {
    case "random":
      candidates = generateRandomPoints(totalDots, rb, rng);
      break;
    case "poisson":
      candidates = generatePoissonPoints(totalDots, rb, rng);
      break;
    case "jittered-grid":
      candidates = generateJitteredGridPoints(totalDots, rb, rng);
      break;
  }

  for (const pt of candidates) {
    if (!pointInRegion(pt.x, pt.y, region, bounds)) continue;

    const shadingValue = evaluate(pt.x, pt.y);

    if (shadingAffects.includes("density")) {
      if (rng() > shadingValue) continue;
    }

    const { opacityScale, sizeScale } = applyShadingToPath(shadingValue, shadingAffects);

    // A stipple dot is a single-point "stroke" (will render as a single stamp)
    paths.push({
      points: [{ x: pt.x, y: pt.y }, { x: pt.x + 0.5, y: pt.y }],
      opacityScale,
      sizeScale,
    });
  }

  return paths;
}

function generateRandomPoints(
  count: number,
  rb: { x: number; y: number; width: number; height: number },
  rng: () => number,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    pts.push({ x: rb.x + rng() * rb.width, y: rb.y + rng() * rb.height });
  }
  return pts;
}

function generateJitteredGridPoints(
  count: number,
  rb: { x: number; y: number; width: number; height: number },
  rng: () => number,
): Array<{ x: number; y: number }> {
  const cols = Math.ceil(Math.sqrt(count * (rb.width / Math.max(rb.height, 1))));
  const rows = Math.ceil(count / cols);
  const cellW = rb.width / cols;
  const cellH = rb.height / rows;
  const pts: Array<{ x: number; y: number }> = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      pts.push({
        x: rb.x + (col + 0.1 + rng() * 0.8) * cellW,
        y: rb.y + (row + 0.1 + rng() * 0.8) * cellH,
      });
    }
  }

  return pts;
}

/**
 * Bridson's algorithm for Poisson disk sampling.
 * Produces blue-noise point distribution with minimum distance between points.
 */
function generatePoissonPoints(
  targetCount: number,
  rb: { x: number; y: number; width: number; height: number },
  rng: () => number,
): Array<{ x: number; y: number }> {
  const area = rb.width * rb.height;
  // Derive minimum distance from target count (area / count ≈ πr²)
  const minDist = Math.sqrt(area / (targetCount * Math.PI));

  const cellSize = minDist / Math.SQRT2;
  const gridW = Math.ceil(rb.width / cellSize);
  const gridH = Math.ceil(rb.height / cellSize);

  const grid: (number | undefined)[] = new Array(gridW * gridH).fill(undefined);
  const pts: Array<{ x: number; y: number }> = [];
  const active: number[] = [];

  const addPoint = (x: number, y: number): number => {
    const idx = pts.length;
    pts.push({ x, y });
    const gx = Math.floor((x - rb.x) / cellSize);
    const gy = Math.floor((y - rb.y) / cellSize);
    if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
      grid[gy * gridW + gx] = idx;
    }
    active.push(idx);
    return idx;
  };

  // Initial seed point
  addPoint(rb.x + rng() * rb.width, rb.y + rng() * rb.height);

  while (active.length > 0 && pts.length < targetCount * 3) {
    const ai = Math.floor(rng() * active.length);
    const origin = pts[active[ai]!]!;
    let found = false;

    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = rng() * Math.PI * 2;
      const radius = minDist + rng() * minDist;
      const nx = origin.x + Math.cos(angle) * radius;
      const ny = origin.y + Math.sin(angle) * radius;

      if (nx < rb.x || nx > rb.x + rb.width || ny < rb.y || ny > rb.y + rb.height) continue;

      const gx = Math.floor((nx - rb.x) / cellSize);
      const gy = Math.floor((ny - rb.y) / cellSize);

      let tooClose = false;
      for (let dy = -2; dy <= 2 && !tooClose; dy++) {
        for (let dx = -2; dx <= 2 && !tooClose; dx++) {
          const ngx = gx + dx;
          const ngy = gy + dy;
          if (ngx < 0 || ngx >= gridW || ngy < 0 || ngy >= gridH) continue;
          const ni = grid[ngy * gridW + ngx];
          if (ni === undefined) continue;
          const np = pts[ni]!;
          const d2 = (nx - np.x) ** 2 + (ny - np.y) ** 2;
          if (d2 < minDist * minDist) tooClose = true;
        }
      }

      if (!tooClose) {
        addPoint(nx, ny);
        found = true;
        break;
      }
    }

    if (!found) {
      active.splice(ai, 1);
    }
  }

  return pts;
}

// ---------------------------------------------------------------------------
// Scumble
// ---------------------------------------------------------------------------

function generateScumble(
  strategy: { density: number; strokeLength: number; curvature: number },
  region: FillRegion,
  bounds: LayerBounds,
  rb: { x: number; y: number; width: number; height: number },
  evaluate: (x: number, y: number) => number,
  shadingAffects: ShadingAffect[],
  rng: () => number,
): GeneratedPath[] {
  const paths: GeneratedPath[] = [];
  const area = rb.width * rb.height;
  const totalStrokes = Math.round((strategy.density / 10000) * area);
  if (totalStrokes <= 0) return paths;

  const segmentCount = Math.max(2, Math.round(strategy.strokeLength / 4));

  for (let i = 0; i < totalStrokes; i++) {
    const sx = rb.x + rng() * rb.width;
    const sy = rb.y + rng() * rb.height;

    if (!pointInRegion(sx, sy, region, bounds)) continue;

    const shadingValue = evaluate(sx, sy);

    if (shadingAffects.includes("density")) {
      if (rng() > shadingValue) continue;
    }

    const { opacityScale, sizeScale } = applyShadingToPath(shadingValue, shadingAffects);

    // Generate a short curved path via random walk
    const strokePoints: Array<{ x: number; y: number }> = [];
    let x = sx;
    let y = sy;
    let angle = rng() * Math.PI * 2;
    const segLen = strategy.strokeLength / segmentCount;

    for (let j = 0; j < segmentCount; j++) {
      strokePoints.push({ x, y });
      // Curvature: random angular deviation per step
      const turnAmount = (rng() - 0.5) * 2 * strategy.curvature * Math.PI * 0.5;
      angle += turnAmount;
      x += Math.cos(angle) * segLen;
      y += Math.sin(angle) * segLen;
    }
    strokePoints.push({ x, y });

    paths.push({ points: strokePoints, opacityScale, sizeScale });
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Contour
// ---------------------------------------------------------------------------

function generateContour(
  strategy: { spacing: number; maxRings?: number; smoothing: number },
  region: FillRegion,
  bounds: LayerBounds,
  rb: { x: number; y: number; width: number; height: number },
  evaluate: (x: number, y: number) => number,
  shadingAffects: ShadingAffect[],
): GeneratedPath[] {
  const paths: GeneratedPath[] = [];
  const sp = Math.max(1, strategy.spacing);
  const maxRings = strategy.maxRings ?? 999;
  const minDim = Math.min(rb.width, rb.height);
  const maxPossibleRings = Math.floor(minDim / (sp * 2));
  const rings = Math.min(maxRings, maxPossibleRings);

  if (rings <= 0) return paths;

  // Start from the outermost polygon of the region
  let polygon = regionToPolygon(region, bounds);

  for (let ringIdx = 0; ringIdx < rings; ringIdx++) {
    if (polygon.length < 3) break;

    // Compute centroid for shading evaluation
    const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
    const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
    const shadingValue = evaluate(cx, cy);

    if (shadingAffects.includes("density") && shadingValue < 0.3) {
      // Skip low-value rings (contour culling by value threshold)
    } else {
      const { opacityScale, sizeScale } = applyShadingToPath(shadingValue, shadingAffects);
      const points = strategy.smoothing > 0 ? smoothPolygon(polygon, strategy.smoothing) : polygon;

      // Close the ring by appending first point
      const closedPoints = [...points, points[0]!];
      paths.push({ points: closedPoints, opacityScale, sizeScale });
    }

    // Offset inward for next ring
    const inner = offsetPolygon(polygon, sp);
    if (!inner) break;
    polygon = inner;
  }

  return paths;
}

/** Smooth a polygon by averaging each vertex with its neighbors. */
function smoothPolygon(
  polygon: Array<{ x: number; y: number }>,
  strength: number,
): Array<{ x: number; y: number }> {
  const n = polygon.length;
  const result: Array<{ x: number; y: number }> = [];
  const s = Math.max(0, Math.min(1, strength));

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n]!;
    const curr = polygon[i]!;
    const next = polygon[(i + 1) % n]!;

    result.push({
      x: curr.x * (1 - s) + ((prev.x + next.x) / 2) * s,
      y: curr.y * (1 - s) + ((prev.y + next.y) / 2) * s,
    });
  }

  return result;
}
