#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

export PATH="$ROOT_DIR/node_modules/.bin:$PATH"

cd "$ROOT_DIR"
exec node --import tsx "$ROOT_DIR/src/index.ts" gateway --port "$PORT"
