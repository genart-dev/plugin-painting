import { describe, it, expect } from "vitest";
import {
  regionBounds,
  pointInRegion,
  offsetPolygon,
  regionToPolygon,
} from "../src/fill/region-utils.js";
import { buildShadingEvaluator, applyShadingToPath } from "../src/fill/shading.js";
import type { FillRegion } from "../src/fill/types.js";
import type { LayerBounds } from "@genart-dev/core";

const BOUNDS: LayerBounds = { x: 0, y: 0, width: 400, height: 300 };

// ---------------------------------------------------------------------------
// regionBounds
// ---------------------------------------------------------------------------

describe("regionBounds", () => {
  it("bounds region returns layer bounds", () => {
    const rb = regionBounds({ type: "bounds" }, BOUNDS);
    expect(rb).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it("rect region returns the rect", () => {
    const rb = regionBounds({ type: "rect", x: 10, y: 20, width: 100, height: 80 }, BOUNDS);
    expect(rb).toEqual({ x: 10, y: 20, width: 100, height: 80 });
  });

  it("ellipse region returns enclosing box", () => {
    const rb = regionBounds({ type: "ellipse", cx: 200, cy: 150, rx: 60, ry: 40 }, BOUNDS);
    expect(rb).toEqual({ x: 140, y: 110, width: 120, height: 80 });
  });

  it("polygon region returns tight bounding box", () => {
    const region: FillRegion = {
      type: "polygon",
      points: [{ x: 10, y: 20 }, { x: 80, y: 5 }, { x: 50, y: 90 }],
    };
    const rb = regionBounds(region, BOUNDS);
    expect(rb.x).toBe(10);
    expect(rb.y).toBe(5);
    expect(rb.width).toBe(70);
    expect(rb.height).toBe(85);
  });
});

// ---------------------------------------------------------------------------
// pointInRegion
// ---------------------------------------------------------------------------

describe("pointInRegion", () => {
  it("bounds: accepts interior points", () => {
    expect(pointInRegion(200, 150, { type: "bounds" }, BOUNDS)).toBe(true);
    expect(pointInRegion(0, 0, { type: "bounds" }, BOUNDS)).toBe(true);
  });

  it("bounds: rejects exterior points", () => {
    expect(pointInRegion(-1, 150, { type: "bounds" }, BOUNDS)).toBe(false);
    expect(pointInRegion(401, 150, { type: "bounds" }, BOUNDS)).toBe(false);
  });

  it("rect: accepts interior, rejects exterior", () => {
    const r: FillRegion = { type: "rect", x: 100, y: 100, width: 100, height: 100 };
    expect(pointInRegion(150, 150, r, BOUNDS)).toBe(true);
    expect(pointInRegion(50, 150, r, BOUNDS)).toBe(false);
    expect(pointInRegion(150, 250, r, BOUNDS)).toBe(false);
  });

  it("ellipse: center is inside, outside corner is outside", () => {
    const r: FillRegion = { type: "ellipse", cx: 200, cy: 150, rx: 80, ry: 60 };
    expect(pointInRegion(200, 150, r, BOUNDS)).toBe(true);
    expect(pointInRegion(0, 0, r, BOUNDS)).toBe(false);
    // Point just outside edge
    expect(pointInRegion(285, 150, r, BOUNDS)).toBe(false);
    // Point just inside edge
    expect(pointInRegion(275, 150, r, BOUNDS)).toBe(true);
  });

  it("polygon (triangle): centroid inside, far point outside", () => {
    const r: FillRegion = {
      type: "polygon",
      points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
    };
    expect(pointInRegion(150, 130, r, BOUNDS)).toBe(true);
    expect(pointInRegion(50, 50, r, BOUNDS)).toBe(false);
    expect(pointInRegion(250, 200, r, BOUNDS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// offsetPolygon
// ---------------------------------------------------------------------------

describe("offsetPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("returns null for degenerate polygon (< 3 points)", () => {
    expect(offsetPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }], 5)).toBeNull();
  });

  it("returns a polygon with the same number of vertices", () => {
    const result = offsetPolygon(square, 10);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(4);
  });

  it("returns a polygon offset from the original", () => {
    const result = offsetPolygon(square, 10);
    expect(result).not.toBeNull();
    // Offset points should differ from the originals
    const original = new Set(square.map((p) => `${p.x},${p.y}`));
    const anyChanged = result!.some((p) => !original.has(`${p.x},${p.y}`));
    expect(anyChanged).toBe(true);
  });

  it("returns null for a single-pixel polygon (area < 1)", () => {
    // A 0.5×0.5 square has area 0.25, well below the 1px² threshold
    const micro = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0, y: 0.5 },
    ];
    expect(offsetPolygon(micro, 0.01)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// regionToPolygon
// ---------------------------------------------------------------------------

describe("regionToPolygon", () => {
  it("bounds → 4-point rectangle", () => {
    const pts = regionToPolygon({ type: "bounds" }, BOUNDS);
    expect(pts).toHaveLength(4);
  });

  it("rect → 4-point rectangle with correct coords", () => {
    const pts = regionToPolygon({ type: "rect", x: 10, y: 20, width: 100, height: 50 }, BOUNDS);
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ x: 10, y: 20 });
    expect(pts[2]).toEqual({ x: 110, y: 70 });
  });

  it("ellipse → 48-point polygon approximation", () => {
    const pts = regionToPolygon({ type: "ellipse", cx: 200, cy: 150, rx: 80, ry: 60 }, BOUNDS);
    expect(pts).toHaveLength(48);
    // All points should lie on the ellipse boundary
    for (const pt of pts) {
      const nx = (pt.x - 200) / 80;
      const ny = (pt.y - 150) / 60;
      expect(nx * nx + ny * ny).toBeCloseTo(1, 5);
    }
  });

  it("polygon → same points", () => {
    const input = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }];
    const pts = regionToPolygon({ type: "polygon", points: input }, BOUNDS);
    expect(pts).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// buildShadingEvaluator
// ---------------------------------------------------------------------------

describe("buildShadingEvaluator", () => {
  const rx = 0, ry = 0, rw = 400, rh = 300;

  it("uniform always returns 1", () => {
    const eval_ = buildShadingEvaluator({ type: "uniform" }, rx, ry, rw, rh);
    expect(eval_(0, 0)).toBe(1);
    expect(eval_(200, 150)).toBe(1);
    expect(eval_(400, 300)).toBe(1);
  });

  it("linear returns values in [range[0], range[1]]", () => {
    const eval_ = buildShadingEvaluator(
      { type: "linear", angle: 0, range: [0.2, 1.0] },
      rx, ry, rw, rh,
    );
    for (let x = 0; x <= 400; x += 40) {
      const v = eval_(x, 150);
      expect(v).toBeGreaterThanOrEqual(0.19); // small floating-point slack
      expect(v).toBeLessThanOrEqual(1.01);
    }
  });

  it("radial returns 1 (hi range) at edges for range [0,1]", () => {
    const eval_ = buildShadingEvaluator(
      { type: "radial", cx: 0.5, cy: 0.5, range: [0, 1] },
      rx, ry, rw, rh,
    );
    // Center should be close to 0 (nearest to cx/cy = 0.5,0.5)
    const center = eval_(200, 150);
    expect(center).toBeLessThan(0.1);
    // Edge should be near 1
    const edge = eval_(0, 0);
    expect(edge).toBeGreaterThan(0.7);
  });

  it("noise returns values in [lo, hi] range", () => {
    const eval_ = buildShadingEvaluator(
      { type: "noise", seed: 42, scale: 1, range: [0.3, 0.9] },
      rx, ry, rw, rh,
    );
    for (let x = 0; x <= 400; x += 50) {
      for (let y = 0; y <= 300; y += 50) {
        const v = eval_(x, y);
        expect(v).toBeGreaterThanOrEqual(0.29);
        expect(v).toBeLessThanOrEqual(0.91);
      }
    }
  });

  it("noise is deterministic for same seed", () => {
    const e1 = buildShadingEvaluator({ type: "noise", seed: 7, scale: 0.5, range: [0, 1] }, rx, ry, rw, rh);
    const e2 = buildShadingEvaluator({ type: "noise", seed: 7, scale: 0.5, range: [0, 1] }, rx, ry, rw, rh);
    expect(e1(100, 100)).toBe(e2(100, 100));
    expect(e1(200, 50)).toBe(e2(200, 50));
  });

  it("noise differs for different seeds", () => {
    const e1 = buildShadingEvaluator({ type: "noise", seed: 1, scale: 0.5, range: [0, 1] }, rx, ry, rw, rh);
    const e2 = buildShadingEvaluator({ type: "noise", seed: 2, scale: 0.5, range: [0, 1] }, rx, ry, rw, rh);
    // Very unlikely to be equal at all sample points
    const vals1 = [e1(100, 100), e1(200, 200), e1(50, 250)];
    const vals2 = [e2(100, 100), e2(200, 200), e2(50, 250)];
    expect(vals1).not.toEqual(vals2);
  });

  // -- Algorithm shading (ADR 062) --

  it("algorithm: returns lo when __genart_data is missing", () => {
    delete (globalThis as any).__genart_data;
    const eval_ = buildShadingEvaluator(
      { type: "algorithm", channel: "valueMap", range: [0.2, 0.9] },
      rx, ry, rw, rh,
    );
    expect(eval_(0, 0)).toBe(0.2);
    expect(eval_(200, 150)).toBe(0.2);
  });

  it("algorithm: returns lo when channel is absent", () => {
    (globalThis as any).__genart_data = { cols: 2, rows: 2 };
    const eval_ = buildShadingEvaluator(
      { type: "algorithm", channel: "missing", range: [0.3, 1.0] },
      rx, ry, rw, rh,
    );
    expect(eval_(100, 100)).toBe(0.3);
    delete (globalThis as any).__genart_data;
  });

  it("algorithm: bilinear interpolates scalar data with range remap", () => {
    // 2x2 scalar grid: top-left=0, top-right=1, bottom-left=0, bottom-right=1
    (globalThis as any).__genart_data = {
      valueMap: new Float32Array([0, 1, 0, 1]),
      cols: 2,
      rows: 2,
    };
    const eval_ = buildShadingEvaluator(
      { type: "algorithm", channel: "valueMap", range: [0, 1] },
      rx, ry, rw, rh,
    );
    // Center of region (200, 150) → nx=0.5, ny=0.5 → bilinear avg = 0.5
    expect(eval_(200, 150)).toBeCloseTo(0.5, 2);
    // Left edge (0, 150) → nx=0, ny=0.5 → avg of [0, 0] = 0
    expect(eval_(0, 150)).toBeCloseTo(0, 2);
    // Right edge (400, 150) → nx=1, ny=0.5 → avg of [1, 1] = 1
    expect(eval_(400, 150)).toBeCloseTo(1, 2);
    delete (globalThis as any).__genart_data;
  });

  it("algorithm: applies range remap correctly", () => {
    // Uniform scalar grid with value 0.5
    (globalThis as any).__genart_data = {
      valueMap: new Float32Array([0.5, 0.5, 0.5, 0.5]),
      cols: 2,
      rows: 2,
    };
    const eval_ = buildShadingEvaluator(
      { type: "algorithm", channel: "valueMap", range: [0.2, 0.8] },
      rx, ry, rw, rh,
    );
    // raw=0.5, remapped: 0.2 + (0.8-0.2)*0.5 = 0.5
    expect(eval_(200, 150)).toBeCloseTo(0.5, 2);
    delete (globalThis as any).__genart_data;
  });

  it("algorithm: handles vector channel (reads magnitude)", () => {
    // 2x2 vector grid: [dx, dy, mag] triples. mag values: 0.2, 0.4, 0.6, 0.8
    (globalThis as any).__genart_data = {
      flowField: new Float32Array([
        1, 0, 0.2,
        0, 1, 0.4,
        -1, 0, 0.6,
        0, -1, 0.8,
      ]),
      cols: 2,
      rows: 2,
    };
    const eval_ = buildShadingEvaluator(
      { type: "algorithm", channel: "flowField", range: [0, 1] },
      rx, ry, rw, rh,
    );
    // Center → bilinear of [0.2, 0.4, 0.6, 0.8] = 0.5
    expect(eval_(200, 150)).toBeCloseTo(0.5, 2);
    delete (globalThis as any).__genart_data;
  });
});

// ---------------------------------------------------------------------------
// applyShadingToPath
// ---------------------------------------------------------------------------

describe("applyShadingToPath", () => {
  it("density affect: opacity and size are 1.0 (no modulation)", () => {
    const result = applyShadingToPath(0.5, ["density"]);
    expect(result.opacityScale).toBe(1);
    expect(result.sizeScale).toBe(1);
  });

  it("opacity affect: opacity scales with value", () => {
    const result = applyShadingToPath(0.5, ["opacity"]);
    expect(result.opacityScale).toBeCloseTo(0.5);
    expect(result.sizeScale).toBe(1);
  });

  it("weight affect: size scales with value (min 0.1)", () => {
    const result = applyShadingToPath(0.8, ["weight"]);
    expect(result.sizeScale).toBeCloseTo(0.8);
    expect(result.opacityScale).toBe(1);
  });

  it("weight affect: clamps to minimum 0.1 at low values", () => {
    const result = applyShadingToPath(0.0, ["weight"]);
    expect(result.sizeScale).toBeCloseTo(0.1);
  });

  it("multiple affects: both opacity and weight scale", () => {
    const result = applyShadingToPath(0.6, ["opacity", "weight"]);
    expect(result.opacityScale).toBeCloseTo(0.6);
    expect(result.sizeScale).toBeCloseTo(0.6);
  });

  it("full value (1.0) with any affects leaves scales at 1", () => {
    const r1 = applyShadingToPath(1.0, ["opacity"]);
    const r2 = applyShadingToPath(1.0, ["weight"]);
    expect(r1.opacityScale).toBe(1);
    expect(r2.sizeScale).toBe(1);
  });
});
