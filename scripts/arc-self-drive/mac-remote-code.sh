#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/arc-self-drive/mac-remote-code.sh <code-subcommand...>" >&2
  exit 1
fi

exec bash "${ROOT_DIR}/scripts/arc-self-drive/run-code-via-ssh-tunnel.sh" "$@"
