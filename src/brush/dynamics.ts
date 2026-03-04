import type { DynamicMapping } from "./types.js";

/**
 * Evaluate a pressure-mapped dynamic value.
 *
 * @param pressure - Current pen pressure 0–1.
 * @param dynamic - The dynamic mapping:
 *   - `undefined` → return `baseValue` unchanged.
 *   - `true` → linear: `baseValue * pressure`.
 *   - `[min, max]` → `baseValue * lerp(min, max, pressure)`.
 * @param baseValue - The brush property's base value.
 * @returns The modulated value.
 */
export function evaluateDynamic(
  pressure: number,
  dynamic: DynamicMapping,
  baseValue: number,
): number {
  if (dynamic === undefined) return baseValue;

  if (dynamic === true) {
    return baseValue * pressure;
  }

  if (dynamic === false) return baseValue;

  // [min, max] range
  const [min, max] = dynamic;
  return baseValue * (min + (max - min) * pressure);
}
