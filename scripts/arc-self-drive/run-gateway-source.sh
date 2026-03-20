#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

# shellcheck source=./load-engine-env.sh
source "$ROOT_DIR/scripts/arc-self-drive/load-engine-env.sh"
load_arc_self_drive_env

export PATH="${HOME}/.npm-global/bin:${HOME}/.local/bin:${PATH}"

cd "$ROOT_DIR"
exec node "$ROOT_DIR/openclaw.mjs" gateway --port "$PORT"
