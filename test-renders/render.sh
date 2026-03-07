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

echo "Done. Output in $DIR/"
