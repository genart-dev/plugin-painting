import { describe, it, expect } from "vitest";
import { BRUSH_PRESETS, getBrushPreset } from "../src/brush/presets.js";
import type { BrushDefinition } from "../src/brush/types.js";

const ROUND_PRESET_IDS = [
  "round-hard",
  "round-soft",
  "flat",
  "pencil",
  "ink-pen",
  "marker",
  "watercolor-round",
  "charcoal-stick",
  "splatter",
  "eraser-hard",
  "eraser-soft",
];

const TEXTURE_PRESET_IDS = [
  "texture-chalk",
  "texture-sponge",
  "texture-bristle",
];

const PRESET_IDS = [...ROUND_PRESET_IDS, ...TEXTURE_PRESET_IDS];

describe("BRUSH_PRESETS", () => {
  it("contains exactly 14 presets", () => {
    expect(Object.keys(BRUSH_PRESETS)).toHaveLength(14);
  });

  it("contains all expected preset IDs", () => {
    for (const id of PRESET_IDS) {
      expect(BRUSH_PRESETS[id]).toBeDefined();
    }
  });

  for (const id of PRESET_IDS) {
    describe(`preset: ${id}`, () => {
      const preset = BRUSH_PRESETS[id]!;

      it("has matching id field", () => {
        expect(preset.id).toBe(id);
      });

      it("has a non-empty name", () => {
        expect(preset.name).toBeTruthy();
      });

      it("has a valid tipType", () => {
        expect(["round", "texture"]).toContain(preset.tipType);
      });

      it("has roundness in 0–1 range", () => {
        expect(preset.roundness).toBeGreaterThanOrEqual(0.01);
        expect(preset.roundness).toBeLessThanOrEqual(1.0);
      });

      it("has spacing in 0.01–1.0 range", () => {
        expect(preset.spacing).toBeGreaterThanOrEqual(0.01);
        expect(preset.spacing).toBeLessThanOrEqual(1.0);
      });

      it("has flow in 0–1 range", () => {
        expect(preset.flow).toBeGreaterThanOrEqual(0);
        expect(preset.flow).toBeLessThanOrEqual(1.0);
      });

      it("has a valid renderMode", () => {
        expect(["buildup", "wash"]).toContain(preset.renderMode);
      });

      it("has a valid blendMode string", () => {
        expect(typeof preset.blendMode).toBe("string");
        expect(preset.blendMode.length).toBeGreaterThan(0);
      });

      it("has opacity in 0–1 range", () => {
        expect(preset.opacity).toBeGreaterThanOrEqual(0);
        expect(preset.opacity).toBeLessThanOrEqual(1.0);
      });

      it("has a dynamics object", () => {
        expect(typeof preset.dynamics).toBe("object");
      });
    });
  }
});

describe("getBrushPreset", () => {
  it("returns a preset for a valid ID", () => {
    const preset = getBrushPreset("ink-pen");
    expect(preset).toBeDefined();
    expect(preset!.id).toBe("ink-pen");
    expect(preset!.renderMode).toBe("wash");
  });

  it("returns undefined for an unknown ID", () => {
    expect(getBrushPreset("nonexistent")).toBeUndefined();
  });

  it("returns the same object as BRUSH_PRESETS", () => {
    expect(getBrushPreset("round-hard")).toBe(BRUSH_PRESETS["round-hard"]);
  });
});

describe("eraser presets", () => {
  it("eraser-hard uses destination-out", () => {
    expect(BRUSH_PRESETS["eraser-hard"]!.blendMode).toBe("destination-out");
  });

  it("eraser-soft uses destination-out", () => {
    expect(BRUSH_PRESETS["eraser-soft"]!.blendMode).toBe("destination-out");
  });
});

describe("preset-specific properties", () => {
  it("ink-pen has high smoothing", () => {
    expect(BRUSH_PRESETS["ink-pen"]!.smoothing).toBeGreaterThanOrEqual(0.7);
  });

  it("splatter has high scatter", () => {
    expect(BRUSH_PRESETS["splatter"]!.scatter).toBeGreaterThan(1.0);
  });

  it("flat has low roundness", () => {
    expect(BRUSH_PRESETS["flat"]!.roundness).toBeLessThan(0.5);
  });

  it("pencil has taper", () => {
    expect(BRUSH_PRESETS["pencil"]!.taperStart).toBeGreaterThan(0);
    expect(BRUSH_PRESETS["pencil"]!.taperEnd).toBeGreaterThan(0);
  });
});

describe("texture presets", () => {
  for (const id of TEXTURE_PRESET_IDS) {
    describe(`texture preset: ${id}`, () => {
      const preset = BRUSH_PRESETS[id]!;

      it("has tipType 'texture'", () => {
        expect(preset.tipType).toBe("texture");
      });

      it("has a non-empty tipTexture string", () => {
        expect(typeof preset.tipTexture).toBe("string");
        expect(preset.tipTexture!.length).toBeGreaterThan(100);
      });

      it("tipTexture looks like a base64 PNG", () => {
        // Should start with PNG signature in base64
        expect(preset.tipTexture).toMatch(/^iVBOR/);
      });
    });
  }

  it("round presets do not have tipTexture", () => {
    for (const id of ROUND_PRESET_IDS) {
      expect(BRUSH_PRESETS[id]!.tipTexture).toBeUndefined();
    }
  });
});
