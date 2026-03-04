import type { FillPreset, FillStrategy } from "./types.js";

/**
 * Built-in fill presets for common illustration techniques.
 * Agents can use preset names as shorthand for strategy + brush configuration.
 */
export const FILL_PRESETS: Record<string, FillPreset> = {
  "hatch-light": {
    strategy: { type: "hatch", angle: 45, spacing: 12 },
    brushId: "ink-pen",
    size: 2,
  },
  "hatch-medium": {
    strategy: { type: "hatch", angle: 45, spacing: 8 },
    brushId: "ink-pen",
    size: 3,
  },
  "hatch-dense": {
    strategy: { type: "hatch", angle: 45, spacing: 4 },
    brushId: "ink-pen",
    size: 2,
  },
  "crosshatch-light": {
    strategy: { type: "crosshatch", angles: [45, 135], spacing: 12, passDecay: 0.7 },
    brushId: "ink-pen",
    size: 2,
  },
  "crosshatch-dense": {
    strategy: { type: "crosshatch", angles: [45, 135], spacing: 5, passDecay: 0.8 },
    brushId: "ink-pen",
    size: 2,
  },
  "stipple-light": {
    strategy: { type: "stipple", density: 15, distribution: "poisson" },
    brushId: "ink-pen",
    size: 2,
  },
  "stipple-dense": {
    strategy: { type: "stipple", density: 60, distribution: "poisson" },
    brushId: "ink-pen",
    size: 2,
  },
  scumble: {
    strategy: { type: "scumble", density: 12, strokeLength: 25, curvature: 0.5 },
    brushId: "round-hard",
    size: 3,
  },
  contour: {
    strategy: { type: "contour", spacing: 6, smoothing: 0.3 },
    brushId: "ink-pen",
    size: 2,
  },
};

/** Look up a fill preset by name. Returns undefined if not found. */
export function getFillPreset(name: string): FillPreset | undefined {
  return FILL_PRESETS[name];
}

/**
 * Resolve a strategy value: if it's a string preset name, expand it.
 * Otherwise return as-is. Returns null if the preset name is unknown.
 */
export function resolveStrategy(
  strategyOrPreset: FillStrategy | string,
): { strategy: FillStrategy; brushId?: string; size?: number } | null {
  if (typeof strategyOrPreset === "string") {
    const preset = FILL_PRESETS[strategyOrPreset];
    if (!preset) return null;
    return { strategy: preset.strategy, brushId: preset.brushId, size: preset.size };
  }
  return { strategy: strategyOrPreset };
}
