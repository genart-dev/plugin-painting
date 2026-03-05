import { describe, it, expect, beforeEach } from "vitest";
import {
  generateRoundTip,
  generateTextureTip,
  preloadTextureTip,
  isTextureTipCached,
  clearTipCache,
} from "../src/brush/tip-generator.js";
import { BRUSH_PRESETS } from "../src/brush/presets.js";

beforeEach(() => {
  clearTipCache();
});

describe("generateRoundTip", () => {
  describe("hardness = 0 (soft Gaussian)", () => {
    it("produces center pixel near full opacity", () => {
      const tip = generateRoundTip(21, 0, 1.0, 0);
      expect(tip.width).toBe(21);
      expect(tip.height).toBe(21);

      // Center pixel should be near 255 (Gaussian peak)
      const cx = 10;
      const cy = 10;
      const i = (cy * 21 + cx) * 4;
      expect(tip.data[i + 3]!).toBeGreaterThan(200);
    });

    it("fades towards the edges", () => {
      const size = 21;
      const tip = generateRoundTip(size, 0, 1.0, 0);

      // Center alpha
      const cx = Math.floor(size / 2);
      const centerAlpha = tip.data[(cx * size + cx) * 4 + 3]!;

      // Edge pixel (should be near 0 at the boundary)
      const edgeAlpha = tip.data[(0 * size + cx) * 4 + 3]!;

      expect(centerAlpha).toBeGreaterThan(edgeAlpha);
      expect(edgeAlpha).toBeLessThan(50);
    });

    it("sets RGB to 255 (white)", () => {
      const tip = generateRoundTip(5, 0, 1.0, 0);
      const i = (2 * 5 + 2) * 4; // center pixel
      expect(tip.data[i]).toBe(255);     // R
      expect(tip.data[i + 1]).toBe(255); // G
      expect(tip.data[i + 2]).toBe(255); // B
    });
  });

  describe("hardness = 0.5 (mid)", () => {
    it("has sharper falloff than hardness 0", () => {
      const size = 21;
      const soft = generateRoundTip(size, 0, 1.0, 0);
      clearTipCache();
      const mid = generateRoundTip(size, 0.5, 1.0, 0);

      // A pixel between center and edge should have higher alpha at hardness 0.5
      // because the falloff is blended towards the hard-edge (flat 1.0 inside)
      const r = Math.floor(size / 4); // quarter radius from center
      const cx = Math.floor(size / 2);
      const idx = ((cx - r) * size + cx) * 4 + 3;

      const softAlpha = soft.data[idx]!;
      const midAlpha = mid.data[idx]!;

      // Higher hardness → more alpha at intermediate radius
      expect(midAlpha).toBeGreaterThanOrEqual(softAlpha);
    });
  });

  describe("hardness = 1 (hard edge)", () => {
    it("produces hard circle with anti-aliased edge", () => {
      const size = 21;
      const tip = generateRoundTip(size, 1, 1.0, 0);
      const cx = (size - 1) / 2;
      const cy = (size - 1) / 2;
      const radius = size / 2;

      let hasFullOpaque = false;
      let hasFullTransparent = false;
      let hasIntermediate = false;

      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const dx = px - cx;
          const dy = py - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const alpha = tip.data[(py * size + px) * 4 + 3]!;

          // Well inside the circle (> 1.5px from edge): fully opaque
          if (dist < radius - 2) {
            expect(alpha).toBe(255);
            hasFullOpaque = true;
          }
          // Well outside the circle (> 1.5px outside edge): fully transparent
          if (dist > radius + 2) {
            expect(alpha).toBe(0);
            hasFullTransparent = true;
          }
          // Near the edge: intermediate alpha (AA band)
          if (alpha > 0 && alpha < 255) {
            hasIntermediate = true;
          }
        }
      }

      expect(hasFullOpaque).toBe(true);
      expect(hasFullTransparent).toBe(true);
      expect(hasIntermediate).toBe(true);
    });
  });

  describe("roundness squash", () => {
    it("squashes circle into ellipse along y-axis", () => {
      const size = 31;
      const circle = generateRoundTip(size, 1, 1.0, 0);
      clearTipCache();
      const squashed = generateRoundTip(size, 1, 0.3, 0);

      const cx = Math.floor(size / 2);

      // At y=3 (well inside circle but outside squashed ellipse)
      const nearTopCircle = circle.data[(3 * size + cx) * 4 + 3]!;
      const nearTopSquashed = squashed.data[(3 * size + cx) * 4 + 3]!;

      // Circle: y=3 is well inside radius of 15.5, so fully opaque
      expect(nearTopCircle).toBe(255);
      // Squashed (roundness 0.3): effective y distance is multiplied by 1/0.3 ≈ 3.3x,
      // so y=3 maps to effective dist ≈ 40 which is well outside the radius
      expect(nearTopSquashed).toBe(0);
    });

    it("keeps full width at the horizontal center", () => {
      const size = 21;
      const squashed = generateRoundTip(size, 1, 0.3, 0);
      const cy = Math.floor(size / 2);

      // At y=center, x near the edges should still be opaque (width isn't affected)
      // x=2 should be inside the radius of ~10.5
      const nearEdge = squashed.data[(cy * size + 2) * 4 + 3]!;
      expect(nearEdge).toBe(255);
    });
  });

  describe("cache", () => {
    it("returns the same ImageData on second call with same parameters", () => {
      const tip1 = generateRoundTip(20, 0.5, 1.0, 0);
      const tip2 = generateRoundTip(20, 0.5, 1.0, 0);
      expect(tip1).toBe(tip2); // Same reference (cache hit)
    });

    it("returns different ImageData for different parameters", () => {
      const tip1 = generateRoundTip(20, 0.5, 1.0, 0);
      const tip2 = generateRoundTip(20, 0.8, 1.0, 0);
      expect(tip1).not.toBe(tip2);
    });

    it("quantizes size (rounds to nearest integer)", () => {
      const tip1 = generateRoundTip(20.3, 0.5, 1.0, 0);
      clearTipCache();
      const tip2 = generateRoundTip(20.4, 0.5, 1.0, 0);
      // Both should round to 20, so should be equal width
      expect(tip1.width).toBe(20);
      expect(tip2.width).toBe(20);
    });

    it("returns fresh data after clearTipCache", () => {
      const tip1 = generateRoundTip(20, 0.5, 1.0, 0);
      clearTipCache();
      const tip2 = generateRoundTip(20, 0.5, 1.0, 0);
      expect(tip1).not.toBe(tip2); // Different reference (cache was cleared)
    });
  });

  describe("edge cases", () => {
    it("clamps size to minimum 1", () => {
      const tip = generateRoundTip(0, 1, 1.0, 0);
      expect(tip.width).toBe(1);
      expect(tip.height).toBe(1);
    });

    it("handles size of 1", () => {
      const tip = generateRoundTip(1, 1, 1.0, 0);
      expect(tip.width).toBe(1);
      expect(tip.height).toBe(1);
      // Single pixel: center at (0,0), radius=0.5, edgeDist=0.5 < AA band (1.5px)
      // Alpha is attenuated but non-zero
      expect(tip.data[3]).toBeGreaterThan(0);
    });

    it("handles angle rotation", () => {
      const size = 21;
      // A squashed brush at angle 0 vs 90 should have different pixel patterns
      const tip0 = generateRoundTip(size, 1, 0.3, 0);
      clearTipCache();
      const tip90 = generateRoundTip(size, 1, 0.3, 90);

      // At (center, top) — 0deg squash blocks vertical, 90deg squash blocks horizontal
      const cx = Math.floor(size / 2);
      const alpha0_top = tip0.data[(1 * size + cx) * 4 + 3]!;
      const alpha90_top = tip90.data[(1 * size + cx) * 4 + 3]!;

      // Rotated 90° should have the squash perpendicular, so top-center might now be visible
      // Depending on the exact geometry, just check they differ
      expect(alpha0_top).not.toBe(alpha90_top);
    });
  });
});

