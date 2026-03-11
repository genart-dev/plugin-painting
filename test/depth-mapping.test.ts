import { describe, it, expect } from "vitest";
import {
  applyDepthMapping,
  parseDepthMapping,
  type DepthMapping,
} from "../src/depth-mapping.js";
import type { AlgorithmStrokePath } from "../src/path-source.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TREE_PATHS: AlgorithmStrokePath[] = [
  {
    points: [{ x: 300, y: 600 }, { x: 300, y: 400 }],
    depth: 0,
    width: 20,
  },
  {
    points: [{ x: 300, y: 400 }, { x: 250, y: 300 }],
    depth: 1,
  },
  {
    points: [{ x: 300, y: 400 }, { x: 350, y: 300 }],
    depth: 1,
  },
  {
    points: [{ x: 250, y: 300 }, { x: 230, y: 250 }],
    depth: 2,
  },
  {
    points: [{ x: 250, y: 300 }, { x: 270, y: 240 }],
    depth: 2,
    pressure: [1.0, 0.3],
  },
];

const MAPPING: DepthMapping = {
  maxDepth: 2,
  width: [20, 4],
  pressure: [1.0, 0.2],
  paintLoad: [1.0, 0.5],
  opacity: [1.0, 0.8],
};

// ---------------------------------------------------------------------------
// applyDepthMapping
// ---------------------------------------------------------------------------

describe("applyDepthMapping", () => {
  it("produces one BrushStroke per path", () => {
    const strokes = applyDepthMapping(TREE_PATHS, MAPPING, "flat", "#000");
    expect(strokes).toHaveLength(5);
  });

  it("interpolates width from depth", () => {
    const strokes = applyDepthMapping(TREE_PATHS, MAPPING, "flat", "#000");
    // depth 0 → width 20
    expect(strokes[0]!.size).toBeCloseTo(20, 2);
    // depth 1 → width lerp(20, 4, 0.5) = 12
    expect(strokes[1]!.size).toBeCloseTo(12, 2);
    // depth 2 → width 4
    expect(strokes[3]!.size).toBeCloseTo(4, 2);
  });

  it("interpolates opacity from depth (opacity * paintLoad)", () => {
    const strokes = applyDepthMapping(TREE_PATHS, MAPPING, "flat", "#000");
    // depth 0: opacity=1.0, paintLoad=1.0 → 1.0
    expect(strokes[0]!.opacity).toBeCloseTo(1.0, 2);
    // depth 1: opacity=lerp(1,0.8,0.5)=0.9, paintLoad=lerp(1,0.5,0.5)=0.75 → 0.675
    expect(strokes[1]!.opacity).toBeCloseTo(0.675, 2);
    // depth 2: opacity=0.8, paintLoad=0.5 → 0.4
    expect(strokes[3]!.opacity).toBeCloseTo(0.4, 2);
  });

  it("scales per-point pressure by depth-mapped pressure", () => {
    const strokes = applyDepthMapping(TREE_PATHS, MAPPING, "flat", "#000");
    // depth 0: pressure mapping = 1.0, default point pressure = 1.0
    expect(strokes[0]!.points[0]!.pressure).toBeCloseTo(1.0, 2);
    // depth 2 (path 4 with explicit pressure [1.0, 0.3]):
    // pressure mapping at depth 2 = 0.2
    // point 0: 1.0 * 0.2 = 0.2
    // point 1: 0.3 * 0.2 = 0.06
    expect(strokes[4]!.points[0]!.pressure).toBeCloseTo(0.2, 2);
    expect(strokes[4]!.points[1]!.pressure).toBeCloseTo(0.06, 2);
  });

  it("clamps depth beyond maxDepth to end values", () => {
    const deepPath: AlgorithmStrokePath[] = [
      { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], depth: 10 },
    ];
    const strokes = applyDepthMapping(deepPath, MAPPING, "flat", "#000");
    // depth 10 but maxDepth is 2 → clamped to t=1.0 → end values
    expect(strokes[0]!.size).toBeCloseTo(4, 2);
    expect(strokes[0]!.opacity).toBeCloseTo(0.4, 2);
  });

  it("uses default values when depth is undefined", () => {
    const noDepth: AlgorithmStrokePath[] = [
      { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    ];
    const strokes = applyDepthMapping(noDepth, MAPPING, "flat", "#000");
    // depth defaults to 0 → start values
    expect(strokes[0]!.size).toBeCloseTo(20, 2);
  });

  it("uses path width when no width mapping defined", () => {
    const noWidthMapping: DepthMapping = { maxDepth: 3 };
    const paths: AlgorithmStrokePath[] = [
      { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], width: 15, depth: 1 },
    ];
    const strokes = applyDepthMapping(paths, noWidthMapping, "flat", "#000");
    // No width mapping → uses path.width
    expect(strokes[0]!.size).toBe(15);
  });

  it("skips single-point paths", () => {
    const single: AlgorithmStrokePath[] = [
      { points: [{ x: 0, y: 0 }], depth: 0 },
    ];
    const strokes = applyDepthMapping(single, MAPPING, "flat", "#000");
    expect(strokes).toHaveLength(0);
  });

  it("passes brushId, color, and seed through", () => {
    const strokes = applyDepthMapping(TREE_PATHS, MAPPING, "round-soft", "#ff0000", 42);
    expect(strokes[0]!.brushId).toBe("round-soft");
    expect(strokes[0]!.color).toBe("#ff0000");
    expect(strokes[0]!.seed).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// parseDepthMapping
// ---------------------------------------------------------------------------

describe("parseDepthMapping", () => {
  it("returns null for empty string", () => {
    expect(parseDepthMapping("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseDepthMapping("{bad json")).toBeNull();
  });

  it("returns null for non-object", () => {
    expect(parseDepthMapping('"string"')).toBeNull();
    expect(parseDepthMapping("42")).toBeNull();
    expect(parseDepthMapping("null")).toBeNull();
  });

  it("returns null when maxDepth is missing", () => {
    expect(parseDepthMapping('{"width": [10, 2]}')).toBeNull();
  });

  it("returns null when maxDepth is negative", () => {
    expect(parseDepthMapping('{"maxDepth": -1}')).toBeNull();
  });

  it("parses minimal mapping (maxDepth only)", () => {
    const result = parseDepthMapping('{"maxDepth": 5}');
    expect(result).not.toBeNull();
    expect(result!.maxDepth).toBe(5);
    expect(result!.width).toBeUndefined();
    expect(result!.pressure).toBeUndefined();
  });

  it("parses full mapping", () => {
    const json = JSON.stringify({
      maxDepth: 4,
      width: [60, 4],
      pressure: [1.0, 0.15],
      paintLoad: [0.9, 0.3],
      opacity: [1.0, 0.6],
    });
    const result = parseDepthMapping(json);
    expect(result).not.toBeNull();
    expect(result!.maxDepth).toBe(4);
    expect(result!.width).toEqual([60, 4]);
    expect(result!.pressure).toEqual([1.0, 0.15]);
    expect(result!.paintLoad).toEqual([0.9, 0.3]);
    expect(result!.opacity).toEqual([1.0, 0.6]);
  });

  it("ignores invalid range values", () => {
    const json = JSON.stringify({
      maxDepth: 3,
      width: "not-an-array",
      pressure: [1.0], // wrong length
      opacity: [1.0, 0.5], // valid
    });
    const result = parseDepthMapping(json);
    expect(result).not.toBeNull();
    expect(result!.width).toBeUndefined();
    expect(result!.pressure).toBeUndefined();
    expect(result!.opacity).toEqual([1.0, 0.5]);
  });
});
