import { describe, it, expect } from "vitest";
import { evaluateDynamic } from "../src/brush/dynamics.js";

describe("evaluateDynamic", () => {
  const baseValue = 20;

  it("returns baseValue when dynamic is undefined", () => {
    expect(evaluateDynamic(0.5, undefined, baseValue)).toBe(20);
    expect(evaluateDynamic(0, undefined, baseValue)).toBe(20);
    expect(evaluateDynamic(1, undefined, baseValue)).toBe(20);
  });

  it("returns baseValue when dynamic is false", () => {
    expect(evaluateDynamic(0.5, false, baseValue)).toBe(20);
  });

  describe("linear mode (dynamic = true)", () => {
    it("returns baseValue * pressure", () => {
      expect(evaluateDynamic(1.0, true, baseValue)).toBe(20);
      expect(evaluateDynamic(0.5, true, baseValue)).toBe(10);
      expect(evaluateDynamic(0.0, true, baseValue)).toBe(0);
    });

    it("works with different base values", () => {
      expect(evaluateDynamic(0.5, true, 100)).toBe(50);
      expect(evaluateDynamic(0.25, true, 40)).toBe(10);
    });
  });

  describe("range mode (dynamic = [min, max])", () => {
    it("maps pressure 0 to baseValue * min", () => {
      expect(evaluateDynamic(0, [0.2, 1.0], baseValue)).toBeCloseTo(4, 5);
    });

    it("maps pressure 1 to baseValue * max", () => {
      expect(evaluateDynamic(1, [0.2, 1.0], baseValue)).toBeCloseTo(20, 5);
    });

    it("maps pressure 0.5 to midpoint", () => {
      expect(evaluateDynamic(0.5, [0.2, 1.0], baseValue)).toBeCloseTo(12, 5);
    });

    it("works with inverted range [1, 0]", () => {
      // pressure 0 → baseValue * 1 = 20
      expect(evaluateDynamic(0, [1, 0], baseValue)).toBeCloseTo(20, 5);
      // pressure 1 → baseValue * 0 = 0
      expect(evaluateDynamic(1, [1, 0], baseValue)).toBeCloseTo(0, 5);
    });

    it("supports ranges exceeding 1", () => {
      // [0.5, 1.5] at pressure 1 → baseValue * 1.5 = 30
      expect(evaluateDynamic(1, [0.5, 1.5], baseValue)).toBeCloseTo(30, 5);
    });
  });
});
