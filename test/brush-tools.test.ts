import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  brushStrokeTool,
  listBrushesTool,
  createBrushTool,
  eraseStrokesTool,
} from "../src/painting-tools.js";
import type { McpToolContext, DesignLayer } from "@genart-dev/core";

// ---------------------------------------------------------------------------
// Mock context factory
// ---------------------------------------------------------------------------

function createMockContext(layers: Map<string, DesignLayer> = new Map()): McpToolContext {
  return {
    canvasWidth: 800,
    canvasHeight: 600,
    layers: {
      get(id: string) {
        return layers.get(id) ?? null;
      },
      add(layer: DesignLayer, _index?: number) {
        layers.set(layer.id, layer);
      },
      updateProperties(id: string, props: Record<string, unknown>) {
        const layer = layers.get(id);
        if (layer) {
          layer.properties = { ...layer.properties, ...props } as Record<
            string,
            string | number | boolean | null
          >;
        }
      },
      list() {
        return [...layers.values()];
      },
      remove(_id: string) {},
      reorder(_ids: string[]) {},
    },
    emitChange: vi.fn(),
  } as unknown as McpToolContext;
}

function createStrokeLayer(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): DesignLayer {
  return {
    id,
    type: "painting:stroke",
    name: "Brush Stroke",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    transform: { x: 0, y: 0, width: 800, height: 600, rotation: 0, scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0 },
    properties: {
      brushes: "[]",
      strokes: "[]",
      field: "",
      fieldCols: 20,
      fieldRows: 20,
      seed: 0,
      opacity: 1,
      debug: false,
      debugOpacity: 0.7,
      debugMode: "all",
      ...overrides,
    } as Record<string, string | number | boolean | null>,
  };
}

const SAMPLE_POINTS = [
  { x: 10, y: 10 },
  { x: 50, y: 30 },
  { x: 100, y: 20 },
];

// ---------------------------------------------------------------------------
// brush_stroke
// ---------------------------------------------------------------------------

