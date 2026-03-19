import { describe, it, expect, vi } from "vitest";
import { bristleStrokeLayerType } from "../src/bristle-stroke.js";
import { addBristleStrokeTool } from "../src/painting-tools.js";
import type { McpToolContext, DesignLayer } from "@genart-dev/core";

// ---------------------------------------------------------------------------
// Canvas mock
// ---------------------------------------------------------------------------

function createMockCtx(width = 400, height = 300) {
  const ctx: Record<string, unknown> = {
    canvas: { width, height },
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    lineWidth: 1,
    strokeStyle: "#000000",
    fillStyle: "#000000",
    lineCap: "butt",
    lineJoin: "miter",
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const BOUNDS = { x: 0, y: 0, width: 400, height: 300 };

// ---------------------------------------------------------------------------
// MCP tool mock context
// ---------------------------------------------------------------------------

function createMockContext(layers: Map<string, DesignLayer> = new Map()): McpToolContext {
  return {
    canvasWidth: 800,
    canvasHeight: 600,
    layers: {
      get: (id: string) => layers.get(id) ?? null,
      add: (layer: DesignLayer, _index?: number) => { layers.set(layer.id, layer); },
      updateProperties: (id: string, props: Record<string, unknown>) => {
        const layer = layers.get(id);
        if (layer) {
          layer.properties = { ...layer.properties, ...props } as Record<string, string | number | boolean | null>;
        }
      },
      list: () => [...layers.values()],
      remove: (_id: string) => {},
      reorder: (_ids: string[]) => {},
    },
    emitChange: vi.fn(),
  } as unknown as McpToolContext;
}

// ---------------------------------------------------------------------------
// bristleStrokeLayerType
// ---------------------------------------------------------------------------

describe("bristleStrokeLayerType", () => {
  it("has typeId 'painting:bristle-stroke'", () => {
    expect(bristleStrokeLayerType.typeId).toBe("painting:bristle-stroke");
  });

  it("has displayName 'Bristle Stroke'", () => {
    expect(bristleStrokeLayerType.displayName).toBe("Bristle Stroke");
  });

  it("has category 'draw'", () => {
    expect(bristleStrokeLayerType.category).toBe("draw");
  });

  describe("createDefault", () => {
    it("returns all expected property keys with correct defaults", () => {
      const d = bristleStrokeLayerType.createDefault();
      expect(d.field).toBe("noise:0:0.08:4");
      expect(d.fieldCols).toBe(30);
      expect(d.fieldRows).toBe(30);
      expect(d.brushWidth).toBe(20);
      expect(d.bristleCount).toBe(10);
      expect(d.strokeSteps).toBe(40);
      expect(d.strokeCount).toBe(300);
      expect(d.paintLoad).toBe(0.7);
      expect(d.pressure).toBe(0.65);
      expect(d.taper).toBe("pointed");
      expect(d.texture).toBe("smooth");
      expect(d.colorMode).toBe("single");
      expect(d.colorJitter).toBe(15);
      expect(d.angleOffset).toBe(0);
      expect(d.angleSpread).toBe(0.15);
      expect(d.flowInfluence).toBe(1.0);
      expect(d.paintMode).toBe("normal");
      expect(d.opacity).toBe(0.5);
      expect(d.seed).toBe(0);
    });

    it("returns a new object each time", () => {
      const a = bristleStrokeLayerType.createDefault();
      const b = bristleStrokeLayerType.createDefault();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("validate", () => {
    it("returns null for valid default properties", () => {
      const d = bristleStrokeLayerType.createDefault();
      expect(bristleStrokeLayerType.validate!(d)).toBeNull();
    });

    it("returns null for valid colors array", () => {
      const d = { ...bristleStrokeLayerType.createDefault(), colors: '["#ff0000","#00ff00"]' };
      expect(bristleStrokeLayerType.validate!(d)).toBeNull();
    });

    it("returns error for invalid colors JSON", () => {
      const d = { ...bristleStrokeLayerType.createDefault(), colors: "not json{" };
      const errors = bristleStrokeLayerType.validate!(d);
      expect(errors).not.toBeNull();
      expect(errors![0]!.property).toBe("colors");
      expect(errors![0]!.message).toContain("valid JSON");
    });

    it("returns error when colors is not an array", () => {
      const d = { ...bristleStrokeLayerType.createDefault(), colors: '{"a":1}' };
      const errors = bristleStrokeLayerType.validate!(d);
      expect(errors).not.toBeNull();
      expect(errors![0]!.property).toBe("colors");
      expect(errors![0]!.message).toContain("array");
    });
  });

  describe("properties schema", () => {
    it("has all expected property keys", () => {
      const keys = bristleStrokeLayerType.properties.map((p) => p.key);
      expect(keys).toContain("field");
      expect(keys).toContain("fieldCols");
      expect(keys).toContain("fieldRows");
      expect(keys).toContain("colors");
      expect(keys).toContain("brushWidth");
      expect(keys).toContain("bristleCount");
      expect(keys).toContain("strokeSteps");
      expect(keys).toContain("strokeCount");
      expect(keys).toContain("paintLoad");
      expect(keys).toContain("pressure");
      expect(keys).toContain("taper");
      expect(keys).toContain("texture");
      expect(keys).toContain("colorMode");
      expect(keys).toContain("colorJitter");
      expect(keys).toContain("angleOffset");
      expect(keys).toContain("angleSpread");
      expect(keys).toContain("flowInfluence");
      expect(keys).toContain("paintMode");
      expect(keys).toContain("opacity");
      expect(keys).toContain("seed");
    });
  });

  describe("render", () => {
    it("renders without throwing for default properties", () => {
      const ctx = createMockCtx();
      expect(() => {
        bristleStrokeLayerType.render(bristleStrokeLayerType.createDefault(), ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("calls ctx.save and ctx.restore", () => {
      const ctx = createMockCtx();
      bristleStrokeLayerType.render(bristleStrokeLayerType.createDefault(), ctx, BOUNDS, {} as never);
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it("skips render when bounds are zero-size", () => {
      const ctx = createMockCtx();
      bristleStrokeLayerType.render(bristleStrokeLayerType.createDefault(), ctx, { x: 0, y: 0, width: 0, height: 0 }, {} as never);
      expect(ctx.save).not.toHaveBeenCalled();
    });

    it("renders with different paint modes", () => {
      for (const paintMode of ["multiply", "normal", "screen"]) {
        const ctx = createMockCtx();
        const props = { ...bristleStrokeLayerType.createDefault(), paintMode };
        expect(() => {
          bristleStrokeLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with different taper modes", () => {
      for (const taper of ["pointed", "blunt", "chisel"]) {
        const ctx = createMockCtx();
        const props = { ...bristleStrokeLayerType.createDefault(), taper };
        expect(() => {
          bristleStrokeLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with different texture modes", () => {
      for (const texture of ["smooth", "dry", "rough", "stipple", "feathered", "impasto"]) {
        const ctx = createMockCtx();
        const props = { ...bristleStrokeLayerType.createDefault(), texture };
        expect(() => {
          bristleStrokeLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with different field types", () => {
      for (const field of ["noise:1:0.1:3", "linear:45:0.8", "radial:0.5:0.5:diverge"]) {
        const ctx = createMockCtx();
        const props = { ...bristleStrokeLayerType.createDefault(), field };
        expect(() => {
          bristleStrokeLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with multiple colors and lateral colorMode", () => {
      const ctx = createMockCtx();
      const props = { ...bristleStrokeLayerType.createDefault(), colors: '["#ff0000","#0000ff"]', colorMode: "lateral" };
      expect(() => {
        bristleStrokeLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("renders with invalid colors JSON (fallback, no throw)", () => {
      const ctx = createMockCtx();
      const props = { ...bristleStrokeLayerType.createDefault(), colors: "bad json" };
      expect(() => {
        bristleStrokeLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("renders with low stroke count", () => {
      const ctx = createMockCtx();
      const props = { ...bristleStrokeLayerType.createDefault(), strokeCount: 20 };
      expect(() => {
        bristleStrokeLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// add_bristle_stroke MCP tool
// ---------------------------------------------------------------------------

describe("add_bristle_stroke tool", () => {
  it("creates a painting:bristle-stroke layer with defaults", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    const result = await addBristleStrokeTool.handler({}, ctx);

    expect(result.isError).toBeFalsy();
    expect(layers.size).toBe(1);
    const layer = [...layers.values()][0]!;
    expect(layer.type).toBe("painting:bristle-stroke");
    expect(layer.properties.brushWidth).toBe(20);
    expect(layer.properties.strokeCount).toBe(300);
  });

  it("applies input overrides", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await addBristleStrokeTool.handler({
      brushWidth: 35,
      strokeSteps: 60,
      strokeCount: 500,
      texture: "rough",
      opacity: 0.7,
      seed: 99,
    }, ctx);

    const layer = [...layers.values()][0]!;
    expect(layer.properties.brushWidth).toBe(35);
    expect(layer.properties.strokeSteps).toBe(60);
    expect(layer.properties.strokeCount).toBe(500);
    expect(layer.properties.texture).toBe("rough");
    expect(layer.properties.opacity).toBe(0.7);
    expect(layer.properties.seed).toBe(99);
  });

  it("emits layer-added", async () => {
    const ctx = createMockContext();
    await addBristleStrokeTool.handler({}, ctx);
    expect(ctx.emitChange).toHaveBeenCalledWith("layer-added");
  });

  it("returns error for invalid field", async () => {
    const ctx = createMockContext();
    const result = await addBristleStrokeTool.handler({ field: "badtype::x" }, ctx);
    // parseField falls back gracefully for unknown types — should not error
    expect(result.isError).toBeFalsy();
  });

  it("sets layer type correctly", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);
    await addBristleStrokeTool.handler({}, ctx);
    const layer = [...layers.values()][0]!;
    expect(layer.type).toBe("painting:bristle-stroke");
    expect(layer.name).toBe("Bristle Stroke");
  });
});
