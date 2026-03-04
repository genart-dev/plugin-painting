import { describe, it, expect, vi } from "vitest";
import { fillLayerType } from "../src/fill-layer.js";
import {
  fillRegionTool,
  updateFillTool,
  listFillPresetsTool,
} from "../src/painting-tools.js";
import type { McpToolContext, DesignLayer } from "@genart-dev/core";

// ---------------------------------------------------------------------------
// Canvas mock (shared with stamp-renderer.test.ts)
// ---------------------------------------------------------------------------

function createMockImageData(w: number, h: number) {
  return {
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
    colorSpace: "srgb" as PredefinedColorSpace,
  };
}

function createMockCtx(width = 400, height = 300) {
  const imageData = createMockImageData(width, height);

  const MockCanvasClass = function (
    this: Record<string, unknown>,
    w: number,
    h: number,
  ) {
    this.width = w;
    this.height = h;
    this.getContext = vi.fn().mockReturnValue({
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      ellipse: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      getImageData: vi.fn().mockReturnValue(createMockImageData(w, h)),
      putImageData: vi.fn(),
      createImageData: vi.fn((iw: number, ih: number) => createMockImageData(iw, ih)),
    });
  } as unknown as new (w: number, h: number) => HTMLCanvasElement;

  const mockCanvas = new MockCanvasClass(width, height);

  const ctx: Record<string, unknown> = {
    canvas: mockCanvas,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    ellipse: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    getImageData: vi.fn().mockReturnValue(imageData),
    putImageData: vi.fn(),
    createImageData: vi.fn((w: number, h: number) => createMockImageData(w, h)),
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

function createFillLayer(id: string, overrides: Partial<Record<string, unknown>> = {}): DesignLayer {
  const defaults = fillLayerType.createDefault();
  return {
    id,
    type: "painting:fill",
    name: "Fill",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    transform: { x: 0, y: 0, width: 800, height: 600, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0 },
    properties: { ...defaults, ...overrides } as Record<string, string | number | boolean | null>,
  };
}

// ---------------------------------------------------------------------------
// fillLayerType
// ---------------------------------------------------------------------------

describe("fillLayerType", () => {
  it("has typeId 'painting:fill'", () => {
    expect(fillLayerType.typeId).toBe("painting:fill");
  });

  it("has category 'draw'", () => {
    expect(fillLayerType.category).toBe("draw");
  });

  it("has displayName 'Fill'", () => {
    expect(fillLayerType.displayName).toBe("Fill");
  });

  describe("createDefault", () => {
    it("returns all expected property keys with correct defaults", () => {
      const d = fillLayerType.createDefault();
      expect(d.brushId).toBe("ink-pen");
      expect(d.color).toBe("#000000");
      expect(d.size).toBe(4);
      expect(d.seed).toBe(42);
      expect(d.opacity).toBe(1);
      expect(JSON.parse(d.region as string)).toEqual({ type: "bounds" });
      expect(JSON.parse(d.strategy as string).type).toBe("hatch");
      expect(JSON.parse(d.shading as string)).toEqual({ type: "uniform" });
      expect(JSON.parse(d.shadingAffects as string)).toEqual(["density"]);
    });

    it("returns new object each call", () => {
      const a = fillLayerType.createDefault();
      const b = fillLayerType.createDefault();
      expect(a).not.toBe(b);
    });
  });

  describe("validate", () => {
    it("returns null for default properties", () => {
      const d = fillLayerType.createDefault();
      expect(fillLayerType.validate!(d)).toBeNull();
    });

    it("returns error for invalid region JSON", () => {
      const d = fillLayerType.createDefault();
      d.region = "not json{";
      const errors = fillLayerType.validate!(d);
      expect(errors).not.toBeNull();
      expect(errors![0]!.property).toBe("region");
    });

    it("returns error for invalid strategy JSON", () => {
      const d = fillLayerType.createDefault();
      d.strategy = "{bad}";
      const errors = fillLayerType.validate!(d);
      expect(errors).not.toBeNull();
      expect(errors![0]!.property).toBe("strategy");
    });

    it("returns error for invalid shading JSON", () => {
      const d = fillLayerType.createDefault();
      d.shading = "not-json";
      const errors = fillLayerType.validate!(d);
      expect(errors).not.toBeNull();
      expect(errors![0]!.property).toBe("shading");
    });

    it("returns multiple errors for multiple invalid fields", () => {
      const d = fillLayerType.createDefault();
      d.region = "bad";
      d.strategy = "bad";
      const errors = fillLayerType.validate!(d);
      expect(errors!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("render", () => {
    it("renders without throwing for default properties", () => {
      const ctx = createMockCtx();
      expect(() => {
        fillLayerType.render(fillLayerType.createDefault(), ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("calls ctx.save and ctx.restore", () => {
      const ctx = createMockCtx();
      fillLayerType.render(fillLayerType.createDefault(), ctx, BOUNDS, {} as never);
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it("renders all strategy types without throwing", () => {
      const strategies = [
        '{"type":"hatch","angle":45,"spacing":10}',
        '{"type":"crosshatch","angles":[45,135],"spacing":10,"passDecay":0.7}',
        '{"type":"stipple","density":20,"distribution":"random"}',
        '{"type":"scumble","density":10,"strokeLength":15,"curvature":0.4}',
        '{"type":"contour","spacing":10,"smoothing":0.2}',
      ];
      for (const strategy of strategies) {
        const ctx = createMockCtx();
        const props = { ...fillLayerType.createDefault(), strategy };
        expect(() => {
          fillLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders all region types without throwing", () => {
      const regions = [
        '{"type":"bounds"}',
        '{"type":"rect","x":50,"y":50,"width":200,"height":150}',
        '{"type":"ellipse","cx":200,"cy":150,"rx":80,"ry":60}',
        '{"type":"polygon","points":[{"x":50,"y":50},{"x":300,"y":50},{"x":300,"y":250},{"x":50,"y":250}]}',
      ];
      for (const region of regions) {
        const ctx = createMockCtx();
        const props = { ...fillLayerType.createDefault(), region };
        expect(() => {
          fillLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("renders all shading types without throwing", () => {
      const shadings = [
        '{"type":"uniform"}',
        '{"type":"linear","angle":45,"range":[0.2,1.0]}',
        '{"type":"radial","cx":0.5,"cy":0.5,"range":[0.0,1.0]}',
        '{"type":"noise","seed":0,"scale":1,"range":[0.3,1.0]}',
      ];
      for (const shading of shadings) {
        const ctx = createMockCtx();
        const props = { ...fillLayerType.createDefault(), shading };
        expect(() => {
          fillLayerType.render(props, ctx, BOUNDS, {} as never);
        }).not.toThrow();
      }
    });

    it("handles malformed JSON properties gracefully (no throw)", () => {
      const ctx = createMockCtx();
      const props = {
        ...fillLayerType.createDefault(),
        region: "bad json",
        strategy: "also bad",
        shading: "{",
      };
      expect(() => {
        fillLayerType.render(props, ctx, BOUNDS, {} as never);
      }).not.toThrow();
    });

    it("skips render when bounds are zero-size", () => {
      const ctx = createMockCtx();
      const zeroBounds = { x: 0, y: 0, width: 0, height: 0 };
      expect(() => {
        fillLayerType.render(fillLayerType.createDefault(), ctx, zeroBounds, {} as never);
      }).not.toThrow();
      expect(ctx.save).not.toHaveBeenCalled();
    });

    it("uses the render cache on repeated identical renders", () => {
      // The module-level cache is keyed on property hash.
      // Both calls should complete without error; we verify the second call
      // (cache hit) calls save the same number of times as the first (same strokes).
      const props = { ...fillLayerType.createDefault(), seed: 88887 }; // unique seed avoids cache collision with other tests
      const ctx1 = createMockCtx();
      fillLayerType.render(props, ctx1, BOUNDS, {} as never);
      const saveCount1 = (ctx1.save as ReturnType<typeof vi.fn>).mock.calls.length;

      const ctx2 = createMockCtx();
      fillLayerType.render(props, ctx2, BOUNDS, {} as never);
      const saveCount2 = (ctx2.save as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(saveCount2).toBe(saveCount1);
    });
  });
});

// ---------------------------------------------------------------------------
// fill_region MCP tool
// ---------------------------------------------------------------------------

describe("fill_region tool", () => {
  it("creates a new painting:fill layer", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    const result = await fillRegionTool.handler(
      { strategy: { type: "hatch", angle: 45, spacing: 8 } },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    expect(layers.size).toBe(1);
    const layer = [...layers.values()][0]!;
    expect(layer.type).toBe("painting:fill");
    expect(JSON.parse(layer.properties.strategy as string).type).toBe("hatch");
  });

  it("accepts preset name as strategy", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    const result = await fillRegionTool.handler({ strategy: "hatch-medium" }, ctx);

    expect(result.isError).toBeFalsy();
    const layer = [...layers.values()][0]!;
    expect(layer.type).toBe("painting:fill");
    expect(layer.properties.brushId).toBe("ink-pen");
    expect(layer.properties.size).toBe(3);
  });

  it("returns error for unknown preset name", async () => {
    const ctx = createMockContext();
    const result = await fillRegionTool.handler({ strategy: "nonexistent-preset" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("returns error when strategy is missing", async () => {
    const ctx = createMockContext();
    const result = await fillRegionTool.handler({}, ctx);
    expect(result.isError).toBe(true);
  });

  it("applies explicit property overrides over preset defaults", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await fillRegionTool.handler({
      strategy: "hatch-light",
      color: "#ff0000",
      size: 10,
      seed: 99,
    }, ctx);

    const layer = [...layers.values()][0]!;
    expect(layer.properties.color).toBe("#ff0000");
    expect(layer.properties.size).toBe(10);
    expect(layer.properties.seed).toBe(99);
  });

  it("serializes region object as JSON on the layer", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await fillRegionTool.handler({
      strategy: { type: "stipple", density: 20, distribution: "random" },
      region: { type: "rect", x: 10, y: 20, width: 100, height: 80 },
    }, ctx);

    const layer = [...layers.values()][0]!;
    const region = JSON.parse(layer.properties.region as string);
    expect(region.type).toBe("rect");
    expect(region.x).toBe(10);
  });

  it("serializes shading object as JSON on the layer", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await fillRegionTool.handler({
      strategy: { type: "hatch", angle: 0, spacing: 10 },
      shading: { type: "linear", angle: 90, range: [0.2, 1.0] },
    }, ctx);

    const layer = [...layers.values()][0]!;
    const shading = JSON.parse(layer.properties.shading as string);
    expect(shading.type).toBe("linear");
    expect(shading.angle).toBe(90);
  });

  it("updates an existing painting:fill layer when layerId is provided", async () => {
    const layers = new Map<string, DesignLayer>();
    layers.set("fill-1", createFillLayer("fill-1"));
    const ctx = createMockContext(layers);

    const result = await fillRegionTool.handler({
      layerId: "fill-1",
      strategy: { type: "crosshatch", angles: [30, 120], spacing: 6, passDecay: 0.8 },
      color: "#333333",
    }, ctx);

    expect(result.isError).toBeFalsy();
    const layer = layers.get("fill-1")!;
    expect(JSON.parse(layer.properties.strategy as string).type).toBe("crosshatch");
    expect(layer.properties.color).toBe("#333333");
  });

  it("returns error when updating non-existent layer", async () => {
    const ctx = createMockContext();
    const result = await fillRegionTool.handler({
      layerId: "ghost-layer",
      strategy: { type: "hatch", angle: 45, spacing: 8 },
    }, ctx);
    expect(result.isError).toBe(true);
  });

  it("returns error when updating wrong layer type", async () => {
    const layers = new Map<string, DesignLayer>();
    layers.set("stroke-1", {
      id: "stroke-1",
      type: "painting:stroke",
      name: "Stroke",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      transform: { x: 0, y: 0, width: 800, height: 600, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0 },
      properties: { brushes: "[]", strokes: "[]" },
    });
    const ctx = createMockContext(layers);

    const result = await fillRegionTool.handler({
      layerId: "stroke-1",
      strategy: { type: "hatch", angle: 45, spacing: 8 },
    }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("painting:fill");
  });

  it("sets custom layer name", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await fillRegionTool.handler({
      strategy: "contour",
      layerName: "Shadow Contour",
    }, ctx);

    const layer = [...layers.values()][0]!;
    expect(layer.name).toBe("Shadow Contour");
  });

  it("uses custom transform when x/y/width/height provided", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await fillRegionTool.handler({
      strategy: "stipple-light",
      x: 50, y: 50, width: 200, height: 150,
    }, ctx);

    const layer = [...layers.values()][0]!;
    expect(layer.transform.x).toBe(50);
    expect(layer.transform.y).toBe(50);
    expect(layer.transform.width).toBe(200);
    expect(layer.transform.height).toBe(150);
  });

  it("emits layer-added change event", async () => {
    const ctx = createMockContext();
    await fillRegionTool.handler({ strategy: "hatch-light" }, ctx);
    expect(ctx.emitChange).toHaveBeenCalledWith("layer-added");
  });

  it("emits layer-updated when modifying existing layer", async () => {
    const layers = new Map<string, DesignLayer>();
    layers.set("f1", createFillLayer("f1"));
    const ctx = createMockContext(layers);

    await fillRegionTool.handler({
      layerId: "f1",
      strategy: { type: "stipple", density: 30, distribution: "poisson" },
    }, ctx);
    expect(ctx.emitChange).toHaveBeenCalledWith("layer-updated");
  });
});

// ---------------------------------------------------------------------------
// update_fill MCP tool
// ---------------------------------------------------------------------------

describe("update_fill tool", () => {
  it("merges partial strategy with existing", async () => {
    const layers = new Map<string, DesignLayer>();
    layers.set("f1", createFillLayer("f1", {
      strategy: '{"type":"hatch","angle":45,"spacing":8}',
    }));
    const ctx = createMockContext(layers);

    const result = await updateFillTool.handler({
      layerId: "f1",
      strategy: { angle: 30 },
    }, ctx);

    expect(result.isError).toBeFalsy();
    const updated = JSON.parse(layers.get("f1")!.properties.strategy as string);
    expect(updated.type).toBe("hatch");   // preserved
    expect(updated.spacing).toBe(8);      // preserved
    expect(updated.angle).toBe(30);       // updated
  });

  it("replaces shading entirely", async () => {
    const layers = new Map<string, DesignLayer>();
    layers.set("f1", createFillLayer("f1"));
    const ctx = createMockContext(layers);

    await updateFillTool.handler({
      layerId: "f1",
      shading: { type: "radial", cx: 0.5, cy: 0.5, range: [0, 1] },
    }, ctx);

    const updated = JSON.parse(layers.get("f1")!.properties.shading as string);
    expect(updated.type).toBe("radial");
  });

  it("updates color, size, brushId, seed", async () => {
    const layers = new Map<string, DesignLayer>();
    layers.set("f1", createFillLayer("f1"));
    const ctx = createMockContext(layers);

    await updateFillTool.handler({
      layerId: "f1",
      color: "#aabbcc",
      size: 6,
      brushId: "pencil",
      seed: 77,
    }, ctx);

    const l = layers.get("f1")!;
    expect(l.properties.color).toBe("#aabbcc");
    expect(l.properties.size).toBe(6);
    expect(l.properties.brushId).toBe("pencil");
    expect(l.properties.seed).toBe(77);
  });

  it("returns error for missing layerId", async () => {
    const ctx = createMockContext();
    const result = await updateFillTool.handler({}, ctx);
    expect(result.isError).toBe(true);
  });

  it("returns error for non-existent layer", async () => {
    const ctx = createMockContext();
    const result = await updateFillTool.handler({ layerId: "ghost" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("returns error for wrong layer type", async () => {
    const layers = new Map<string, DesignLayer>();
    layers.set("s1", {
      id: "s1", type: "painting:stroke", name: "S", visible: true, locked: false,
      opacity: 1, blendMode: "normal",
      transform: { x: 0, y: 0, width: 800, height: 600, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0 },
      properties: {},
    });
    const ctx = createMockContext(layers);
    const result = await updateFillTool.handler({ layerId: "s1", color: "#000" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("returns 'No changes' message when no properties provided", async () => {
    const layers = new Map<string, DesignLayer>();
    layers.set("f1", createFillLayer("f1"));
    const ctx = createMockContext(layers);

    const result = await updateFillTool.handler({ layerId: "f1" }, ctx);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("No changes");
  });

  it("emits layer-updated on success", async () => {
    const layers = new Map<string, DesignLayer>();
    layers.set("f1", createFillLayer("f1"));
    const ctx = createMockContext(layers);

    await updateFillTool.handler({ layerId: "f1", color: "#ff0000" }, ctx);
    expect(ctx.emitChange).toHaveBeenCalledWith("layer-updated");
  });
});

// ---------------------------------------------------------------------------
// list_fill_presets MCP tool
// ---------------------------------------------------------------------------

describe("list_fill_presets tool", () => {
  it("returns JSON array of presets", async () => {
    const ctx = createMockContext();
    const result = await listFillPresetsTool.handler({}, ctx);
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(9);
  });

  it("each entry has name, strategy, brushId, size", async () => {
    const ctx = createMockContext();
    const result = await listFillPresetsTool.handler({}, ctx);
    const parsed = JSON.parse(result.content[0]!.text) as Array<{
      name: string;
      strategy: { type: string };
      brushId: string;
      size: number;
    }>;
    for (const entry of parsed) {
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.strategy.type).toBe("string");
      expect(typeof entry.brushId).toBe("string");
      expect(typeof entry.size).toBe("number");
    }
  });

  it("includes all expected preset names", async () => {
    const ctx = createMockContext();
    const result = await listFillPresetsTool.handler({}, ctx);
    const parsed = JSON.parse(result.content[0]!.text) as Array<{ name: string }>;
    const names = parsed.map((p) => p.name);
    expect(names).toContain("hatch-medium");
    expect(names).toContain("crosshatch-dense");
    expect(names).toContain("stipple-light");
    expect(names).toContain("contour");
  });
});
