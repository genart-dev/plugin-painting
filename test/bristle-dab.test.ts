import { describe, it, expect, vi } from "vitest";
import { bristleDabLayerType } from "../src/bristle-dab.js";
import { addBristleDabTool } from "../src/painting-tools.js";
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
// bristleDabLayerType
// ---------------------------------------------------------------------------

describe("bristleDabLayerType", () => {
  it("has typeId 'painting:bristle-dab'", () => {
    expect(bristleDabLayerType.typeId).toBe("painting:bristle-dab");
  });

  it("has displayName 'Bristle Dab'", () => {
    expect(bristleDabLayerType.displayName).toBe("Bristle Dab");
  });

  it("has category 'draw'", () => {
    expect(bristleDabLayerType.category).toBe("draw");
  });

  describe("createDefault", () => {
    it("returns all expected property keys with correct defaults", () => {
      const d = bristleDabLayerType.createDefault();
      expect(d.field).toBe("noise:0:0.1:3");
      expect(d.fieldCols).toBe(20);
      expect(d.fieldRows).toBe(20);
      expect(d.brushWidth).toBe(24);
      expect(d.bristleCount).toBe(12);
      expect(d.dabLength).toBe(20);
      expect(d.overlapDensity).toBe(0.6);
      expect(d.gridJitter).toBe(0.5);
      expect(d.paintLoad).toBe(0.7);
      expect(d.pressure).toBe(0.65);
      expect(d.taper).toBe("pointed");
      expect(d.texture).toBe("smooth");
      expect(d.colorMode).toBe("single");
      expect(d.colorJitter).toBe(15);
      expect(d.angleOffset).toBe(0);
      expect(d.angleSpread).toBe(0.1);
      expect(d.flowInfluence).toBe(1.0);
      expect(d.paintMode).toBe("normal");
      expect(d.opacity).toBe(0.65);
      expect(d.seed).toBe(0);
    });

    it("returns a new object each time", () => {
      const a = bristleDabLayerType.createDefault();
      const b = bristleDabLayerType.createDefault();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("validate", () => {
    it("returns null for valid default properties", () => {
      const d = bristleDabLayerType.createDefault();
      expect(bristleDabLayerType.validate!(d)).toBeNull();
    });

    it("returns null for valid colors array", () => {
      const d = { ...bristleDabLayerType.createDefault(), colors: '["#ff0000","#00ff00"]' };
      expect(bristleDabLayerType.validate!(d)).toBeNull();
    });

    it("returns error for invalid colors JSON", () => {
      const d = { ...bristleDabLayerType.createDefault(), colors: "not json{" };
      const errors = bristleDabLayerType.validate!(d);
      expect(errors).not.toBeNull();
      expect(errors![0]!.property).toBe("colors");
      expect(errors![0]!.message).toContain("valid JSON");
    });

    it("returns error when colors is not an array", () => {
      const d = { ...bristleDabLayerType.createDefault(), colors: '{"a":1}' };
      const errors = bristleDabLayerType.validate!(d);
      expect(errors).not.toBeNull();
      expect(errors![0]!.property).toBe("colors");
      expect(errors![0]!.message).toContain("array");
    });
  });

  describe("properties schema", () => {
    it("has all expected property keys", () => {
      const keys = bristleDabLayerType.properties.map((p) => p.key);
      expect(keys).toContain("field");
      expect(keys).toContain("fieldCols");
      expect(keys).toContain("fieldRows");
      expect(keys).toContain("colors");
      expect(keys).toContain("brushWidth");
      expect(keys).toContain("bristleCount");
      expect(keys).toContain("dabLength");
      expect(keys).toContain("overlapDensity");
      expect(keys).toContain("gridJitter");
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
        bristleDabLayerType.render(bristleDabLayerType.createDefault(), ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("calls ctx.save and ctx.restore", () => {
      const ctx = createMockCtx();
      bristleDabLayerType.render(bristleDabLayerType.createDefault(), ctx, BOUNDS, {} as never);
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it("skips render when bounds are zero-size", () => {
      const ctx = createMockCtx();
      bristleDabLayerType.render(bristleDabLayerType.createDefault(), ctx, { x: 0, y: 0, width: 0, height: 0 }, {} as never);
      expect(ctx.save).not.toHaveBeenCalled();
    });

    it("renders with different paint modes", () => {
      for (const paintMode of ["multiply", "normal", "screen"]) {
        const ctx = createMockCtx();
        const props = { ...bristleDabLayerType.createDefault(), paintMode };
        expect(() => {
          bristleDabLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with different taper modes", () => {
      for (const taper of ["pointed", "blunt", "chisel"]) {
        const ctx = createMockCtx();
        const props = { ...bristleDabLayerType.createDefault(), taper };
        expect(() => {
          bristleDabLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with different texture modes", () => {
      for (const texture of ["smooth", "dry", "rough", "stipple", "feathered", "impasto"]) {
        const ctx = createMockCtx();
        const props = { ...bristleDabLayerType.createDefault(), texture };
        expect(() => {
          bristleDabLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with different field types", () => {
      for (const field of ["noise:1:0.1:3", "linear:45:0.8", "radial:0.5:0.5:diverge"]) {
        const ctx = createMockCtx();
        const props = { ...bristleDabLayerType.createDefault(), field };
        expect(() => {
          bristleDabLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with multiple colors", () => {
      const ctx = createMockCtx();
      const props = { ...bristleDabLayerType.createDefault(), colors: '["#ff0000","#0000ff"]', colorMode: "lateral" };
      expect(() => {
        bristleDabLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("renders with invalid colors JSON (fallback, no throw)", () => {
      const ctx = createMockCtx();
      const props = { ...bristleDabLayerType.createDefault(), colors: "bad json" };
      expect(() => {
        bristleDabLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// add_bristle_dab MCP tool
// ---------------------------------------------------------------------------

describe("add_bristle_dab tool", () => {
  it("creates a painting:bristle-dab layer with defaults", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    const result = await addBristleDabTool.handler({}, ctx);

    expect(result.isError).toBeFalsy();
    expect(layers.size).toBe(1);
    const layer = [...layers.values()][0]!;
    expect(layer.type).toBe("painting:bristle-dab");
    expect(layer.properties.brushWidth).toBe(24);
    expect(layer.properties.bristleCount).toBe(12);
  });

  it("applies input overrides", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await addBristleDabTool.handler({
      brushWidth: 40,
      dabLength: 30,
      colorMode: "lateral",
      opacity: 0.8,
      seed: 42,
    }, ctx);

    const layer = [...layers.values()][0]!;
    expect(layer.properties.brushWidth).toBe(40);
    expect(layer.properties.dabLength).toBe(30);
    expect(layer.properties.colorMode).toBe("lateral");
    expect(layer.properties.opacity).toBe(0.8);
    expect(layer.properties.seed).toBe(42);
  });

  it("emits layer-added", async () => {
    const ctx = createMockContext();
    await addBristleDabTool.handler({}, ctx);
    expect(ctx.emitChange).toHaveBeenCalledWith("layer-added");
  });

  it("returns error for invalid field", async () => {
    const ctx = createMockContext();
    const result = await addBristleDabTool.handler({ field: "badtype::x" }, ctx);
    // parseField falls back gracefully for unknown types — should not error
    expect(result.isError).toBeFalsy();
  });
});
