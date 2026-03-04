import { describe, it, expect } from "vitest";
import { generateFillPaths } from "../src/fill/generators.js";
import type { FillStrategy, FillRegion, ShadingFunction } from "../src/fill/types.js";
import type { LayerBounds } from "@genart-dev/core";

const BOUNDS: LayerBounds = { x: 0, y: 0, width: 400, height: 300 };
const BOUNDS_REGION: FillRegion = { type: "bounds" };
const UNIFORM: ShadingFunction = { type: "uniform" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generate(
  strategy: FillStrategy,
  region: FillRegion = BOUNDS_REGION,
  shading: ShadingFunction = UNIFORM,
  seed = 42,
) {
  return generateFillPaths(strategy, region, shading, ["density"], BOUNDS, seed);
}

// ---------------------------------------------------------------------------
// Hatch
// ---------------------------------------------------------------------------

describe("generateFillPaths — hatch", () => {
  it("produces paths for a non-empty region", () => {
    const paths = generate({ type: "hatch", angle: 45, spacing: 20 });
    expect(paths.length).toBeGreaterThan(0);
  });

  it("each path has exactly 2 points", () => {
    const paths = generate({ type: "hatch", angle: 45, spacing: 20 });
    for (const p of paths) {
      expect(p.points).toHaveLength(2);
    }
  });

  it("wider spacing produces fewer paths than narrow spacing", () => {
    const wide = generate({ type: "hatch", angle: 45, spacing: 40 });
    const narrow = generate({ type: "hatch", angle: 45, spacing: 8 });
    expect(narrow.length).toBeGreaterThan(wide.length);
  });

  it("horizontal and vertical hatches both produce paths", () => {
    const horiz = generate({ type: "hatch", angle: 0, spacing: 20 });
    const vert = generate({ type: "hatch", angle: 90, spacing: 20 });
    expect(horiz.length).toBeGreaterThan(0);
    expect(vert.length).toBeGreaterThan(0);
  });

  it("all paths have opacityScale = 1 under uniform shading (density affect)", () => {
    const paths = generate({ type: "hatch", angle: 45, spacing: 20 });
    for (const p of paths) {
      expect(p.opacityScale).toBe(1);
      expect(p.sizeScale).toBe(1);
    }
  });

  it("is deterministic for same seed", () => {
    const a = generate({ type: "hatch", angle: 30, spacing: 15 }, BOUNDS_REGION, UNIFORM, 7);
    const b = generate({ type: "hatch", angle: 30, spacing: 15 }, BOUNDS_REGION, UNIFORM, 7);
    expect(a.length).toBe(b.length);
  });

  it("respects region clipping (rect region produces fewer or equal paths than bounds)", () => {
    const small: FillRegion = { type: "rect", x: 0, y: 0, width: 100, height: 100 };
    const full = generate({ type: "hatch", angle: 45, spacing: 10 });
    const partial = generate({ type: "hatch", angle: 45, spacing: 10 }, small);
    expect(partial.length).toBeLessThanOrEqual(full.length);
  });

  it("linear shading with density affect skips some lines (< uniform count)", () => {
    // Linear shading with range [0,1] — half the lines should be culled on average
    const uniform = generate(
      { type: "hatch", angle: 45, spacing: 10 },
      BOUNDS_REGION,
      { type: "uniform" },
      99,
    );
    const shaded = generate(
      { type: "hatch", angle: 45, spacing: 10 },
      BOUNDS_REGION,
      { type: "linear", angle: 0, range: [0, 1] },
      99,
    );
    expect(shaded.length).toBeLessThan(uniform.length);
  });
});

// ---------------------------------------------------------------------------
// Crosshatch
// ---------------------------------------------------------------------------

describe("generateFillPaths — crosshatch", () => {
  it("two-angle crosshatch produces roughly 2x hatch paths", () => {
    const hatch = generate({ type: "hatch", angle: 45, spacing: 20 });
    const cross = generate({ type: "crosshatch", angles: [45, 135], spacing: 20, passDecay: 1 });
    // Crosshatch should produce approximately 2× the lines of single hatch
    expect(cross.length).toBeGreaterThan(hatch.length);
  });

  it("passDecay < 1 gives second pass paths lower opacityScale", () => {
    const paths = generate({ type: "crosshatch", angles: [45, 135], spacing: 20, passDecay: 0.5 });
    const opacities = paths.map((p) => p.opacityScale);
    const fullOpacity = opacities.filter((o) => o === 1);
    const decayedOpacity = opacities.filter((o) => o < 1);
    // There should be paths at both opacity levels
    expect(fullOpacity.length).toBeGreaterThan(0);
    expect(decayedOpacity.length).toBeGreaterThan(0);
  });

  it("three angles produces paths for all passes", () => {
    const paths = generate({ type: "crosshatch", angles: [0, 60, 120], spacing: 20, passDecay: 0.7 });
    // Should have paths at decay^0=1, decay^1=0.7, decay^2=0.49
    const unique = new Set(paths.map((p) => Math.round(p.opacityScale * 1000)));
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  it("falls back to [45,135] when angles array is empty", () => {
    const explicit = generate({ type: "crosshatch", angles: [45, 135], spacing: 20, passDecay: 1 });
    const fallback = generate({ type: "crosshatch", angles: [], spacing: 20, passDecay: 1 });
    expect(fallback.length).toBe(explicit.length);
  });
});

// ---------------------------------------------------------------------------
// Stipple
// ---------------------------------------------------------------------------

describe("generateFillPaths — stipple", () => {
  it("produces paths for poisson distribution", () => {
    const paths = generate({ type: "stipple", density: 20, distribution: "poisson" });
    expect(paths.length).toBeGreaterThan(0);
  });

  it("produces paths for random distribution", () => {
    const paths = generate({ type: "stipple", density: 20, distribution: "random" });
    expect(paths.length).toBeGreaterThan(0);
  });

  it("produces paths for jittered-grid distribution", () => {
    const paths = generate({ type: "stipple", density: 20, distribution: "jittered-grid" });
    expect(paths.length).toBeGreaterThan(0);
  });

  it("each stipple path has exactly 2 points (dot representation)", () => {
    const paths = generate({ type: "stipple", density: 20, distribution: "random" });
    for (const p of paths) {
      expect(p.points).toHaveLength(2);
    }
  });

  it("higher density produces more paths than lower density", () => {
    const light = generate({ type: "stipple", density: 10, distribution: "poisson" });
    const dense = generate({ type: "stipple", density: 60, distribution: "poisson" });
    expect(dense.length).toBeGreaterThan(light.length);
  });

  it("stipple dots are within bounds region", () => {
    const paths = generate({ type: "stipple", density: 30, distribution: "random" });
    for (const p of paths) {
      const pt = p.points[0]!;
      expect(pt.x).toBeGreaterThanOrEqual(0);
      expect(pt.x).toBeLessThanOrEqual(400);
      expect(pt.y).toBeGreaterThanOrEqual(0);
      expect(pt.y).toBeLessThanOrEqual(300);
    }
  });

  it("ellipse region culls dots outside the ellipse", () => {
    const ellipseRegion: FillRegion = { type: "ellipse", cx: 200, cy: 150, rx: 50, ry: 50 };
    const fullPaths = generate({ type: "stipple", density: 30, distribution: "random" });
    const clippedPaths = generate(
      { type: "stipple", density: 30, distribution: "random" },
      ellipseRegion,
    );
    expect(clippedPaths.length).toBeLessThan(fullPaths.length);
  });

  it("density 0 produces no paths", () => {
    const paths = generate({ type: "stipple", density: 0, distribution: "random" });
    expect(paths.length).toBe(0);
  });

  it("is deterministic for same seed", () => {
    const a = generate({ type: "stipple", density: 25, distribution: "poisson" }, BOUNDS_REGION, UNIFORM, 17);
    const b = generate({ type: "stipple", density: 25, distribution: "poisson" }, BOUNDS_REGION, UNIFORM, 17);
    expect(a.length).toBe(b.length);
  });
});

// ---------------------------------------------------------------------------
// Scumble
// ---------------------------------------------------------------------------

describe("generateFillPaths — scumble", () => {
  it("produces paths for non-empty region", () => {
    const paths = generate({ type: "scumble", density: 15, strokeLength: 20, curvature: 0.5 });
    expect(paths.length).toBeGreaterThan(0);
  });

  it("each path has more than 2 points (curved strokes)", () => {
    const paths = generate({ type: "scumble", density: 15, strokeLength: 20, curvature: 0.5 });
    for (const p of paths) {
      expect(p.points.length).toBeGreaterThan(2);
    }
  });

  it("higher density produces more strokes", () => {
    const light = generate({ type: "scumble", density: 5, strokeLength: 20, curvature: 0.3 });
    const dense = generate({ type: "scumble", density: 30, strokeLength: 20, curvature: 0.3 });
    expect(dense.length).toBeGreaterThan(light.length);
  });

  it("curvature 0 vs 1 both produce paths (extreme values don't crash)", () => {
    expect(() =>
      generate({ type: "scumble", density: 10, strokeLength: 20, curvature: 0 }),
    ).not.toThrow();
    expect(() =>
      generate({ type: "scumble", density: 10, strokeLength: 20, curvature: 1 }),
    ).not.toThrow();
  });

  it("is deterministic for same seed", () => {
    const a = generate({ type: "scumble", density: 10, strokeLength: 15, curvature: 0.4 }, BOUNDS_REGION, UNIFORM, 3);
    const b = generate({ type: "scumble", density: 10, strokeLength: 15, curvature: 0.4 }, BOUNDS_REGION, UNIFORM, 3);
    expect(a.length).toBe(b.length);
  });
});

// ---------------------------------------------------------------------------
// Contour
// ---------------------------------------------------------------------------

describe("generateFillPaths — contour", () => {
  it("produces rings for a polygon region", () => {
    const region: FillRegion = {
      type: "polygon",
      points: [{ x: 50, y: 50 }, { x: 350, y: 50 }, { x: 350, y: 250 }, { x: 50, y: 250 }],
    };
    const paths = generateFillPaths(
      { type: "contour", spacing: 10, smoothing: 0 },
      region,
      UNIFORM,
      ["density"],
      BOUNDS,
      42,
    );
    expect(paths.length).toBeGreaterThan(0);
  });

  it("produces rings for a rect region", () => {
    const region: FillRegion = { type: "rect", x: 50, y: 50, width: 200, height: 150 };
    const paths = generateFillPaths(
      { type: "contour", spacing: 10, smoothing: 0 },
      region,
      UNIFORM,
      ["density"],
      BOUNDS,
      42,
    );
    expect(paths.length).toBeGreaterThan(0);
  });

  it("each contour path is a closed ring (first and last points equal)", () => {
    const region: FillRegion = { type: "rect", x: 50, y: 50, width: 200, height: 150 };
    const paths = generateFillPaths(
      { type: "contour", spacing: 10, smoothing: 0 },
      region,
      UNIFORM,
      ["density"],
      BOUNDS,
      42,
    );
    for (const p of paths) {
      const first = p.points[0]!;
      const last = p.points[p.points.length - 1]!;
      expect(first).toEqual(last);
    }
  });

  it("tighter spacing produces more rings", () => {
    const region: FillRegion = { type: "rect", x: 0, y: 0, width: 200, height: 200 };
    const wide = generateFillPaths(
      { type: "contour", spacing: 20, smoothing: 0 },
      region,
      UNIFORM,
      ["density"],
      BOUNDS,
      42,
    );
    const tight = generateFillPaths(
      { type: "contour", spacing: 8, smoothing: 0 },
      region,
      UNIFORM,
      ["density"],
      BOUNDS,
      42,
    );
    expect(tight.length).toBeGreaterThan(wide.length);
  });

  it("maxRings limits the number of generated rings", () => {
    const region: FillRegion = { type: "rect", x: 0, y: 0, width: 200, height: 200 };
    const limited = generateFillPaths(
      { type: "contour", spacing: 5, maxRings: 3, smoothing: 0 },
      region,
      UNIFORM,
      ["density"],
      BOUNDS,
      42,
    );
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it("smoothing does not crash and produces same number of rings", () => {
    const region: FillRegion = { type: "rect", x: 0, y: 0, width: 200, height: 200 };
    const noSmooth = generateFillPaths(
      { type: "contour", spacing: 15, smoothing: 0 },
      region, UNIFORM, ["density"], BOUNDS, 42,
    );
    const smoothed = generateFillPaths(
      { type: "contour", spacing: 15, smoothing: 0.5 },
      region, UNIFORM, ["density"], BOUNDS, 42,
    );
    expect(smoothed.length).toBe(noSmooth.length);
  });

  it("ellipse region produces rings", () => {
    const region: FillRegion = { type: "ellipse", cx: 200, cy: 150, rx: 100, ry: 80 };
    const paths = generateFillPaths(
      { type: "contour", spacing: 10, smoothing: 0.3 },
      region,
      UNIFORM,
      ["density"],
      BOUNDS,
      42,
    );
    expect(paths.length).toBeGreaterThan(0);
  });
});
