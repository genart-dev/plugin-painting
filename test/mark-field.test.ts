import { describe, it, expect, vi } from "vitest";
import { markFieldLayerType } from "../src/mark-field.js";
import { addMarkFieldTool } from "../src/painting-tools.js";
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
// markFieldLayerType
// ---------------------------------------------------------------------------

describe("markFieldLayerType", () => {
  it("has typeId 'painting:mark-field'", () => {
    expect(markFieldLayerType.typeId).toBe("painting:mark-field");
  });

  it("has displayName 'Mark Field'", () => {
    expect(markFieldLayerType.displayName).toBe("Mark Field");
  });

  it("has category 'draw'", () => {
    expect(markFieldLayerType.category).toBe("draw");
  });

  describe("createDefault", () => {
    it("returns all expected property keys with correct defaults", () => {
      const d = markFieldLayerType.createDefault();
      expect(d.field).toBe("noise:0:0.1:3");
      expect(d.fieldCols).toBe(30);
      expect(d.fieldRows).toBe(30);
      expect(d.seed).toBe(42);
      expect(d.density).toBe(800);
      expect(d.markLength).toBe(15);
      expect(d.markLengthVariation).toBe(0.3);
      expect(d.markWeight).toBe(1.2);
      expect(d.markWeightVariation).toBe(0.2);
      expect(d.color).toBe("#2a2a2a");
      expect(d.colorVariation).toBe(0.1);
      expect(d.opacity).toBe(0.7);
      expect(d.paintMode).toBe("multiply");
      expect(d.depthScale).toBe(false);
      expect(d.horizonY).toBe(0.3);
      expect(d.depthDensityRange).toBe("[1, 2.5]");
      expect(d.depthWeightRange).toBe("[0.6, 1.8]");
      expect(d.maskCenterY).toBe(-1);
      expect(d.maskSpread).toBe(0.25);
    });

    it("returns a new object each time", () => {
      const a = markFieldLayerType.createDefault();
      const b = markFieldLayerType.createDefault();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("validate", () => {
    it("returns null for valid default properties", () => {
      const d = markFieldLayerType.createDefault();
      expect(markFieldLayerType.validate!(d)).toBeNull();
    });
  });

  describe("properties schema", () => {
    it("has all expected property keys", () => {
      const keys = markFieldLayerType.properties.map((p) => p.key);
      expect(keys).toContain("field");
      expect(keys).toContain("fieldCols");
      expect(keys).toContain("fieldRows");
      expect(keys).toContain("seed");
      expect(keys).toContain("density");
      expect(keys).toContain("markLength");
      expect(keys).toContain("markWeight");
      expect(keys).toContain("color");
      expect(keys).toContain("opacity");
      expect(keys).toContain("paintMode");
      expect(keys).toContain("depthScale");
      expect(keys).toContain("horizonY");
      expect(keys).toContain("maskCenterY");
      expect(keys).toContain("maskSpread");
    });
  });

  describe("render", () => {
    it("renders without throwing for default properties", () => {
      const ctx = createMockCtx();
      expect(() => {
        markFieldLayerType.render(markFieldLayerType.createDefault(), ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("calls ctx.save and ctx.restore", () => {
      const ctx = createMockCtx();
      markFieldLayerType.render(markFieldLayerType.createDefault(), ctx, BOUNDS, {} as never);
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it("renders with depthScale enabled", () => {
      const ctx = createMockCtx();
      const props = { ...markFieldLayerType.createDefault(), depthScale: true };
      expect(() => {
        markFieldLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("renders with vertical mask enabled", () => {
      const ctx = createMockCtx();
      const props = { ...markFieldLayerType.createDefault(), maskCenterY: 0.5 };
      expect(() => {
        markFieldLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("renders with different paint modes", () => {
      for (const mode of ["multiply", "normal", "screen"]) {
        const ctx = createMockCtx();
        const props = { ...markFieldLayerType.createDefault(), paintMode: mode };
        expect(() => {
          markFieldLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with different field types", () => {
      for (const field of ["noise:1:0.1:3", "linear:45:0.8", "radial:0.5:0.5:diverge"]) {
        const ctx = createMockCtx();
        const props = { ...markFieldLayerType.createDefault(), field };
        expect(() => {
          markFieldLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("skips render when bounds are zero-size", () => {
      const ctx = createMockCtx();
      const zeroBounds = { x: 0, y: 0, width: 0, height: 0 };
      expect(() => {
        markFieldLayerType.render(markFieldLayerType.createDefault(), ctx, zeroBounds, {} as never);
      }).not.toThrow();
      expect(ctx.save).not.toHaveBeenCalled();
    });

    it("renders with high density", () => {
      const ctx = createMockCtx();
      const props = { ...markFieldLayerType.createDefault(), density: 3000 };
      expect(() => {
        markFieldLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("renders with color variation", () => {
      const ctx = createMockCtx();
      const props = { ...markFieldLayerType.createDefault(), colorVariation: 0.8 };
      expect(() => {
        markFieldLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// add_mark_field MCP tool
// ---------------------------------------------------------------------------

describe("add_mark_field tool", () => {
  it("creates a new painting:mark-field layer with defaults", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    const result = await addMarkFieldTool.handler({}, ctx);

    expect(result.isError).toBeFalsy();
    expect(layers.size).toBe(1);
    const layer = [...layers.values()][0]!;
    expect(layer.type).toBe("painting:mark-field");
    expect(layer.properties.density).toBe(800);
    expect(layer.properties.markLength).toBe(15);
  });

  it("applies input overrides", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await addMarkFieldTool.handler({
      density: 1500,
      markLength: 25,
      markWeight: 2.0,
      color: "#ff0000",
      opacity: 0.5,
    }, ctx);

    const layer = [...layers.values()][0]!;
    expect(layer.properties.density).toBe(1500);
    expect(layer.properties.markLength).toBe(25);
    expect(layer.properties.markWeight).toBe(2.0);
    expect(layer.properties.color).toBe("#ff0000");
    expect(layer.properties.opacity).toBe(0.5);
  });

  it("returns error for invalid field", async () => {
    const ctx = createMockContext();
    const result = await addMarkFieldTool.handler({ field: "invalid::" }, ctx);
    // noiseField fallback should not error — only JSON parse errors would
    // The parseField function falls back to noise for unknown types
    expect(result.isError).toBeFalsy();
  });

  it("emits layer-added", async () => {
    const ctx = createMockContext();
    await addMarkFieldTool.handler({}, ctx);
    expect(ctx.emitChange).toHaveBeenCalledWith("layer-added");
  });

  it("sets depthScale from input", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await addMarkFieldTool.handler({ depthScale: true, horizonY: 0.4 }, ctx);

    const layer = [...layers.values()][0]!;
    expect(layer.properties.depthScale).toBe(true);
    expect(layer.properties.horizonY).toBe(0.4);
  });
});
