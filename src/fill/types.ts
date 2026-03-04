/**
 * Types for the painting:fill layer system (ADR 034).
 *
 * A FillRegion defines where marks are generated and clipped.
 * A FillStrategy determines what kind of marks are generated.
 * A ShadingFunction controls how density/weight/opacity vary spatially.
 */

// ---------------------------------------------------------------------------
// Region
// ---------------------------------------------------------------------------

export type FillRegion =
  | { type: "rect"; x: number; y: number; width: number; height: number }
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "polygon"; points: Array<{ x: number; y: number }> }
  | { type: "bounds" };

// ---------------------------------------------------------------------------
// Fill strategies
// ---------------------------------------------------------------------------

export interface HatchFill {
  type: "hatch";
  /** Line angle in degrees. 0 = horizontal, 90 = vertical. Default 45 */
  angle: number;
  /** Distance between lines in px. Default 8 */
  spacing: number;
}

export interface CrosshatchFill {
  type: "crosshatch";
  /** Array of angles for each hatch pass. Default [45, 135] */
  angles: number[];
  /** Distance between lines per pass. Default 8 */
  spacing: number;
  /**
   * Opacity multiplier per successive pass. Default 0.7
   * Pass 0 = full opacity, pass 1 = 0.7×, pass 2 = 0.49×, etc.
   */
  passDecay: number;
}

export interface StippleFill {
  type: "stipple";
  /** Average dots per 100×100px area at full density. Default 40 */
  density: number;
  /** Point distribution algorithm */
  distribution: "random" | "poisson" | "jittered-grid";
}

export interface ScumbleFill {
  type: "scumble";
  /** Average strokes per 100×100px area at full density. Default 15 */
  density: number;
  /** Stroke length in px. Default 20 */
  strokeLength: number;
  /** Curvature: 0 = straight, 1 = tight curls. Default 0.5 */
  curvature: number;
}

export interface ContourFill {
  type: "contour";
  /** Distance between contour rings in px. Default 8 */
  spacing: number;
  /** Max inward offset rings. Default: fill until too small */
  maxRings?: number;
  /** Smoothing applied to offset contours. 0–1, default 0.3 */
  smoothing: number;
}

export type FillStrategy =
  | HatchFill
  | CrosshatchFill
  | StippleFill
  | ScumbleFill
  | ContourFill;

/** Preset name shorthand that expands to a full FillStrategy + brush overrides. */
export interface FillPreset {
  strategy: FillStrategy;
  brushId: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Shading
// ---------------------------------------------------------------------------

export type ShadingFunction =
  | { type: "uniform" }
  | { type: "linear"; angle: number; range: [number, number] }
  | { type: "radial"; cx: number; cy: number; range: [number, number] }
  | { type: "noise"; seed: number; scale: number; range: [number, number] };

export type ShadingAffect = "density" | "weight" | "opacity";

// ---------------------------------------------------------------------------
// Generated path (internal)
// ---------------------------------------------------------------------------

/** A generated path ready to be rendered as a BrushStroke. */
export interface GeneratedPath {
  points: Array<{ x: number; y: number }>;
  /** Per-path opacity modifier from shading. 1.0 = no modification. */
  opacityScale: number;
  /** Per-path size modifier from shading. 1.0 = no modification. */
  sizeScale: number;
}