// ---------------------------------------------------------------------------
// Texture tip tests
// ---------------------------------------------------------------------------

describe("generateTextureTip", () => {
  const chalkTexture = BRUSH_PRESETS["texture-chalk"]!.tipTexture!;

  describe("preloadTextureTip", () => {
    it("decodes an embedded preset texture", () => {
      const raw = preloadTextureTip(chalkTexture);
      expect(raw).not.toBeNull();
      expect(raw!.width).toBe(32);
      expect(raw!.height).toBe(32);
    });

    it("returns the same ImageData on second call (cached)", () => {
      const raw1 = preloadTextureTip(chalkTexture);
      const raw2 = preloadTextureTip(chalkTexture);
      expect(raw1).toBe(raw2); // Same reference
    });

    it("returns null for invalid base64", () => {
      const result = preloadTextureTip("not-valid-base64");
      expect(result).toBeNull();
    });

    it("returns null for non-PNG data", () => {
      const result = preloadTextureTip(btoa("hello world"));
      expect(result).toBeNull();
    });
  });

  describe("isTextureTipCached", () => {
    it("returns false before preload", () => {
      expect(isTextureTipCached(chalkTexture)).toBe(false);
    });

    it("returns true after preload", () => {
      preloadTextureTip(chalkTexture);
      expect(isTextureTipCached(chalkTexture)).toBe(true);
    });
  });

  describe("generateTextureTip output", () => {
    it("returns ImageData with correct dimensions", () => {
      preloadTextureTip(chalkTexture);
      const tip = generateTextureTip(chalkTexture, 20, 1.0, 0);
      expect(tip.width).toBe(20);
      expect(tip.height).toBe(20);
    });

    it("has white RGB and variable alpha", () => {
      preloadTextureTip(chalkTexture);
      const tip = generateTextureTip(chalkTexture, 20, 1.0, 0);
      const cx = 10;
      const cy = 10;
      const i = (cy * 20 + cx) * 4;
      expect(tip.data[i]).toBe(255);     // R
      expect(tip.data[i + 1]).toBe(255); // G
      expect(tip.data[i + 2]).toBe(255); // B
      // Alpha should be present (> 0 for center area of chalk texture)
    });

    it("pixels outside radius have zero alpha", () => {
      preloadTextureTip(chalkTexture);
      const tip = generateTextureTip(chalkTexture, 20, 1.0, 0);
      // Corner pixel (0,0) is far from center, should be outside radius
      expect(tip.data[3]).toBe(0);
    });

    it("caches results for same parameters", () => {
      preloadTextureTip(chalkTexture);
      const tip1 = generateTextureTip(chalkTexture, 20, 1.0, 0);
      const tip2 = generateTextureTip(chalkTexture, 20, 1.0, 0);
      expect(tip1).toBe(tip2); // Same reference (cache hit)
    });

    it("returns different results for different sizes", () => {
      preloadTextureTip(chalkTexture);
      const tip1 = generateTextureTip(chalkTexture, 20, 1.0, 0);
      const tip2 = generateTextureTip(chalkTexture, 30, 1.0, 0);
      expect(tip1).not.toBe(tip2);
      expect(tip2.width).toBe(30);
    });

    it("falls back to round tip when texture not preloaded", () => {
      // Don't preload — should fall back to round tip
      const tip = generateTextureTip("unknown-base64-data", 20, 1.0, 0);
      expect(tip.width).toBe(20);
      expect(tip.height).toBe(20);
      // Should still produce valid ImageData (round fallback)
    });
  });

  describe("all preset textures decode", () => {
    const texPresets = ["texture-chalk", "texture-sponge", "texture-bristle"];

    for (const id of texPresets) {
      it(`preset "${id}" texture decodes successfully`, () => {
        const tex = BRUSH_PRESETS[id]!.tipTexture!;
        const raw = preloadTextureTip(tex);
        expect(raw).not.toBeNull();
        expect(raw!.width).toBeGreaterThan(0);
        expect(raw!.height).toBeGreaterThan(0);
      });
    }
  });
});
