#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=./load-engine-env.sh
source "$ROOT_DIR/scripts/arc-self-drive/load-engine-env.sh"

env_file="$(arc_self_drive_env_file)"
env_dir="$(dirname "$env_file")"
claude_token="${CLAUDE_CODE_OAUTH_TOKEN:-}"

if [[ -z "$claude_token" ]]; then
  echo "CLAUDE_CODE_OAUTH_TOKEN must be exported in the current shell before running this installer." >&2
  exit 1
fi

if [[ "$claude_token" == *$'\n'* ]]; then
  echo "CLAUDE_CODE_OAUTH_TOKEN must be a single-line token." >&2
  exit 1
fi

mkdir -p "$env_dir"
chmod 700 "$env_dir"

python3 - "$env_file" "$claude_token" <<'PY'
import json
import pathlib
import sys

env_path = pathlib.Path(sys.argv[1])
token = sys.argv[2]
env_path.write_text(
    "# Arc self-drive engine auth\n"
    f"CLAUDE_CODE_OAUTH_TOKEN={json.dumps(token)}\n",
    encoding="utf-8",
)
PY
chmod 600 "$env_file"

systemctl --user daemon-reload
systemctl --user restart openclaw-gateway.service
systemctl --user restart arc-self-drive.timer

echo "Persisted Claude self-drive auth to ${env_file}"
bash "$ROOT_DIR/scripts/arc-self-drive/healthcheck.sh"
