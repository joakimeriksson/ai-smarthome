#!/usr/bin/env bash
set -euo pipefail

# Simple bundler: concatenates JXG stub + jsSID core + reSID + our worklet body
# Output: sid-processor.bundle.js in repo root

ROOT_DIR="$(cd "$(dirname "$0")"/.. && pwd)"
OUT_FILE="$ROOT_DIR/sid-processor.bundle.js"

JXG_STUB="$ROOT_DIR/jsSID/js/jxg-stub.js"
STREAM="$ROOT_DIR/jsSID/js/stream.js"
CORE="$ROOT_DIR/jsSID/js/jssid.core.js"
RESID="$ROOT_DIR/jsSID/js/jssid.resid.js"
BODY="$ROOT_DIR/worklet/sid-processor.body.js"

if [[ ! -f "$JXG_STUB" || ! -f "$STREAM" || ! -f "$CORE" || ! -f "$RESID" || ! -f "$BODY" ]]; then
  echo "Missing one or more inputs:"
  echo "  $JXG_STUB"
  echo "  $STREAM"
  echo "  $CORE"
  echo "  $RESID"
  echo "  $BODY"
  exit 1
fi

{
  echo "// Auto-generated bundle. Do not edit."
  echo "// Contains JXG stub + Stream + jsSID core + reSID + worklet processor."
  cat "$JXG_STUB"
  echo
  cat "$STREAM"
  echo
  cat "$CORE"
  echo
  cat "$RESID"
  echo
  cat "$BODY"
} > "$OUT_FILE"

echo "Built $OUT_FILE"

