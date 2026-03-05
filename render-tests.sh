#!/usr/bin/env bash
#
# Regenerate all test-renders/ images.
#
# Sources:
#   1. examples/projects (canonical renders for brush-stroke, fill, style, abstractionist)
#   2. Standalone deliverable scripts in this repo (field demos, medium comparisons, etc.)
#
# Usage: ./render-tests.sh [--skip-build]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_RENDERS="$SCRIPT_DIR/test-renders"
EXAMPLES="$SCRIPT_DIR/../examples/projects"

mkdir -p "$TEST_RENDERS"

# --- Build plugin-painting first (unless --skip-build) ---

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "Building plugin-painting..."
  (cd "$SCRIPT_DIR" && pnpm build)
  echo ""
fi

# --- 1. Render examples/projects that depend on plugin-painting ---

EXAMPLE_PROJECTS=(
  "brush-stroke-demos"
  "blend-fill-experiments"
  "abstractionist-series"
  "style-explorer"
)

for project in "${EXAMPLE_PROJECTS[@]}"; do
  project_dir="$EXAMPLES/$project"
  if [[ -f "$project_dir/render.cjs" ]]; then
    echo "=== examples/projects/$project ==="
    (cd "$project_dir" && node render.cjs)
    echo ""
  else
    echo "SKIP: $project (no render.cjs)"
  fi
done

# --- 2. Copy example outputs into test-renders/ ---

# brush-stroke-demos → test-renders/ (01-06 + gallery)
cp "$EXAMPLES/brush-stroke-demos/renders/01-preset-catalog.png"    "$TEST_RENDERS/"
cp "$EXAMPLES/brush-stroke-demos/renders/02-pressure-dynamics.png" "$TEST_RENDERS/"
cp "$EXAMPLES/brush-stroke-demos/renders/03-calligraphy.png"       "$TEST_RENDERS/"
cp "$EXAMPLES/brush-stroke-demos/renders/04-splatter-abstract.png" "$TEST_RENDERS/"
cp "$EXAMPLES/brush-stroke-demos/renders/05-field-influence.png"   "$TEST_RENDERS/"
cp "$EXAMPLES/brush-stroke-demos/renders/06-texture-tips.png"      "$TEST_RENDERS/"
cp "$EXAMPLES/brush-stroke-demos/renders/brush-stroke-gallery.png" "$TEST_RENDERS/"

echo "Copied brush-stroke-demos renders -> test-renders/"

# blend-fill-experiments → test-renders/ (fill strategies + shading as deliverable-8 reference)
cp "$EXAMPLES/blend-fill-experiments/renders/04-fill-strategies.png" "$TEST_RENDERS/fill-strategies.png"
cp "$EXAMPLES/blend-fill-experiments/renders/05-fill-shading.png"    "$TEST_RENDERS/fill-shading.png"
cp "$EXAMPLES/blend-fill-experiments/renders/06-blend-fill-combo.png" "$TEST_RENDERS/blend-fill-combo.png"

echo "Copied blend-fill-experiments renders -> test-renders/"
echo ""

# --- 3. Run standalone deliverable scripts (unique to plugin-painting) ---

STANDALONE_SCRIPTS=(
  "render-test.cjs"
  "render-test-brushes.cjs"
  "render-test-d3.cjs"
  "render-test-d4.cjs"
  "render-test-d5.cjs"
  "render-test-d6.cjs"
  "render-test-d7.cjs"
  "render-test-d8.cjs"
)

for script in "${STANDALONE_SCRIPTS[@]}"; do
  if [[ -f "$SCRIPT_DIR/$script" ]]; then
    echo "=== $script ==="
    (cd "$SCRIPT_DIR" && node "$script")
    echo ""
  fi
done

echo "Done. All test-renders updated."
echo "  Total: $(ls "$TEST_RENDERS"/*.png 2>/dev/null | wc -l | tr -d ' ') images"
