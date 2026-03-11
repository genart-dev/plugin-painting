import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parsePathSource,
  convertPathsToStrokes,
  type AlgorithmStrokePath,
} from "../src/path-source.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SAMPLE_PATHS: AlgorithmStrokePath[] = [
  {
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    depth: 0,
    width: 10,
  },
  {
    points: [
      { x: 100, y: 100 },
      { x: 150, y: 50 },
    ],
    pressure: [1.0, 0.5],
    depth: 1,
    width: 5,
    group: "branch",
  },
  {
    points: [
      { x: 100, y: 100 },
      { x: 80, y: 150 },
    ],
    depth: 2,
    width: 2,
    group: "leaf",
  },
];

// ---------------------------------------------------------------------------
// parsePathSource
// ---------------------------------------------------------------------------

describe("parsePathSource", () => {
  afterEach(() => {
    delete (globalThis as any).__genart_data;
  });

  it("returns empty array for empty string", () => {
    expect(parsePathSource("")).toEqual([]);
  });

  it("returns empty array for unrecognized format", () => {
    expect(parsePathSource("unknown:foo")).toEqual([]);
  });

  it("returns empty array when __genart_data is not set", () => {
    expect(parsePathSource("algorithm:strokePaths")).toEqual([]);
  });

  it("returns empty array when channel is not an array", () => {
    (globalThis as any).__genart_data = { strokePaths: "not-an-array" };
    expect(parsePathSource("algorithm:strokePaths")).toEqual([]);
  });

  it("reads paths from __genart_data", () => {
    (globalThis as any).__genart_data = { strokePaths: SAMPLE_PATHS };
    const result = parsePathSource("algorithm:strokePaths");
    expect(result).toHaveLength(3);
    expect(result[0]!.points).toHaveLength(3);
    expect(result[1]!.group).toBe("branch");
  });

  it("reads from custom channel name", () => {
    (globalThis as any).__genart_data = { customPaths: [SAMPLE_PATHS[0]] };
    const result = parsePathSource("algorithm:customPaths");
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// convertPathsToStrokes
// ---------------------------------------------------------------------------

describe("convertPathsToStrokes", () => {
  it("converts paths to BrushStroke objects", () => {
    const strokes = convertPathsToStrokes(SAMPLE_PATHS, {
      brushId: "flat",
      color: "#000000",
    });
    expect(strokes).toHaveLength(3);
    expect(strokes[0]!.brushId).toBe("flat");
    expect(strokes[0]!.color).toBe("#000000");
    expect(strokes[0]!.points).toHaveLength(3);
  });

  it("uses path width as stroke size", () => {
    const strokes = convertPathsToStrokes(SAMPLE_PATHS, {
      brushId: "flat",
      color: "#000",
    });
    expect(strokes[0]!.size).toBe(10);
    expect(strokes[1]!.size).toBe(5);
    expect(strokes[2]!.size).toBe(2);
  });

  it("falls back to options.size when path has no width", () => {
    const pathNoWidth: AlgorithmStrokePath[] = [
      { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    ];
    const strokes = convertPathsToStrokes(pathNoWidth, {
      brushId: "flat",
      color: "#000",
      size: 8,
    });
    expect(strokes[0]!.size).toBe(8);
  });

  it("maps per-point pressure", () => {
    const strokes = convertPathsToStrokes(SAMPLE_PATHS, {
      brushId: "flat",
      color: "#000",
    });
    // Path 1 has explicit pressure
    expect(strokes[1]!.points[0]!.pressure).toBe(1.0);
    expect(strokes[1]!.points[1]!.pressure).toBe(0.5);
    // Path 0 has no pressure — defaults to 1.0
    expect(strokes[0]!.points[0]!.pressure).toBe(1.0);
  });

  it("skips paths with fewer than 2 points", () => {
    const singlePoint: AlgorithmStrokePath[] = [
      { points: [{ x: 0, y: 0 }] },
      { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    ];
    const strokes = convertPathsToStrokes(singlePoint, {
      brushId: "flat",
      color: "#000",
    });
    expect(strokes).toHaveLength(1);
  });

  it("filters by group", () => {
    const strokes = convertPathsToStrokes(SAMPLE_PATHS, {
      brushId: "flat",
      color: "#000",
      groupFilter: "branch",
    });
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.points).toHaveLength(2);
  });

  it("passes seed and opacity through", () => {
    const strokes = convertPathsToStrokes(SAMPLE_PATHS, {
      brushId: "flat",
      color: "#000",
      opacity: 0.7,
      seed: 42,
    });
    expect(strokes[0]!.opacity).toBe(0.7);
    expect(strokes[0]!.seed).toBe(42);
  });
});
