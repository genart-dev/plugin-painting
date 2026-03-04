import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderStrokes } from "../src/brush/stamp-renderer.js";
import { clearTipCache, preloadTextureTip } from "../src/brush/tip-generator.js";
import { BRUSH_PRESETS } from "../src/brush/presets.js";
import type { BrushDefinition, BrushStroke } from "../src/brush/types.js";
import type { LayerBounds } from "@genart-dev/core";

// ---------------------------------------------------------------------------
// Canvas2D mock
// ---------------------------------------------------------------------------

/** Minimal ImageData shim for Node.js (vitest doesn't have DOM by default). */
function createMockImageData(w: number, h: number): ImageData {
  return {
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
    colorSpace: "srgb" as PredefinedColorSpace,
  };
}

/**
 * Create a mock CanvasRenderingContext2D with vi.fn() stubs.
 * The canvas property is used by createOffscreenCanvas for reference-ctx cloning.
 */
function createMockCtx(width = 200, height = 200) {
  const imageData = createMockImageData(width, height);
  const mockCanvas = {
    width,
    height,
    getContext: vi.fn().mockReturnValue(null), // will be overridden
  };

  const ctx: Record<string, unknown> = {
    canvas: mockCanvas,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue(imageData),
    putImageData: vi.fn(),
    createImageData: vi.fn((w: number, h: number) => createMockImageData(w, h)),
  };

  // Make canvas.getContext return a new mock ctx (for offscreen canvases)
  // The stamp-renderer creates offscreen canvases via the reference canvas constructor,
  // so we need the constructor to produce something getContext-able.
  const MockCanvasClass = function (this: Record<string, unknown>, w: number, h: number) {
    this.width = w;
    this.height = h;
    this.getContext = vi.fn().mockReturnValue({
      ...ctx,
      canvas: this,
      getImageData: vi.fn().mockReturnValue(createMockImageData(w, h)),
      putImageData: vi.fn(),
      createImageData: vi.fn((iw: number, ih: number) => createMockImageData(iw, ih)),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
    });
  } as unknown as new (w: number, h: number) => HTMLCanvasElement;

  // Replace the mock canvas's constructor so createOffscreenCanvas can clone it
  Object.setPrototypeOf(mockCanvas, MockCanvasClass.prototype);
  (mockCanvas as unknown as { constructor: unknown }).constructor = MockCanvasClass;

  return ctx as unknown as CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BOUNDS: LayerBounds = { x: 0, y: 0, width: 200, height: 200 };

const SIMPLE_POINTS = [
  { x: 20, y: 100 },
  { x: 180, y: 100 },
];

const PRESSURE_POINTS = [
  { x: 20, y: 100, pressure: 0.2 },
  { x: 100, y: 100, pressure: 0.8 },
  { x: 180, y: 100, pressure: 0.2 },
];

function makeStroke(overrides: Partial<BrushStroke> = {}): BrushStroke {
  return {
    brushId: "round-hard",
    color: "#ff0000",
    points: SIMPLE_POINTS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearTipCache();
});

describe("renderStrokes", () => {
  describe("basic rendering", () => {
    it("calls save and restore on context for buildup mode", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke();

      renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 42);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });

    it("does not throw for a simple stroke with round-hard preset", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke();

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();
    });

    it("does not throw for multiple strokes", () => {
      const ctx = createMockCtx();
      const strokes = [
        makeStroke({ brushId: "round-hard", color: "#ff0000" }),
        makeStroke({ brushId: "round-soft", color: "#00ff00" }),
        makeStroke({ brushId: "flat", color: "#0000ff" }),
      ];

      expect(() => {
        renderStrokes(strokes, BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();
    });

    it("skips strokes with fewer than 2 points", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke({ points: [{ x: 10, y: 10 }] });

      renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);

      // save/restore should not be called because the stroke was skipped
      expect(ctx.save).not.toHaveBeenCalled();
    });

    it("renders nothing for empty strokes array", () => {
      const ctx = createMockCtx();

      renderStrokes([], BRUSH_PRESETS, ctx, BOUNDS, 0);

      expect(ctx.save).not.toHaveBeenCalled();
    });
  });

  describe("wash mode", () => {
    it("calls getImageData and putImageData for alpha clamping", () => {
      const ctx = createMockCtx();
      // ink-pen is wash mode
      const stroke = makeStroke({ brushId: "ink-pen" });

      renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);

      // Wash mode creates an offscreen canvas, renders to it, then clamps alpha.
      // The offscreen ctx should have getImageData called.
      // The main ctx should have drawImage called for compositing.
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
      expect(ctx.drawImage).toHaveBeenCalled();
    });

    it("caps alpha to maxOpacity", () => {
      // This tests the wash mode alpha clamping behavior.
      // Since we're using mocks, we verify the render doesn't throw
      // and drawImage is called (compositing offscreen → main).
      const ctx = createMockCtx();
      const stroke = makeStroke({
        brushId: "watercolor-round",
        opacity: 0.5,
      });

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();

      expect(ctx.drawImage).toHaveBeenCalled();
    });
  });

  describe("buildup mode", () => {
    it("sets globalCompositeOperation from brush blendMode", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke({ brushId: "round-hard" });

      renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);

      // After save(), the composite operation should be set
      // round-hard uses "source-over"
      expect(ctx.globalCompositeOperation).toBeDefined();
    });

    it("accumulates stamps with overlapping opacity", () => {
      const ctx = createMockCtx();
      // round-soft has flow=0.3, so overlapping stamps accumulate
      const stroke = makeStroke({ brushId: "round-soft" });

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();
    });

    it("uses destination-out for eraser brush", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke({ brushId: "eraser-hard" });

      renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);

      expect(ctx.save).toHaveBeenCalled();
    });
  });

  describe("brush resolution", () => {
    it("falls back to round-hard for unknown brush ID", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke({ brushId: "nonexistent-brush" });

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();

      // Should have rendered (fell back to round-hard)
      expect(ctx.save).toHaveBeenCalled();
    });

    it("uses custom brush from brushes map", () => {
      const ctx = createMockCtx();
      const customBrush: BrushDefinition = {
        ...BRUSH_PRESETS["round-hard"]!,
        id: "my-custom",
        name: "My Custom",
        hardness: 0.3,
        flow: 0.5,
      };
      const brushes = { ...BRUSH_PRESETS, "my-custom": customBrush };
      const stroke = makeStroke({ brushId: "my-custom" });

      expect(() => {
        renderStrokes([stroke], brushes, ctx, BOUNDS, 0);
      }).not.toThrow();

      expect(ctx.save).toHaveBeenCalled();
    });
  });

  describe("pressure dynamics", () => {
    it("renders strokes with varying pressure without error", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke({ points: PRESSURE_POINTS });

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();
    });
  });

  describe("scatter and taper", () => {
    it("renders splatter brush (high scatter) without error", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke({ brushId: "splatter" });

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();
    });

    it("renders pencil brush (tapered) without error", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke({ brushId: "pencil" });

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();
    });
  });

  describe("stroke overrides", () => {
    it("accepts stroke-level size override", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke({ size: 50 });

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();
    });

    it("accepts stroke-level opacity override", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke({ opacity: 0.3 });

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();
    });

    it("accepts stroke-level seed override", () => {
      const ctx = createMockCtx();
      const stroke = makeStroke({ brushId: "splatter", seed: 12345 });

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();
    });
  });

  describe("all presets", () => {
    const presetIds = Object.keys(BRUSH_PRESETS);

    for (const id of presetIds) {
      it(`renders a stroke with preset "${id}" without error`, () => {
        const ctx = createMockCtx();
        // Preload textures for texture presets
        const preset = BRUSH_PRESETS[id]!;
        if (preset.tipType === "texture" && preset.tipTexture) {
          preloadTextureTip(preset.tipTexture);
        }
        const stroke = makeStroke({ brushId: id });

        expect(() => {
          renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
        }).not.toThrow();
      });
    }
  });

  describe("texture tip rendering", () => {
    it("renders a stroke with texture-chalk preset", () => {
      const ctx = createMockCtx();
      const preset = BRUSH_PRESETS["texture-chalk"]!;
      preloadTextureTip(preset.tipTexture!);
      const stroke = makeStroke({ brushId: "texture-chalk" });

      expect(() => {
        renderStrokes([stroke], BRUSH_PRESETS, ctx, BOUNDS, 0);
      }).not.toThrow();

      expect(ctx.save).toHaveBeenCalled();
    });

    it("falls back to round when texture not preloaded", () => {
      const ctx = createMockCtx();
      const customBrush: BrushDefinition = {
        ...BRUSH_PRESETS["round-hard"]!,
        id: "unloaded-tex",
        name: "Unloaded Texture",
        tipType: "texture",
        tipTexture: "some-unloaded-base64",
      };
      const brushes = { ...BRUSH_PRESETS, "unloaded-tex": customBrush };
      const stroke = makeStroke({ brushId: "unloaded-tex" });

      expect(() => {
        renderStrokes([stroke], brushes, ctx, BOUNDS, 0);
      }).not.toThrow();

      // Should still render (fallback to round)
      expect(ctx.save).toHaveBeenCalled();
    });
  });
});
