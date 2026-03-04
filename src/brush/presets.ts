import type { BrushDefinition } from "./types.js";

/**
 * Default values shared across all presets.
 * Presets override only the properties that differ.
 */
const BASE: BrushDefinition = {
  id: "",
  name: "",
  tipType: "round",
  hardness: 1.0,
  roundness: 1.0,
  angle: 0,
  size: 20,
  sizeMin: 0,
  opacity: 1.0,
  flow: 1.0,
  spacing: 0.05,
  scatter: 0,
  scatterAlongPath: 0,
  dynamics: {},
  taperStart: 0,
  taperEnd: 0,
  grainScale: 1,
  grainDepth: 0,
  grainMode: "moving",
  blendMode: "source-over",
  renderMode: "buildup",
  smoothing: 0.5,
};

function preset(overrides: Partial<BrushDefinition> & { id: string; name: string }): BrushDefinition {
  return { ...BASE, ...overrides };
}

// ---------------------------------------------------------------------------
// Embedded 32×32 textures (base64-encoded PNGs)
// ---------------------------------------------------------------------------

/** Noisy grain pattern — rough chalk mark with irregular edges. */
const TEXTURE_CHALK =
  "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";

/** Porous cluster pattern — dotted sponge dab texture. */
const TEXTURE_SPONGE =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAAEZ0lEQVRYha1XzUr7ThQ9ST8Xbdrqa/gIFcSdUFEQ7MqV0I2LgmC1WJvEQoUKguhK1L0uirgWd30A130GW5u6SMzH/BfljjNJ/PrzG7hkMknuOffMnTsTBQDDH5phGFAUhRsAMMa4GYbxF3dQfkOAgADg5OSEg3c6Hem9w8NDBEEA3/fh+/6vyHxLQASmls/n0el0cHR0FPuNruucgOd58DwPpmn+nUAcOABomvalMwDodrsSuOd5cF0Xuq7/nsBP4JZloVAoRJ4zNnPV6/UiBD4+PtButyPfqOGBfD7/ZXQ094VCQUpEIkz9TCbDLZ1Oczs+Pv5eAdM0kclk0Gw2pZco2q+UAYC3tzcAwP39vRQ5RU9Xx3Gk6eAK6LqOVCqFVCqFfD4PTdOgaVoEnKK8u7vjfQIvlUqo1WqRyNPpNPedSqUkAlyBTqcjSbe/vx+Rl1q/34eqqlAUBevr63yccgAAbm5u4LouarUaH2eModVqwXEcvopUYFZcksmkZJeXl58sBRKPj4+cZDabjc2B8XiM7e1tVKtVTCYTWJYFy7IAgPunGpEEgEQiESFxe3uLdDrNJSUJ6X1FUfD8/Izl5WWpKs7NzUlqUJtOp0gmk/A8D4lEIkpANCIhzh2RoGflchkAMBgMUC6XwRiDoij8WiqVMB6PJRIiBgCohmFAVVVuPxEhRRYXF7nkYn80Gn1bR0QswzCg0ofigzCZtbU1rKyscCLpdBovLy+xdUBspEKxWOS1g3xz3HBBCZPZ2NjgjpeWljiJTCaD4XCI4XAYAR+NRhiPxxiNRrGJLGHFERDt4eGBfzgYDLgyyWSSrwYiAQDz8/OSCmIOXFxcYG9vD61W6xOj0+mwbDaLn4yWXXgMABzHgW3bWFhYkNb86+srBy8Wi9K5gTGGRqOBZHgwzoIgkPq021HzPA++7/N7IkHLMbwkp9MpgNmmFUugVqtxifr9vgSaSCSgqioHBgDf9+G6rgQSBqV7Kkg0lhQjIxMbHS6IAIEHQSD1Pc+LRBtHQtM0TCYTPqYahiGBh6WM29kcx+Hzbts2v396eooAM8ZwdXXF7y3L4uq+v7/PNiPaiCixwvv5d6WYQEgl13WxurrKSVxfX3OC9XodjDFMp1PkcrlZaRZlpjkmEwsGAQVBwJ+JUxAEASqViqQAYwyu63IVu90uJ+M4zqwSArPdUDxCiZKHZRdNnIJKpSLlAF3JR9i/tBsCkKKPi5wxhq2tLani3d3dAQCq1Wok8ei6s7ODXq8XIcGTkDqmaUaiFs1xHIkMYwybm5uwbVsaiyNBRzIy8ZguHUp1XeeAIgmSPAwEALZtR4jF5QH5Ch/PI6fidrstRd5oNLC7u4t6vY7JZCI5ZozBtm2cn59HSIhkyNevjuVEQoyanNORnZyfnp7yRAwTo/7BwQEcx4kFB374NdN1HWdnZ58vKwpM0/wySYMggK7rnECj0fj/v2Ziy+VyUBQFzWZTAo/7O/6nP6dx7V//nv8H1jDqZH4nun8AAAAASUVORK5CYII=";

