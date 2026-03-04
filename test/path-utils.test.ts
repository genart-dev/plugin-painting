import { describe, it, expect } from "vitest";
import {
  interpolatePath,
  arcLengthParameterize,
  taperScale,
} from "../src/brush/path-utils.js";
import type { StrokePoint } from "../src/brush/types.js";

// ---------------------------------------------------------------------------
// interpolatePath
// ---------------------------------------------------------------------------

describe("interpolatePath", () => {
  it("returns raw points when smoothing is 0", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    const result = interpolatePath(points, 0);
    expect(result).toEqual(points);
  });

  it("returns a copy (not the same array reference)", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const result = interpolatePath(points, 0);
    expect(result).not.toBe(points);
  });

  it("returns the single point for a 1-point input", () => {
    const points: StrokePoint[] = [{ x: 5, y: 5, pressure: 0.7 }];
    const result = interpolatePath(points, 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.x).toBe(5);
  });

  it("produces more points than input when smoothing > 0", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
      { x: 150, y: 50 },
    ];
    const result = interpolatePath(points, 1);
    expect(result.length).toBeGreaterThan(points.length);
  });

  it("interpolated path passes through control points (approximately)", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 100 },
      { x: 300, y: 100 },
    ];
    const result = interpolatePath(points, 1);

    // First point should be very close to points[0]
    expect(result[0]!.x).toBeCloseTo(0, 0);
    expect(result[0]!.y).toBeCloseTo(0, 0);

    // Last point should be the last control point
    const last = result[result.length - 1]!;
    expect(last.x).toBeCloseTo(300, 0);
    expect(last.y).toBeCloseTo(100, 0);
  });

  it("interpolates pressure linearly between control points", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0 },
      { x: 100, y: 0, pressure: 1 },
    ];
    const result = interpolatePath(points, 1);

    // Pressure should increase monotonically from 0 to 1
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.pressure!).toBeGreaterThanOrEqual(result[i - 1]!.pressure! - 0.01);
    }
    expect(result[0]!.pressure).toBeCloseTo(0, 1);
    expect(result[result.length - 1]!.pressure).toBeCloseTo(1, 1);
  });

  it("produces a smooth curve (no sharp jumps)", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 0 },
      { x: 150, y: 100 },
    ];
    const result = interpolatePath(points, 1);

    // Check that consecutive points are reasonably close
    for (let i = 1; i < result.length; i++) {
      const dx = result[i]!.x - result[i - 1]!.x;
      const dy = result[i]!.y - result[i - 1]!.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // With smoothing, steps should be much smaller than the total path
      expect(dist).toBeLessThan(50);
    }
  });

  it("handles two points", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    const result = interpolatePath(points, 1);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]!.x).toBeCloseTo(0, 0);
    expect(result[result.length - 1]!.x).toBeCloseTo(100, 0);
  });
});

// ---------------------------------------------------------------------------
// arcLengthParameterize
// ---------------------------------------------------------------------------

