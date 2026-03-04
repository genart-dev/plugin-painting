import type { DesignPlugin, PluginContext } from "@genart-dev/core";
import { watercolorLayerType } from "./watercolor.js";
import { inkLayerType } from "./ink.js";
import { charcoalLayerType } from "./charcoal.js";
import { oilAcrylicLayerType } from "./oil-acrylic.js";
import { gouacheLayerType } from "./gouache.js";
import { pastelLayerType } from "./pastel.js";
import { paintingMcpTools } from "./painting-tools.js";

const paintingPlugin: DesignPlugin = {
  id: "painting",
  name: "Painting",
  version: "0.1.0",
  tier: "pro",
  description:
    "Vector-field-driven painting layer types: watercolor, oil, gouache, ink, pastel, charcoal.",

  layerTypes: [
    watercolorLayerType,
    inkLayerType,
    charcoalLayerType,
    oilAcrylicLayerType,
    gouacheLayerType,
    pastelLayerType,
  ],
  tools: [],
  exportHandlers: [],
  mcpTools: paintingMcpTools,

  async initialize(_context: PluginContext): Promise<void> {},
  dispose(): void {},
};

export default paintingPlugin;
export { watercolorLayerType } from "./watercolor.js";
export { inkLayerType } from "./ink.js";
export { charcoalLayerType } from "./charcoal.js";
export { oilAcrylicLayerType } from "./oil-acrylic.js";
export { gouacheLayerType } from "./gouache.js";
export { pastelLayerType } from "./pastel.js";
export { paintingMcpTools } from "./painting-tools.js";
export {
  type VectorField,
  type VectorSample,
  noiseField,
  linearField,
  radialField,
  vortexField,
  parseField,
  sampleField,
  divergenceAt,
  curlAt,
  applyVerticalMask,
} from "./vector-field.js";
export { renderDebugOverlay, type DebugMode } from "./debug-overlay.js";
