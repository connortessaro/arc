#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

# shellcheck source=./load-engine-env.sh
source "$ROOT_DIR/scripts/arc-self-drive/load-engine-env.sh"
load_arc_self_drive_env

export PATH="${HOME}/.npm-global/bin:${HOME}/.local/bin:${ROOT_DIR}/node_modules/.bin:${PATH}"

commit="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
gateway_status="$(systemctl --user is-active openclaw-gateway.service 2>/dev/null || true)"
gateway_health_raw="$(curl -fsS "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
auth_env_file="$(arc_self_drive_env_file)"
auth_env_exists=false
if [[ -f "$auth_env_file" ]]; then
  auth_env_exists=true
fi

codex_path="$(command -v codex || true)"
codex_health="missing"
if [[ -n "$codex_path" ]]; then
  if codex login status >/dev/null 2>&1; then
    codex_health="healthy"
  else
    codex_health="unhealthy"
  fi
fi

claude_path="$(command -v claude || true)"
claude_health="missing"
if [[ -n "$claude_path" ]]; then
  claude_auth_status="$(claude auth status 2>/dev/null || true)"
  if [[ "$claude_auth_status" =~ \"loggedIn\"[[:space:]]*:[[:space:]]*true ]]; then
    claude_health="healthy"
  elif [[ "$claude_auth_status" =~ \"loggedIn\"[[:space:]]*:[[:space:]]*false ]]; then
    claude_health="missing"
  elif claude --version >/dev/null 2>&1; then
    claude_health="installed"
  else
    claude_health="unhealthy"
  fi
fi

if [[ -n "$gateway_health_raw" ]]; then
  gateway_health="$gateway_health_raw"
else
  gateway_health="null"
fi

jq -n \
  --arg commit "$commit" \
  --arg gatewayStatus "$gateway_status" \
  --arg gatewayPort "$PORT" \
  --arg authEnvFile "$auth_env_file" \
  --argjson authEnvExists "$auth_env_exists" \
  --arg codexPath "$codex_path" \
  --arg codexHealth "$codex_health" \
  --arg claudePath "$claude_path" \
  --arg claudeHealth "$claude_health" \
  --argjson gatewayHealth "$gateway_health" \
  '{
    commit: $commit,
    gateway: {
      status: $gatewayStatus,
      port: $gatewayPort,
      health: $gatewayHealth
    },
    authEnvFile: {
      path: $authEnvFile,
      exists: $authEnvExists
    },
    engines: {
      codex: {
        path: ($codexPath | select(. != "")),
        health: $codexHealth
      },
      claude: {
        path: ($claudePath | select(. != "")),
        health: $claudeHealth
      }
    }
  }'
