#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
HEALTHCHECK_URL="http://127.0.0.1:${GATEWAY_PORT}/health"

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/arc-self-drive/run-code-via-gateway.sh <code-subcommand...>" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to talk to the local Arc gateway." >&2
  exit 1
fi

if ! curl -fsS "$HEALTHCHECK_URL" >/dev/null 2>&1; then
  echo "Arc gateway is not reachable at ${HEALTHCHECK_URL}. Start openclaw-gateway.service first." >&2
  exit 1
fi

GATEWAY_TOKEN="$(
  python3 - <<'PY'
from pathlib import Path
import json
import os

state_dir = Path(os.environ.get("OPENCLAW_STATE_DIR", str(Path.home() / ".openclaw"))).expanduser()
config_override = os.environ.get("OPENCLAW_CONFIG_PATH")
config_path = Path(config_override).expanduser() if config_override else state_dir / "openclaw.json"
env_path = state_dir / ".env"

token = ""
if config_path.exists():
    try:
        data = json.loads(config_path.read_text())
        token = (((data.get("gateway") or {}).get("auth") or {}).get("token") or "").strip()
    except Exception:
        token = ""

if not token and env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key == "OPENCLAW_GATEWAY_TOKEN":
            token = value.strip()
            break

print(token)
PY
)"

TEMP_CONFIG_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TEMP_CONFIG_DIR"
}

trap cleanup EXIT

if [[ -n "$GATEWAY_TOKEN" ]]; then
  cat > "${TEMP_CONFIG_DIR}/openclaw.json" <<EOF
{
  "gateway": {
    "mode": "remote",
    "remote": {
      "url": "ws://127.0.0.1:${GATEWAY_PORT}",
      "token": "${GATEWAY_TOKEN}"
    }
  }
}
EOF
else
  cat > "${TEMP_CONFIG_DIR}/openclaw.json" <<EOF
{
  "gateway": {
    "mode": "remote",
    "remote": {
      "url": "ws://127.0.0.1:${GATEWAY_PORT}"
    }
  }
}
EOF
fi

cd "$ROOT_DIR"
OPENCLAW_CONFIG_PATH="${TEMP_CONFIG_DIR}/openclaw.json" \
  node --import tsx "${ROOT_DIR}/scripts/arc-self-drive/code-cli-entry.ts" "$@"