describe("brush_stroke tool", () => {
  it("creates a new painting:stroke layer when no layerId given", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    const result = await brushStrokeTool.handler(
      { brushId: "round-hard", color: "#ff0000", points: SAMPLE_POINTS },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("Created painting:stroke layer");

    // Layer should exist
    expect(layers.size).toBe(1);
    const layer = [...layers.values()][0]!;
    expect(layer.type).toBe("painting:stroke");

    // Strokes should contain 1 stroke
    const strokes = JSON.parse(layer.properties.strokes as string);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].brushId).toBe("round-hard");
    expect(strokes[0].color).toBe("#ff0000");
    expect(strokes[0].points).toHaveLength(3);
  });

  it("appends a stroke to an existing layer", async () => {
    const existingStrokes = [
      { brushId: "round-soft", color: "#00ff00", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    ];
    const layer = createStrokeLayer("layer-1", {
      strokes: JSON.stringify(existingStrokes),
    });
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await brushStrokeTool.handler(
      {
        layerId: "layer-1",
        brushId: "ink-pen",
        color: "#0000ff",
        points: SAMPLE_POINTS,
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("Appended stroke #2");

    const updatedStrokes = JSON.parse(layer.properties.strokes as string);
    expect(updatedStrokes).toHaveLength(2);
    expect(updatedStrokes[1].brushId).toBe("ink-pen");
  });

  it("returns error for invalid color", async () => {
    const ctx = createMockContext();
    const result = await brushStrokeTool.handler(
      { brushId: "round-hard", color: "not-hex", points: SAMPLE_POINTS },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Invalid hex color");
  });

  it("returns error for too few points", async () => {
    const ctx = createMockContext();
    const result = await brushStrokeTool.handler(
      { brushId: "round-hard", color: "#000", points: [{ x: 0, y: 0 }] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("at least 2 points");
  });

  it("returns error when appending to non-existent layer", async () => {
    const ctx = createMockContext();
    const result = await brushStrokeTool.handler(
      { layerId: "nope", brushId: "round-hard", color: "#000", points: SAMPLE_POINTS },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not found");
  });

  it("returns error when appending to wrong layer type", async () => {
    const layer = createStrokeLayer("layer-1");
    (layer as { type: string }).type = "painting:watercolor";
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await brushStrokeTool.handler(
      { layerId: "layer-1", brushId: "round-hard", color: "#000", points: SAMPLE_POINTS },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not a painting:stroke layer");
  });

  it("accepts size and opacity overrides", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await brushStrokeTool.handler(
      {
        brushId: "round-hard",
        color: "#000",
        points: SAMPLE_POINTS,
        size: 50,
        opacity: 0.5,
      },
      ctx,
    );

    const layer = [...layers.values()][0]!;
    const strokes = JSON.parse(layer.properties.strokes as string);
    expect(strokes[0].size).toBe(50);
    expect(strokes[0].opacity).toBe(0.5);
  });

  it("adds inline brush when creating new layer", async () => {
    const layers = new Map<string, DesignLayer>();
    const ctx = createMockContext(layers);

    await brushStrokeTool.handler(
      {
        brushId: "my-custom",
        color: "#000",
        points: SAMPLE_POINTS,
        brush: { id: "my-custom", name: "My Custom", hardness: 0.3 },
      },
      ctx,
    );

    const layer = [...layers.values()][0]!;
    const brushes = JSON.parse(layer.properties.brushes as string);
    expect(brushes).toHaveLength(1);
    expect(brushes[0].id).toBe("my-custom");
  });
});

// ---------------------------------------------------------------------------
// list_brushes
// ---------------------------------------------------------------------------

describe("list_brushes tool", () => {
  it("returns all 14 presets when no layerId given", async () => {
    const ctx = createMockContext();
    const result = await listBrushesTool.handler({}, ctx);

    expect(result.isError).toBeUndefined();
    const brushes = JSON.parse(result.content[0]!.text);
    const presets = brushes.filter((b: { source: string }) => b.source === "preset");
    expect(presets).toHaveLength(14);
  });

  it("includes tipType for each brush", async () => {
    const ctx = createMockContext();
    const result = await listBrushesTool.handler({}, ctx);
    const brushes = JSON.parse(result.content[0]!.text);

    for (const brush of brushes) {
      expect(["round", "texture"]).toContain(brush.tipType);
    }

    // Check that texture presets are flagged
    const textureBrushes = brushes.filter((b: { tipType: string }) => b.tipType === "texture");
    expect(textureBrushes.length).toBe(3);
  });

  it("includes custom brushes from a layer", async () => {
    const customBrushes = [
      { id: "my-brush", name: "My Brush" },
      { id: "my-brush-2", name: "My Brush 2" },
    ];
    const layer = createStrokeLayer("layer-1", {
      brushes: JSON.stringify(customBrushes),
    });
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await listBrushesTool.handler({ layerId: "layer-1" }, ctx);

    const brushes = JSON.parse(result.content[0]!.text);
    const customs = brushes.filter((b: { source: string }) => b.source === "custom");
    expect(customs).toHaveLength(2);
    expect(customs[0].id).toBe("my-brush");
  });

  it("returns error for non-existent layer", async () => {
    const ctx = createMockContext();
    const result = await listBrushesTool.handler({ layerId: "nope" }, ctx);
    expect(result.isError).toBe(true);
  });

  it("returns error for wrong layer type", async () => {
    const layer = createStrokeLayer("layer-1");
    (layer as { type: string }).type = "painting:watercolor";
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await listBrushesTool.handler({ layerId: "layer-1" }, ctx);
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// create_brush
// ---------------------------------------------------------------------------

describe("create_brush tool", () => {
  it("adds a custom brush to a layer", async () => {
    const layer = createStrokeLayer("layer-1");
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await createBrushTool.handler(
      {
        layerId: "layer-1",
        brush: { id: "my-splat", name: "My Splat", scatter: 2.0, spacing: 0.3 },
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("Added");

    const brushes = JSON.parse(layer.properties.brushes as string);
    expect(brushes).toHaveLength(1);
    expect(brushes[0].id).toBe("my-splat");
    expect(brushes[0].scatter).toBe(2.0);
  });

  it("updates an existing custom brush", async () => {
    const layer = createStrokeLayer("layer-1", {
      brushes: JSON.stringify([{ id: "my-brush", name: "Old Name", size: 10 }]),
    });
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await createBrushTool.handler(
      {
        layerId: "layer-1",
        brush: { id: "my-brush", name: "New Name", size: 30 },
      },
      ctx,
    );

    expect(result.content[0]!.text).toContain("Updated");
    const brushes = JSON.parse(layer.properties.brushes as string);
    expect(brushes).toHaveLength(1);
    expect(brushes[0].name).toBe("New Name");
    expect(brushes[0].size).toBe(30);
  });

  it("rejects brush id that conflicts with a preset", async () => {
    const layer = createStrokeLayer("layer-1");
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await createBrushTool.handler(
      {
        layerId: "layer-1",
        brush: { id: "round-hard", name: "Conflicting" },
      },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("conflicts with a built-in preset");
  });

  it("returns error for missing brush id/name", async () => {
    const layer = createStrokeLayer("layer-1");
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await createBrushTool.handler(
      { layerId: "layer-1", brush: {} },
      ctx,
    );
    expect(result.isError).toBe(true);
  });

  it("returns error for non-existent layer", async () => {
    const ctx = createMockContext();
    const result = await createBrushTool.handler(
      { layerId: "nope", brush: { id: "x", name: "X" } },
      ctx,
    );
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// erase_strokes
// ---------------------------------------------------------------------------

describe("erase_strokes tool", () => {
  function layerWithStrokes(count: number): DesignLayer {
    const strokes = Array.from({ length: count }, (_, i) => ({
      brushId: "round-hard",
      color: "#000",
      points: [{ x: i * 10, y: 0 }, { x: i * 10 + 10, y: 10 }],
    }));
    return createStrokeLayer("layer-1", { strokes: JSON.stringify(strokes) });
  }

  it("removes a single stroke by index", async () => {
    const layer = layerWithStrokes(5);
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await eraseStrokesTool.handler(
      { layerId: "layer-1", start: 2 },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("Removed 1 stroke");
    expect(result.content[0]!.text).toContain("4 strokes remaining");

    const strokes = JSON.parse(layer.properties.strokes as string);
    expect(strokes).toHaveLength(4);
  });

  it("removes a range of strokes", async () => {
    const layer = layerWithStrokes(5);
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await eraseStrokesTool.handler(
      { layerId: "layer-1", start: 1, end: 3 },
      ctx,
    );

    expect(result.content[0]!.text).toContain("Removed 3 strokes");
    expect(result.content[0]!.text).toContain("2 strokes remaining");

    const strokes = JSON.parse(layer.properties.strokes as string);
    expect(strokes).toHaveLength(2);
  });

  it("clamps end to last index", async () => {
    const layer = layerWithStrokes(3);
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await eraseStrokesTool.handler(
      { layerId: "layer-1", start: 1, end: 99 },
      ctx,
    );

    expect(result.content[0]!.text).toContain("Removed 2 strokes");
    const strokes = JSON.parse(layer.properties.strokes as string);
    expect(strokes).toHaveLength(1);
  });

  it("returns error for out-of-range start", async () => {
    const layer = layerWithStrokes(3);
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await eraseStrokesTool.handler(
      { layerId: "layer-1", start: 5 },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("out of range");
  });

  it("returns error when end < start", async () => {
    const layer = layerWithStrokes(3);
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await eraseStrokesTool.handler(
      { layerId: "layer-1", start: 2, end: 0 },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("end must be >= start");
  });

  it("returns error for non-existent layer", async () => {
    const ctx = createMockContext();
    const result = await eraseStrokesTool.handler(
      { layerId: "nope", start: 0 },
      ctx,
    );
    expect(result.isError).toBe(true);
  });

  it("returns error for wrong layer type", async () => {
    const layer = layerWithStrokes(3);
    (layer as { type: string }).type = "painting:watercolor";
    const layers = new Map([["layer-1", layer]]);
    const ctx = createMockContext(layers);

    const result = await eraseStrokesTool.handler(
      { layerId: "layer-1", start: 0 },
      ctx,
    );
    expect(result.isError).toBe(true);
  });
});
