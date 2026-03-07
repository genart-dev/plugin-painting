import { describe, it, expect, afterEach } from "vitest";
import {
  convertAlgorithmData,
  parseField,
  sampleField,
} from "../src/vector-field.js";

/** Assert a VectorSample has approximately the expected values. */
function expectSample(
  actual: { dx: number; dy: number; magnitude: number },
  dx: number, dy: number, magnitude: number,
) {
  expect(actual.dx).toBeCloseTo(dx, 4);
  expect(actual.dy).toBeCloseTo(dy, 4);
  expect(actual.magnitude).toBeCloseTo(magnitude, 4);
}

// ---------------------------------------------------------------------------
// convertAlgorithmData
// ---------------------------------------------------------------------------

describe("convertAlgorithmData", () => {
  it("converts vector Float32Array (dx, dy, magnitude triples)", () => {
    // 2x2 grid = 4 cells, 12 floats
    const data = new Float32Array([
      1, 0, 0.5, // cell (0,0): right, mag 0.5
      0, 1, 0.8, // cell (1,0): down, mag 0.8
      -1, 0, 0.3, // cell (0,1): left, mag 0.3
      0, -1, 1.0, // cell (1,1): up, mag 1.0
    ]);
    const field = convertAlgorithmData(data, 2, 2);

    expect(field.cols).toBe(2);
    expect(field.rows).toBe(2);
    expect(field.samples).toHaveLength(4);

    expectSample(field.samples[0]!, 1, 0, 0.5);
    expectSample(field.samples[1]!, 0, 1, 0.8);
    expectSample(field.samples[2]!, -1, 0, 0.3);
    expectSample(field.samples[3]!, 0, -1, 1.0);
  });

  it("converts scalar Float32Array (single values → magnitude, dx=dy=0)", () => {
    // 2x2 grid = 4 cells, 4 floats
    const data = new Float32Array([0.1, 0.5, 0.9, 0.0]);
    const field = convertAlgorithmData(data, 2, 2);

    expect(field.cols).toBe(2);
    expect(field.rows).toBe(2);
    expect(field.samples).toHaveLength(4);

    expectSample(field.samples[0]!, 0, 0, 0.1);
    expectSample(field.samples[1]!, 0, 0, 0.5);
    expectSample(field.samples[2]!, 0, 0, 0.9);
    expectSample(field.samples[3]!, 0, 0, 0.0);
  });

  it("handles 1x1 grid (single cell)", () => {
    const vector = new Float32Array([0.7, -0.3, 0.6]);
    const field = convertAlgorithmData(vector, 1, 1);
    expect(field.samples).toHaveLength(1);
    expectSample(field.samples[0]!, 0.7, -0.3, 0.6);

    const scalar = new Float32Array([0.42]);
    const field2 = convertAlgorithmData(scalar, 1, 1);
    expectSample(field2.samples[0]!, 0, 0, 0.42);
  });
});

// ---------------------------------------------------------------------------
// parseField("algorithm:*")
// ---------------------------------------------------------------------------

