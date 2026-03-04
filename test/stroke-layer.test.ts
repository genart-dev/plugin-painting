import { describe, it, expect } from "vitest";
import { strokeLayerType } from "../src/stroke-layer.js";

describe("strokeLayerType", () => {
  it("has the correct typeId", () => {
    expect(strokeLayerType.typeId).toBe("painting:stroke");
  });

  it("has the correct displayName", () => {
    expect(strokeLayerType.displayName).toBe("Brush Stroke");
  });

  it("has category 'draw'", () => {
    expect(strokeLayerType.category).toBe("draw");
  });

  describe("createDefault", () => {
    it("returns default properties for all schema keys", () => {
      const defaults = strokeLayerType.createDefault();
      expect(defaults.brushes).toBe("[]");
      expect(defaults.strokes).toBe("[]");
      expect(defaults.field).toBe("");
      expect(defaults.fieldCols).toBe(20);
      expect(defaults.fieldRows).toBe(20);
      expect(defaults.seed).toBe(0);
      expect(defaults.opacity).toBe(1);
      expect(defaults.debug).toBe(false);
      expect(defaults.debugOpacity).toBe(0.7);
      expect(defaults.debugMode).toBe("all");
    });

    it("returns a new object each time", () => {
      const a = strokeLayerType.createDefault();
      const b = strokeLayerType.createDefault();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("validate", () => {
    it("returns null for valid default properties", () => {
      const defaults = strokeLayerType.createDefault();
      expect(strokeLayerType.validate!(defaults)).toBeNull();
    });

    it("returns null for valid JSON brushes and strokes", () => {
      const props = {
        ...strokeLayerType.createDefault(),
        brushes: JSON.stringify([{ id: "test", name: "Test" }]),
        strokes: JSON.stringify([{ brushId: "round-hard", color: "#000", points: [] }]),
      };
      expect(strokeLayerType.validate!(props)).toBeNull();
    });

    it("returns error for invalid brushes JSON", () => {
      const props = {
        ...strokeLayerType.createDefault(),
        brushes: "not valid json{",
      };
      const errors = strokeLayerType.validate!(props);
      expect(errors).not.toBeNull();
      expect(errors).toHaveLength(1);
      expect(errors![0]!.property).toBe("brushes");
      expect(errors![0]!.message).toContain("valid JSON");
    });

    it("returns error for invalid strokes JSON", () => {
      const props = {
        ...strokeLayerType.createDefault(),
        strokes: "{not an array}",
      };
      const errors = strokeLayerType.validate!(props);
      expect(errors).not.toBeNull();
      expect(errors).toHaveLength(1);
      expect(errors![0]!.property).toBe("strokes");
    });

    it("returns error when brushes is not an array", () => {
      const props = {
        ...strokeLayerType.createDefault(),
        brushes: '{"id": "test"}',
      };
      const errors = strokeLayerType.validate!(props);
      expect(errors).not.toBeNull();
      expect(errors![0]!.property).toBe("brushes");
      expect(errors![0]!.message).toContain("JSON array");
    });

    it("returns error when strokes is not an array", () => {
      const props = {
        ...strokeLayerType.createDefault(),
        strokes: '"just a string"',
      };
      const errors = strokeLayerType.validate!(props);
      expect(errors).not.toBeNull();
      expect(errors![0]!.property).toBe("strokes");
      expect(errors![0]!.message).toContain("JSON array");
    });

    it("returns multiple errors when both are invalid", () => {
      const props = {
        ...strokeLayerType.createDefault(),
        brushes: "bad",
        strokes: "also bad",
      };
      const errors = strokeLayerType.validate!(props);
      expect(errors).not.toBeNull();
      expect(errors).toHaveLength(2);
    });
  });

  describe("properties schema", () => {
    it("has all expected property keys", () => {
      const keys = strokeLayerType.properties.map((p) => p.key);
      expect(keys).toContain("brushes");
      expect(keys).toContain("strokes");
      expect(keys).toContain("field");
      expect(keys).toContain("fieldCols");
      expect(keys).toContain("fieldRows");
      expect(keys).toContain("seed");
      expect(keys).toContain("opacity");
      expect(keys).toContain("debug");
      expect(keys).toContain("debugOpacity");
      expect(keys).toContain("debugMode");
    });

    it("field default is empty string (optional)", () => {
      const fieldProp = strokeLayerType.properties.find((p) => p.key === "field");
      expect(fieldProp).toBeDefined();
      expect(fieldProp!.default).toBe("");
    });
  });
});
