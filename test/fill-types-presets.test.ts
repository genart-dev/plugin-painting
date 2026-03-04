import { describe, it, expect } from "vitest";
import { FILL_PRESETS, getFillPreset, resolveStrategy } from "../src/fill/presets.js";
import type { FillStrategy } from "../src/fill/types.js";

describe("FILL_PRESETS", () => {
  it("has exactly 9 presets", () => {
    expect(Object.keys(FILL_PRESETS)).toHaveLength(9);
  });

  it("contains all documented preset names", () => {
    const expected = [
      "hatch-light", "hatch-medium", "hatch-dense",
      "crosshatch-light", "crosshatch-dense",
      "stipple-light", "stipple-dense",
      "scumble", "contour",
    ];
    for (const name of expected) {
      expect(FILL_PRESETS[name]).toBeDefined();
    }
  });

  describe("hatch presets", () => {
    it("hatch-light has correct parameters", () => {
      const p = FILL_PRESETS["hatch-light"]!;
      expect(p.strategy.type).toBe("hatch");
      if (p.strategy.type === "hatch") {
        expect(p.strategy.angle).toBe(45);
        expect(p.strategy.spacing).toBe(12);
      }
      expect(p.brushId).toBe("ink-pen");
      expect(p.size).toBe(2);
    });

    it("hatch-medium has tighter spacing than hatch-light", () => {
      const light = FILL_PRESETS["hatch-light"]!.strategy as { spacing: number };
      const medium = FILL_PRESETS["hatch-medium"]!.strategy as { spacing: number };
      expect(medium.spacing).toBeLessThan(light.spacing);
    });

    it("hatch-dense has tightest spacing", () => {
      const medium = FILL_PRESETS["hatch-medium"]!.strategy as { spacing: number };
      const dense = FILL_PRESETS["hatch-dense"]!.strategy as { spacing: number };
      expect(dense.spacing).toBeLessThan(medium.spacing);
    });
  });

  describe("crosshatch presets", () => {
    it("crosshatch-light has two angles", () => {
      const p = FILL_PRESETS["crosshatch-light"]!;
      expect(p.strategy.type).toBe("crosshatch");
      if (p.strategy.type === "crosshatch") {
        expect(p.strategy.angles).toHaveLength(2);
        expect(p.strategy.passDecay).toBeGreaterThan(0);
        expect(p.strategy.passDecay).toBeLessThanOrEqual(1);
      }
    });

    it("crosshatch-dense has tighter spacing than crosshatch-light", () => {
      const light = FILL_PRESETS["crosshatch-light"]!.strategy as { spacing: number };
      const dense = FILL_PRESETS["crosshatch-dense"]!.strategy as { spacing: number };
      expect(dense.spacing).toBeLessThan(light.spacing);
    });
  });

  describe("stipple presets", () => {
    it("stipple-light has lower density than stipple-dense", () => {
      const light = FILL_PRESETS["stipple-light"]!.strategy as { density: number };
      const dense = FILL_PRESETS["stipple-dense"]!.strategy as { density: number };
      expect(light.density).toBeLessThan(dense.density);
    });

    it("stipple-light uses poisson distribution", () => {
      const p = FILL_PRESETS["stipple-light"]!;
      if (p.strategy.type === "stipple") {
        expect(p.strategy.distribution).toBe("poisson");
      }
    });
  });

  describe("scumble preset", () => {
    it("scumble has positive density, strokeLength, and curvature", () => {
      const p = FILL_PRESETS["scumble"]!;
      expect(p.strategy.type).toBe("scumble");
      if (p.strategy.type === "scumble") {
        expect(p.strategy.density).toBeGreaterThan(0);
        expect(p.strategy.strokeLength).toBeGreaterThan(0);
        expect(p.strategy.curvature).toBeGreaterThanOrEqual(0);
        expect(p.strategy.curvature).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("contour preset", () => {
    it("contour has positive spacing and smoothing in [0,1]", () => {
      const p = FILL_PRESETS["contour"]!;
      expect(p.strategy.type).toBe("contour");
      if (p.strategy.type === "contour") {
        expect(p.strategy.spacing).toBeGreaterThan(0);
        expect(p.strategy.smoothing).toBeGreaterThanOrEqual(0);
        expect(p.strategy.smoothing).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe("getFillPreset", () => {
  it("returns preset for known names", () => {
    expect(getFillPreset("hatch-medium")).toBeDefined();
    expect(getFillPreset("contour")).toBeDefined();
  });

  it("returns undefined for unknown names", () => {
    expect(getFillPreset("nonexistent")).toBeUndefined();
    expect(getFillPreset("")).toBeUndefined();
  });
});

describe("resolveStrategy", () => {
  it("resolves a preset string to its strategy", () => {
    const result = resolveStrategy("hatch-medium");
    expect(result).not.toBeNull();
    expect(result!.strategy.type).toBe("hatch");
    expect(result!.brushId).toBe("ink-pen");
    expect(result!.size).toBe(3);
  });

  it("returns null for unknown preset name", () => {
    expect(resolveStrategy("not-a-preset")).toBeNull();
  });

  it("passes through a FillStrategy object unchanged", () => {
    const strategy: FillStrategy = { type: "stipple", density: 50, distribution: "random" };
    const result = resolveStrategy(strategy);
    expect(result).not.toBeNull();
    expect(result!.strategy).toEqual(strategy);
    expect(result!.brushId).toBeUndefined();
  });

  it("returns no brushId or size when resolving a raw strategy object", () => {
    const strategy: FillStrategy = { type: "contour", spacing: 10, smoothing: 0.2 };
    const result = resolveStrategy(strategy);
    expect(result!.brushId).toBeUndefined();
    expect(result!.size).toBeUndefined();
  });
});