describe("arcLengthParameterize", () => {
  it("returns totalLength 0 for empty input", () => {
    const arc = arcLengthParameterize([]);
    expect(arc.totalLength).toBe(0);
  });

  it("returns totalLength 0 for a single point", () => {
    const arc = arcLengthParameterize([{ x: 5, y: 5 }]);
    expect(arc.totalLength).toBe(0);
    const sample = arc.sampleAt(0);
    expect(sample.x).toBe(5);
    expect(sample.y).toBe(5);
  });

  it("computes correct total length for a straight horizontal line", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const arc = arcLengthParameterize(points);
    expect(arc.totalLength).toBeCloseTo(100, 5);
  });

  it("computes correct total length for a diagonal", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
    ];
    const arc = arcLengthParameterize(points);
    expect(arc.totalLength).toBeCloseTo(50, 5);
  });

  it("computes total length for multi-segment path", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const arc = arcLengthParameterize(points);
    expect(arc.totalLength).toBeCloseTo(20, 5);
  });

  it("sampleAt(0) returns the first point", () => {
    const points: StrokePoint[] = [
      { x: 10, y: 20, pressure: 0.3 },
      { x: 110, y: 20, pressure: 0.9 },
    ];
    const arc = arcLengthParameterize(points);
    const sample = arc.sampleAt(0);
    expect(sample.x).toBeCloseTo(10, 5);
    expect(sample.y).toBeCloseTo(20, 5);
    expect(sample.pressure).toBeCloseTo(0.3, 5);
  });

  it("sampleAt(totalLength) returns the last point", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0 },
      { x: 100, y: 0, pressure: 1 },
    ];
    const arc = arcLengthParameterize(points);
    const sample = arc.sampleAt(arc.totalLength);
    expect(sample.x).toBeCloseTo(100, 5);
    expect(sample.y).toBeCloseTo(0, 5);
    expect(sample.pressure).toBeCloseTo(1, 5);
  });

  it("sampleAt(midpoint) returns interpolated position", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const arc = arcLengthParameterize(points);
    const mid = arc.sampleAt(50);
    expect(mid.x).toBeCloseTo(50, 5);
    expect(mid.y).toBeCloseTo(0, 5);
  });

  it("samples at uniform intervals produce evenly-spaced points", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ];
    const arc = arcLengthParameterize(points);
    const n = 10;
    const step = arc.totalLength / n;

    const samples = [];
    for (let i = 0; i <= n; i++) {
      samples.push(arc.sampleAt(i * step));
    }

    // All points should be on y=0 and x should increase uniformly
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i]!.x).toBeCloseTo(i * 10, 1);
      expect(samples[i]!.y).toBeCloseTo(0, 5);
    }
  });

  it("clamps negative distances to start", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const arc = arcLengthParameterize(points);
    const sample = arc.sampleAt(-10);
    expect(sample.x).toBeCloseTo(0, 5);
  });

  it("clamps distances beyond totalLength to end", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const arc = arcLengthParameterize(points);
    const sample = arc.sampleAt(200);
    expect(sample.x).toBeCloseTo(100, 5);
  });

  it("interpolates pressure along the path", () => {
    const points: StrokePoint[] = [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 100, y: 0, pressure: 0.8 },
    ];
    const arc = arcLengthParameterize(points);
    const mid = arc.sampleAt(50);
    expect(mid.pressure).toBeCloseTo(0.5, 1);
  });
});

// ---------------------------------------------------------------------------
// taperScale
// ---------------------------------------------------------------------------

describe("taperScale", () => {
  it("returns 1.0 when no taper is set", () => {
    expect(taperScale(50, 100, 0, 0)).toBe(1.0);
  });

  it("ramps up from 0 to 1 over taperStart", () => {
    expect(taperScale(0, 100, 20, 0)).toBe(0);
    expect(taperScale(10, 100, 20, 0)).toBeCloseTo(0.5, 5);
    expect(taperScale(20, 100, 20, 0)).toBeCloseTo(1.0, 5);
    expect(taperScale(50, 100, 20, 0)).toBe(1.0);
  });

  it("ramps down from 1 to 0 over taperEnd", () => {
    expect(taperScale(50, 100, 0, 20)).toBe(1.0);
    expect(taperScale(80, 100, 0, 20)).toBeCloseTo(1.0, 5);
    expect(taperScale(90, 100, 0, 20)).toBeCloseTo(0.5, 5);
    expect(taperScale(100, 100, 0, 20)).toBe(0);
  });

  it("both tapers active simultaneously", () => {
    // At the start
    expect(taperScale(0, 100, 30, 30)).toBe(0);
    // In the taper-start zone
    expect(taperScale(15, 100, 30, 30)).toBeCloseTo(0.5, 5);
    // In the middle (no taper)
    expect(taperScale(50, 100, 30, 30)).toBe(1.0);
    // In the taper-end zone
    expect(taperScale(85, 100, 30, 30)).toBeCloseTo(0.5, 5);
    // At the end
    expect(taperScale(100, 100, 30, 30)).toBe(0);
  });

  it("overlapping tapers use minimum", () => {
    // Path is 20px long with taperStart=20 and taperEnd=20
    // At the midpoint (10), start taper = 0.5, end taper = 0.5 → min = 0.5
    expect(taperScale(10, 20, 20, 20)).toBeCloseTo(0.5, 5);
    // At 5px: start = 0.25, end = 0.75 → min = 0.25
    expect(taperScale(5, 20, 20, 20)).toBeCloseTo(0.25, 5);
  });

  it("never returns negative", () => {
    expect(taperScale(-5, 100, 10, 10)).toBe(0);
  });
});
