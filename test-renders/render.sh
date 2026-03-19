#!/usr/bin/env bash
# Render painting plugin test images using the genart CLI.
# Usage: bash test-renders/render.sh

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

CLI="${GENART_CLI:-node $HOME/genart-dev/cli/dist/index.js}"

echo "Rendering medium-comparison..."
$CLI render "$DIR/medium-comparison.genart" -o "$DIR/medium-comparison.png"

echo "Rendering fill-styles..."
$CLI render "$DIR/fill-styles.genart" -o "$DIR/fill-styles.png"

echo "Rendering brush-preset-gallery..."
$CLI render "$DIR/brush-preset-gallery.genart" -o "$DIR/brush-preset-gallery.png"

echo "Rendering stroke-demos..."
$CLI render "$DIR/stroke-demos.genart" -o "$DIR/stroke-demos.png"

echo "Rendering algorithm-bridge..."
$CLI render "$DIR/algorithm-bridge.genart" -o "$DIR/algorithm-bridge.png" --wait 2s

echo "Rendering algorithm-bridge-multi-layer..."
$CLI render "$DIR/algorithm-bridge-multi-layer.genart" -o "$DIR/algorithm-bridge-multi-layer.png" --wait 2s

echo "Rendering algorithm-bridge-shading..."
$CLI render "$DIR/algorithm-bridge-shading.genart" -o "$DIR/algorithm-bridge-shading.png" --wait 2s

echo "Rendering algorithm-bridge-combined..."
$CLI render "$DIR/algorithm-bridge-combined.genart" -o "$DIR/algorithm-bridge-combined.png" --wait 2s

echo "Rendering algorithm-bridge-accumulative (p5, ~15s accumulation)..."
$CLI render "$DIR/algorithm-bridge-accumulative.genart" -o "$DIR/algorithm-bridge-accumulative.png" --wait 15s

echo "Rendering algorithm-bridge-accumulative-layered (p5 + design layers, ~15s)..."
$CLI render "$DIR/algorithm-bridge-accumulative-layered.genart" -o "$DIR/algorithm-bridge-accumulative-layered.png" --wait 15s

echo "Rendering oklab-color-mixing (painting v2 — Oklab pigment mixing)..."
$CLI render "$DIR/oklab-color-mixing.genart" -o "$DIR/oklab-color-mixing.png"
echo "Rendering directional-light (painting v2 — light angles on impasto)..."
$CLI render "$DIR/directional-light.genart" -o "$DIR/directional-light.png"
echo "Rendering atmospheric-perspective (painting v2 — horizon depth)..."
$CLI render "$DIR/atmospheric-perspective.genart" -o "$DIR/atmospheric-perspective.png"
echo "Rendering wet-on-wet (painting v2 — wet paint mixing)..."
$CLI render "$DIR/wet-on-wet.genart" -o "$DIR/wet-on-wet.png"
echo "Rendering scene-over-layers (painting v2 — paint scene)..."
$CLI render "$DIR/scene-over-layers.genart" -o "$DIR/scene-over-layers.png"
echo "Done. Output in $DIR/"