/** Parallel streak pattern — multi-hair bristle brush. */
const TEXTURE_BRISTLE =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAADTklEQVRYhcWX2Y7jKhCGfzCLlySdjvL+T9jqTmexzWKYixEI2+U+PjM6Oki5CFX8/moBbAYg4i+GUgqcczjnME3Tv17P9zgxxtC2Ldq2BWNsZuu6DtfrFU3TAACEEFBKrfz+CqCua1yvV3RdRwJcLhc0TQPGGKSUOBwOqOt6F8QugKZpcLlcSIC2bfH+/p4fKIRA13UZ6J+G2AOgtcb5fIa1dmVr2xbn83kF4L3/swxUVUUCvL29kVHVdY3T6QSt9e+IhEDTNNBag/O5vBDreGceVVVBSkkCnE4nsq51XeN4PObGKwGWvlprDJqhlmJU2qSUOB6PpF1rjcPhAKVUDkJrDSnlylcphaZpYK1FjHGeAaUUlFJkmqSU6LouP2Qp2rZtfiDnfBMg7ZC2bfMcBwDOeQagekBKiaZpyP2dokrgVVVBKbUJkM6TGUCKQEpJAqS6Uv0hpURd1xkgBUNlMumU/gLAbAtRx2mqKyWabFVV5RIIIfL/JUBd1/n4BgDBGINSCiEEVFW12jopqpQdSrTMHGPsR51U6mTnSZxzDs45uQvKqLZsSbAEWGol39Kflwu2AJLPFlxpS2X4ybf052lBWkwNxlj+bdn3zCWI0rbrMvovB48xIoQAAPl0Wo4YY/5t2ffMAUAIYWbjMUZM04QQwspYik3TRNpCCDNbCugn39KfhxDgnPsRIIQA7z15RiRbmcUU0FIr+Zb+IsYIay0YY3kh9ZD0zrcU9d7P3gdLAErHWgtrbbZzABjHMZNRUU7TBGMMvPebtgRXZouCHcdxDdD3PZxzm2+23nsMwwDn3MrmnMsBlFFSsEmn9BflIikl2QPOOQzDMLvH07DWYhiGLDhNE6y1cM6tfJ1z6Psefd/nOVEKUVdoWvh6vch3QmttzmAqgTFmE+D5fNIAwO9eoK5c5xwejwfGcVyJGmPwfD4zXOoJCiCVppyfAWx92RhjcL/fSYBxHPF4PHJ5Up2NMSTssjdWRzEFYYzB9/c3hmEgAe73O4wxADADWG5FqjF33QXGGNxut1nt0uj7HrfbLWfHe4/X60VmgBq7PkyGYcDn5yeZgb7v8fX1tQKgfP8YYBxHfHx8AFhfMq/XK0PGGPNZQjUhNRj+58/zX0sylNa0uk4VAAAAAElFTkSuQmCC";

