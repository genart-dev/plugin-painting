import { describe, it, expect, vi } from "vitest";
import { flowLinesLayerType } from "../src/flow-lines.js";
import { addFlowLinesTool } from "../src/painting-tools.js";
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
// flowLinesLayerType
// ---------------------------------------------------------------------------

describe("flowLinesLayerType", () => {
  it("has typeId 'painting:flow-lines'", () => {
    expect(flowLinesLayerType.typeId).toBe("painting:flow-lines");
  });

  it("has displayName 'Flow Lines'", () => {
    expect(flowLinesLayerType.displayName).toBe("Flow Lines");
  });

  it("has category 'draw'", () => {
    expect(flowLinesLayerType.category).toBe("draw");
  });

  describe("createDefault", () => {
    it("returns all expected property keys with correct defaults", () => {
      const d = flowLinesLayerType.createDefault();
      expect(d.field).toBe("noise:0:0.08:4");
      expect(d.fieldCols).toBe(40);
      expect(d.fieldRows).toBe(40);
      expect(d.minMagnitude).toBe(0.1);
      expect(d.seed).toBe(42);
      expect(d.lineCount).toBe(2000);
      expect(d.seedDistribution).toBe("grid-jittered");
      expect(d.lineLength).toBe(120);
      expect(d.stepSize).toBe(3);
      expect(d.lineWeight).toBe(0.8);
      expect(d.lineWeightVariation).toBe(0.15);
      expect(d.taper).toBe("tail");
      expect(d.color).toBe("#1a1a1a");
      expect(d.colorVariation).toBe(0.05);
      expect(d.opacity).toBe(0.6);
      expect(d.paintMode).toBe("multiply");
      expect(d.depthScale).toBe(true);
      expect(d.horizonY).toBe(0.3);
      expect(d.depthWeightRange).toBe("[0.3, 1.8]");
      expect(d.depthOpacityRange).toBe("[0.3, 1.0]");
      expect(d.maskCenterY).toBe(-1);
      expect(d.maskSpread).toBe(0.25);
    });

    it("returns a new object each time", () => {
      const a = flowLinesLayerType.createDefault();
      const b = flowLinesLayerType.createDefault();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("validate", () => {
    it("returns null for valid default properties", () => {
      const d = flowLinesLayerType.createDefault();
      expect(flowLinesLayerType.validate!(d)).toBeNull();
    });
  });

  describe("properties schema", () => {
    it("has all expected property keys", () => {
      const keys = flowLinesLayerType.properties.map((p) => p.key);
      expect(keys).toContain("field");
      expect(keys).toContain("fieldCols");
      expect(keys).toContain("fieldRows");
      expect(keys).toContain("minMagnitude");
      expect(keys).toContain("seed");
      expect(keys).toContain("lineCount");
      expect(keys).toContain("seedDistribution");
      expect(keys).toContain("lineLength");
      expect(keys).toContain("stepSize");
      expect(keys).toContain("lineWeight");
      expect(keys).toContain("taper");
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
        flowLinesLayerType.render(flowLinesLayerType.createDefault(), ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("calls ctx.save and ctx.restore", () => {
      const ctx = createMockCtx();
      flowLinesLayerType.render(flowLinesLayerType.createDefault(), ctx, BOUNDS, {} as never);
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it("renders with depthScale disabled", () => {
      const ctx = createMockCtx();
      const props = { ...flowLinesLayerType.createDefault(), depthScale: false };
      expect(() => {
        flowLinesLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("renders with vertical mask enabled", () => {
      const ctx = createMockCtx();
      const props = { ...flowLinesLayerType.createDefault(), maskCenterY: 0.5 };
      expect(() => {
        flowLinesLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("renders with different paint modes", () => {
      for (const mode of ["multiply", "normal", "screen"]) {
        const ctx = createMockCtx();
        const props = { ...flowLinesLayerType.createDefault(), paintMode: mode };
        expect(() => {
          flowLinesLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with different seed distributions", () => {
      for (const dist of ["uniform", "grid-jittered", "poisson"]) {
        const ctx = createMockCtx();
        const props = {
          ...flowLinesLayerType.createDefault(),
          seedDistribution: dist,
          lineCount: 200, // low count for speed
        };
        expect(() => {
          flowLinesLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with different taper modes", () => {
      for (const taper of ["none", "head", "tail", "both"]) {
        const ctx = createMockCtx();
        const props = {
          ...flowLinesLayerType.createDefault(),
          taper,
          lineCount: 200,
        };
        expect(() => {
          flowLinesLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders with different field types", () => {
      for (const field of ["noise:1:0.08:4", "linear:90:1", "vortex:0.5:0.5:0.3"]) {
        const ctx = createMockCtx();
        const props = {
          ...flowLinesLayerType.createDefault(),
          field,
          lineCount: 200,
        };
        expect(() => {
          flowLinesLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("skips render when bounds are zero-size", () => {
      const ctx = createMockCtx();
      const zeroBounds = { x: 0, y: 0, width: 0, height: 0 };
      expect(() => {
        flowLinesLayerType.render(flowLinesLayerType.createDefault(), ctx, zeroBounds, {} as never);
      }).not.toThrow();
      expect(ctx.save).not.toHaveBeenCalled();
    });

    it("renders with high line count", () => {
      const ctx = createMockCtx();
      const props = { ...flowLinesLayerType.createDefault(), lineCount: 5000 };
      expect(() => {
        flowLinesLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("renders with color variation", () => {
      const ctx = createMockCtx();
      const props = { ...flowLinesLayerType.createDefault(), colorVariation: 0.5, lineCount: 200 };
      expect(() => {
        flowLinesLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// add_flow_lines MCP tool
// ---------------------------------------------------------------------------

describe("add_flow_lines tool", () => {
  it("creates a new painting:flow-lines layer with defaults", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    const result = await addFlowLinesTool.handler({}, ctx);

    expect(result.isError).toBeFalsy();
    expect(layers.size).toBe(1);
    const layer = [...layers.values()][0]!;
    expect(layer.type).toBe("painting:flow-lines");
    expect(layer.properties.lineCount).toBe(2000);
    expect(layer.properties.lineLength).toBe(120);
  });

  it("applies input overrides", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await addFlowLinesTool.handler({
      lineCount: 500,
      lineLength: 200,
      lineWeight: 1.5,
      color: "#003366",
      opacity: 0.8,
      seedDistribution: "poisson",
      taper: "both",
    }, ctx);

    const layer = [...layers.values()][0]!;
    expect(layer.properties.lineCount).toBe(500);
    expect(layer.properties.lineLength).toBe(200);
    expect(layer.properties.lineWeight).toBe(1.5);
    expect(layer.properties.color).toBe("#003366");
    expect(layer.properties.opacity).toBe(0.8);
    expect(layer.properties.seedDistribution).toBe("poisson");
    expect(layer.properties.taper).toBe("both");
  });

  it("emits layer-added", async () => {
    const ctx = createMockContext();
    await addFlowLinesTool.handler({}, ctx);
    expect(ctx.emitChange).toHaveBeenCalledWith("layer-added");
  });

  it("sets depthScale and horizonY from input", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await addFlowLinesTool.handler({ depthScale: false, horizonY: 0.5 }, ctx);

    const layer = [...layers.values()][0]!;
    expect(layer.properties.depthScale).toBe(false);
    expect(layer.properties.horizonY).toBe(0.5);
  });

  it("sets field from input", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await addFlowLinesTool.handler({ field: "linear:90:1" }, ctx);

    const layer = [...layers.values()][0]!;
    expect(layer.properties.field).toBe("linear:90:1");
  });

  it("accepts algorithm field without error", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    const result = await addFlowLinesTool.handler({ field: "algorithm:flow" }, ctx);
    expect(result.isError).toBeFalsy();
    const layer = [...layers.values()][0]!;
    expect(layer.properties.field).toBe("algorithm:flow");
  });
});