describe("parseField with algorithm: prefix", () => {
  const savedData = (globalThis as any).__genart_data;

  afterEach(() => {
    // Restore original state
    if (savedData === undefined) {
      delete (globalThis as any).__genart_data;
    } else {
      (globalThis as any).__genart_data = savedData;
    }
  });

  it("returns zero field when __genart_data is missing", () => {
    delete (globalThis as any).__genart_data;
    const field = parseField("algorithm:flowField", 3, 3);
    expect(field.cols).toBe(3);
    expect(field.rows).toBe(3);
    expect(field.samples).toHaveLength(9);
    // All zeros
    for (const s of field.samples) {
      expect(s.dx).toBe(0);
      expect(s.dy).toBe(0);
      expect(s.magnitude).toBe(0);
    }
  });

  it("returns zero field when channel is not in __genart_data", () => {
    (globalThis as any).__genart_data = {};
    const field = parseField("algorithm:nonExistent", 4, 4);
    expect(field.cols).toBe(4);
    expect(field.rows).toBe(4);
    for (const s of field.samples) {
      expect(s.magnitude).toBe(0);
    }
  });

  it("converts vector data from __genart_data", () => {
    const vectorData = new Float32Array([
      0.5, 0.5, 0.7,
      -0.5, -0.5, 0.3,
      0, 1, 1.0,
      1, 0, 0.0,
    ]);
    (globalThis as any).__genart_data = {
      flowField: vectorData,
      cols: 2,
      rows: 2,
    };

    const field = parseField("algorithm:flowField", 10, 10);
    // Should use cols/rows from __genart_data (2,2), not the fallback (10,10)
    expect(field.cols).toBe(2);
    expect(field.rows).toBe(2);
    expectSample(field.samples[0]!, 0.5, 0.5, 0.7);
  });

  it("converts scalar data from __genart_data (valueMap)", () => {
    const scalarData = new Float32Array([0.2, 0.4, 0.6, 0.8]);
    (globalThis as any).__genart_data = {
      valueMap: scalarData,
      cols: 2,
      rows: 2,
    };

    const field = parseField("algorithm:valueMap", 10, 10);
    expect(field.cols).toBe(2);
    expect(field.rows).toBe(2);
    expectSample(field.samples[0]!, 0, 0, 0.2);
    expectSample(field.samples[3]!, 0, 0, 0.8);
  });

  it("uses fallback cols/rows when __genart_data has no cols/rows", () => {
    const scalarData = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    (globalThis as any).__genart_data = {
      myChannel: scalarData,
      // No cols/rows — should fall back to parseField's arguments
    };

    const field = parseField("algorithm:myChannel", 3, 2);
    expect(field.cols).toBe(3);
    expect(field.rows).toBe(2);
    expect(field.samples).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// sampleField on algorithm-converted field
// ---------------------------------------------------------------------------

describe("sampleField on converted algorithm field", () => {
  it("interpolates vector field at center", () => {
    // 2x2 uniform field pointing right
    const data = new Float32Array([
      1, 0, 0.5,
      1, 0, 0.5,
      1, 0, 0.5,
      1, 0, 0.5,
    ]);
    const field = convertAlgorithmData(data, 2, 2);
    const s = sampleField(field, 0.5, 0.5);
    expect(s.dx).toBeCloseTo(1);
    expect(s.dy).toBeCloseTo(0);
    expect(s.magnitude).toBeCloseTo(0.5);
  });

  it("interpolates between differing cells", () => {
    // 2x2: top-left mag=0, top-right mag=1, bottom-left mag=0, bottom-right mag=1
    const data = new Float32Array([0.0, 1.0, 0.0, 1.0]);
    const field = convertAlgorithmData(data, 2, 2);
    // Sample at center — bilinear average of [0, 1, 0, 1] = 0.5
    const s = sampleField(field, 0.5, 0.5);
    expect(s.magnitude).toBeCloseTo(0.5);
    // Sample at left edge center — average of [0, 0] = 0
    const sLeft = sampleField(field, 0.0, 0.5);
    expect(sLeft.magnitude).toBeCloseTo(0.0);
    // Sample at right edge center — average of [1, 1] = 1
    const sRight = sampleField(field, 1.0, 0.5);
    expect(sRight.magnitude).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// Regression: existing presets still work
// ---------------------------------------------------------------------------

describe("parseField regression for existing presets", () => {
  it("parses noise: shorthand", () => {
    const field = parseField("noise:42:0.1:3", 10, 10);
    expect(field.cols).toBe(10);
    expect(field.rows).toBe(10);
    expect(field.samples).toHaveLength(100);
    // Noise field should have varied magnitudes
    const mags = field.samples.map((s) => s.magnitude);
    const unique = new Set(mags.map((m) => m.toFixed(3)));
    expect(unique.size).toBeGreaterThan(1);
  });

  it("parses linear: shorthand", () => {
    const field = parseField("linear:45:0.8", 5, 5);
    expect(field.cols).toBe(5);
    expect(field.rows).toBe(5);
    // All samples should have uniform magnitude 0.8
    for (const s of field.samples) {
      expect(s.magnitude).toBeCloseTo(0.8);
    }
  });

  it("parses radial: shorthand", () => {
    const field = parseField("radial:0.5:0.5:diverge", 8, 8);
    expect(field.cols).toBe(8);
    expect(field.rows).toBe(8);
    expect(field.samples).toHaveLength(64);
  });

  it("parses vortex: shorthand", () => {
    const field = parseField("vortex:0.5:0.5:0.3", 8, 8);
    expect(field.cols).toBe(8);
    expect(field.samples).toHaveLength(64);
  });

  it("falls back to noise for unknown type", () => {
    const field = parseField("unknown:stuff", 5, 5);
    expect(field.cols).toBe(5);
    expect(field.rows).toBe(5);
    expect(field.samples).toHaveLength(25);
  });
});
