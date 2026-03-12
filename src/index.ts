import type { DesignPlugin, PluginContext } from "@genart-dev/core";
import { watercolorLayerType } from "./watercolor.js";
import { inkLayerType } from "./ink.js";
import { charcoalLayerType } from "./charcoal.js";
import { oilAcrylicLayerType } from "./oil-acrylic.js";
import { gouacheLayerType } from "./gouache.js";
import { pastelLayerType } from "./pastel.js";
import { strokeLayerType } from "./stroke-layer.js";
import { fillLayerType } from "./fill-layer.js";
import { markFieldLayerType } from "./mark-field.js";
import { flowLinesLayerType } from "./flow-lines.js";
import { paintingMcpTools } from "./painting-tools.js";

const paintingPlugin: DesignPlugin = {
  id: "painting",
  name: "Painting",
  version: "0.1.0",
  tier: "pro",
  description:
    "Vector-field-driven painting layer types: watercolor, oil, gouache, ink, pastel, charcoal, brush stroke, fill, mark field, flow lines.",

  layerTypes: [
    watercolorLayerType,
    inkLayerType,
    charcoalLayerType,
    oilAcrylicLayerType,
    gouacheLayerType,
    pastelLayerType,
    strokeLayerType,
    fillLayerType,
    markFieldLayerType,
    flowLinesLayerType,
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
export { strokeLayerType } from "./stroke-layer.js";
export { fillLayerType } from "./fill-layer.js";
export { markFieldLayerType } from "./mark-field.js";
export { flowLinesLayerType } from "./flow-lines.js";
export { paintingMcpTools } from "./painting-tools.js";
export {
  type FillRegion,
  type FillStrategy,
  type ShadingFunction,
  type ShadingAffect,
} from "./fill/types.js";
export { FILL_PRESETS, getFillPreset } from "./fill/presets.js";
export {
  type BrushDefinition,
  type BrushStroke,
  type StrokePoint,
} from "./brush/types.js";
export { BRUSH_PRESETS, getBrushPreset } from "./brush/presets.js";
export {
  generateRoundTip,
  generateTextureTip,
  preloadTextureTip,
  isTextureTipCached,
  clearTipCache,
} from "./brush/tip-generator.js";
export {
  type AlgorithmPathPoint,
  type AlgorithmStrokePath,
  type PathConversionOptions,
  parsePathSource,
  convertPathsToStrokes,
} from "./path-source.js";
export {
  type DepthRange,
  type DepthMapping,
  applyDepthMapping,
  parseDepthMapping,
} from "./depth-mapping.js";
export {
  type VectorField,
  type VectorSample,
  noiseField,
  linearField,
  radialField,
  vortexField,
  convertAlgorithmData,
  parseField,
  sampleField,
  divergenceAt,
  curlAt,
  applyVerticalMask,
} from "./vector-field.js";
export { renderDebugOverlay, type DebugMode } from "./debug-overlay.js";
