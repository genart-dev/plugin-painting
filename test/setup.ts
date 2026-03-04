/**
 * Vitest setup: polyfill ImageData for Node.js.
 * The brush tip generator and stamp renderer use ImageData directly.
 */

if (typeof globalThis.ImageData === "undefined") {
  (globalThis as Record<string, unknown>).ImageData = class ImageData {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    readonly colorSpace: PredefinedColorSpace = "srgb";

    constructor(sw: number, sh: number);
    constructor(data: Uint8ClampedArray, sw: number, sh?: number);
    constructor(
      swOrData: number | Uint8ClampedArray,
      shOrSw: number,
      sh?: number,
    ) {
      if (swOrData instanceof Uint8ClampedArray) {
        this.data = swOrData;
        this.width = shOrSw;
        this.height = sh ?? (swOrData.length / 4 / shOrSw);
      } else {
        this.width = swOrData;
        this.height = shOrSw;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  };
}
