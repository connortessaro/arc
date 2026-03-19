#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH_TARGET="${ARC_REMOTE_SSH_TARGET:-arc-droplet}"
REMOTE_GATEWAY_PORT="${ARC_REMOTE_GATEWAY_PORT:-18789}"
LOCAL_TUNNEL_PORT="${ARC_REMOTE_TUNNEL_PORT:-38789}"
HEALTHCHECK_URL="http://127.0.0.1:${LOCAL_TUNNEL_PORT}/health"

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/arc-self-drive/mac-remote-code.sh <code-subcommand...>" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to read the remote gateway token." >&2
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh is required to open the Arc remote tunnel." >&2
  exit 1
fi

REMOTE_TOKEN="$(
  ssh "$SSH_TARGET" "python3 - <<'PY'
from pathlib import Path
import json

config_path = Path.home() / '.openclaw' / 'openclaw.json'
env_path = Path.home() / '.openclaw' / '.env'

token = ''
if config_path.exists():
    try:
        data = json.loads(config_path.read_text())
        token = (((data.get('gateway') or {}).get('auth') or {}).get('token') or '').strip()
    except Exception:
        token = ''

if not token and env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key == 'OPENCLAW_GATEWAY_TOKEN':
            token = value.strip()
            break

print(token)
PY"
)"

TEMP_STATE_DIR="$(mktemp -d)"
TUNNEL_PID=""

cleanup() {
  if [[ -n "$TUNNEL_PID" ]]; then
    kill "$TUNNEL_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEMP_STATE_DIR"
}

trap cleanup EXIT

if [[ -n "$REMOTE_TOKEN" ]]; then
  cat > "${TEMP_STATE_DIR}/openclaw.json" <<EOF
{
  "gateway": {
    "mode": "remote",
    "remote": {
      "url": "ws://127.0.0.1:${LOCAL_TUNNEL_PORT}",
      "token": "${REMOTE_TOKEN}"
    }
  }
}
EOF
else
  cat > "${TEMP_STATE_DIR}/openclaw.json" <<EOF
{
  "gateway": {
    "mode": "remote",
    "remote": {
      "url": "ws://127.0.0.1:${LOCAL_TUNNEL_PORT}"
    }
  }
}
EOF
fi

ssh -N -L "${LOCAL_TUNNEL_PORT}:127.0.0.1:${REMOTE_GATEWAY_PORT}" "$SSH_TARGET" >/dev/null 2>&1 &
TUNNEL_PID="$!"

deadline=$((SECONDS + 20))
until curl -fsS "$HEALTHCHECK_URL" >/dev/null 2>&1; do
  if ! kill -0 "$TUNNEL_PID" >/dev/null 2>&1; then
    echo "Remote tunnel exited before the gateway became reachable." >&2
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    echo "Timed out waiting for ${HEALTHCHECK_URL}." >&2
    exit 1
  fi
  sleep 1
done

OPENCLAW_STATE_DIR="$TEMP_STATE_DIR" \
  node --import tsx "${ROOT_DIR}/scripts/arc-self-drive/code-cli-entry.ts" "$@"
