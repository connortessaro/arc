#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=./load-engine-env.sh
source "$ROOT_DIR/scripts/arc-self-drive/load-engine-env.sh"
load_arc_self_drive_env

export PATH="${ROOT_DIR}/node_modules/.bin:${HOME}/.npm-global/bin:${HOME}/.local/bin:${PATH}"

cd "$ROOT_DIR"
exec node --import tsx "$ROOT_DIR/scripts/arc-self-drive/supervisor-tick.ts" "$@"