/** All built-in brush presets keyed by ID. */
export const BRUSH_PRESETS: Readonly<Record<string, BrushDefinition>> = {
  "round-hard": preset({
    id: "round-hard",
    name: "Round Hard",
    hardness: 1.0,
    roundness: 1.0,
    spacing: 0.05,
    flow: 1.0,
    renderMode: "buildup",
    dynamics: { size: true, opacity: true },
  }),

  "round-soft": preset({
    id: "round-soft",
    name: "Round Soft",
    hardness: 0.0,
    roundness: 1.0,
    spacing: 0.08,
    flow: 0.3,
    renderMode: "buildup",
    dynamics: { size: true, opacity: true },
  }),

  flat: preset({
    id: "flat",
    name: "Flat",
    hardness: 0.9,
    roundness: 0.3,
    spacing: 0.08,
    flow: 1.0,
    renderMode: "buildup",
    dynamics: { size: true },
  }),

  pencil: preset({
    id: "pencil",
    name: "Pencil",
    hardness: 0.85,
    roundness: 1.0,
    spacing: 0.03,
    flow: 0.6,
    renderMode: "buildup",
    dynamics: { size: true, opacity: [0.4, 1.0] },
    taperStart: 4,
    taperEnd: 4,
  }),

  "ink-pen": preset({
    id: "ink-pen",
    name: "Ink Pen",
    hardness: 1.0,
    roundness: 1.0,
    spacing: 0.02,
    flow: 1.0,
    renderMode: "wash",
    dynamics: { size: true },
    smoothing: 0.8,
    taperStart: 6,
    taperEnd: 6,
  }),

  marker: preset({
    id: "marker",
    name: "Marker",
    hardness: 0.7,
    roundness: 0.8,
    spacing: 0.06,
    flow: 0.4,
    renderMode: "wash",
    dynamics: {},
  }),

  "watercolor-round": preset({
    id: "watercolor-round",
    name: "Watercolor Round",
    hardness: 0.0,
    roundness: 1.0,
    spacing: 0.1,
    flow: 0.15,
    renderMode: "wash",
    dynamics: { size: true, opacity: true },
    smoothing: 0.7,
  }),

  "charcoal-stick": preset({
    id: "charcoal-stick",
    name: "Charcoal Stick",
    hardness: 0.5,
    roundness: 0.6,
    spacing: 0.04,
    flow: 0.7,
    renderMode: "buildup",
    dynamics: { size: true, opacity: [0.3, 1.0] },
    angle: 30,
  }),

  splatter: preset({
    id: "splatter",
    name: "Splatter",
    hardness: 0.8,
    roundness: 1.0,
    spacing: 0.4,
    flow: 0.8,
    renderMode: "buildup",
    scatter: 1.5,
    scatterAlongPath: 0.5,
    dynamics: { size: [0.5, 1.5], scatter: true },
  }),

  "eraser-hard": preset({
    id: "eraser-hard",
    name: "Eraser Hard",
    hardness: 1.0,
    roundness: 1.0,
    spacing: 0.05,
    flow: 1.0,
    renderMode: "buildup",
    blendMode: "destination-out",
    dynamics: { size: true },
  }),

  "eraser-soft": preset({
    id: "eraser-soft",
    name: "Eraser Soft",
    hardness: 0.0,
    roundness: 1.0,
    spacing: 0.08,
    flow: 0.5,
    renderMode: "buildup",
    blendMode: "destination-out",
    dynamics: { size: true, opacity: true },
  }),

  // -------------------------------------------------------------------------
  // Texture tip presets
  // -------------------------------------------------------------------------

  "texture-chalk": preset({
    id: "texture-chalk",
    name: "Chalk",
    tipType: "texture",
    tipTexture: TEXTURE_CHALK,
    roundness: 1.0,
    spacing: 0.06,
    flow: 0.7,
    renderMode: "buildup",
    dynamics: { size: true, opacity: [0.4, 1.0] },
  }),

  "texture-sponge": preset({
    id: "texture-sponge",
    name: "Sponge",
    tipType: "texture",
    tipTexture: TEXTURE_SPONGE,
    roundness: 1.0,
    spacing: 0.15,
    flow: 0.6,
    renderMode: "buildup",
    dynamics: { opacity: true },
  }),

  "texture-bristle": preset({
    id: "texture-bristle",
    name: "Bristle",
    tipType: "texture",
    tipTexture: TEXTURE_BRISTLE,
    roundness: 0.7,
    spacing: 0.04,
    flow: 0.8,
    renderMode: "buildup",
    dynamics: { size: true, opacity: [0.5, 1.0] },
    smoothing: 0.6,
  }),
};

/** Look up a built-in brush preset by ID. */
export function getBrushPreset(id: string): BrushDefinition | undefined {
  return BRUSH_PRESETS[id];
}
