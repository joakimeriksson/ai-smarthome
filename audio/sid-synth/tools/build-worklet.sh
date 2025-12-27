#!/usr/bin/env bash
set -euo pipefail

# Simple bundler: concatenates jsSID core + TinySID + our worklet body
# Output: sid-processor.bundle.js in repo root

ROOT_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
OUT_FILE="$ROOT_DIR/sid-processor.bundle.js"

CORE="$ROOT_DIR/jsSID/js/jssid.core.js"
TINYSID="$ROOT_DIR/jsSID/js/jssid.tinysid.js"
BODY="$ROOT_DIR/worklet/sid-processor.body.js"

if [[ ! -f "$CORE" || ! -f "$TINYSID" || ! -f "$BODY" ]]; then
  echo "Missing one or more inputs:"
  echo "  $CORE"
  echo "  $TINYSID"
  echo "  $BODY"
  exit 1
fi

{
  echo "// Auto-generated bundle. Do not edit."
  echo "// Contains jsSID core + TinySID + worklet processor."
  cat "$CORE"
  echo
  cat "$TINYSID"
  echo
  cat "$BODY"
} > "$OUT_FILE"

echo "Built $OUT_FILE"

