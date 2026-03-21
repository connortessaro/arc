#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
ENGINE_CHECK_TIMEOUT_SECONDS="${ARC_SELF_DRIVE_ENGINE_CHECK_TIMEOUT_SECONDS:-5}"

run_with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
    return
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$seconds" "$@"
    return
  fi
  "$@"
}

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
github_base_branch="${ARC_SELF_DRIVE_BASE_BRANCH:-$(git -C "$ROOT_DIR" config --get arc.selfDriveBaseBranch 2>/dev/null || true)}"
github_remote="${ARC_SELF_DRIVE_GITHUB_REMOTE:-origin}"
github_push_url="$(git -C "$ROOT_DIR" config --get "remote.${github_remote}.pushurl" 2>/dev/null || true)"
github_token_configured=false
if [[ -n "${ARC_SELF_DRIVE_GITHUB_TOKEN:-}" ]]; then
  github_token_configured=true
fi
gh_path="$(command -v gh || true)"
github_health="missing"
if [[ -n "$gh_path" ]]; then
  if [[ "$github_token_configured" == true ]]; then
    set +e
    GH_TOKEN="${ARC_SELF_DRIVE_GITHUB_TOKEN:-}" run_with_timeout "$ENGINE_CHECK_TIMEOUT_SECONDS" \
      gh auth status --hostname github.com >/dev/null 2>&1
    github_auth_exit=$?
    set -e
    if [[ "$github_auth_exit" -eq 0 ]]; then
      github_health="healthy"
    elif [[ "$github_auth_exit" -eq 124 ]]; then
      github_health="timeout"
    else
      github_health="unhealthy"
    fi
  else
    github_health="installed"
  fi
fi

codex_path="$(command -v codex || true)"
codex_health="missing"
if [[ -n "$codex_path" ]]; then
  set +e
  run_with_timeout "$ENGINE_CHECK_TIMEOUT_SECONDS" codex login status >/dev/null 2>&1
  codex_auth_exit=$?
  set -e
  if [[ "$codex_auth_exit" -eq 0 ]]; then
    codex_health="healthy"
  elif [[ "$codex_auth_exit" -eq 124 ]]; then
    codex_health="timeout"
  else
    codex_health="unhealthy"
  fi
fi

claude_path="$(command -v claude || true)"
claude_health="missing"
if [[ -n "$claude_path" ]]; then
  set +e
  claude_auth_status="$(run_with_timeout "$ENGINE_CHECK_TIMEOUT_SECONDS" claude auth status 2>/dev/null)"
  claude_auth_exit=$?
  set -e
  if [[ "$claude_auth_status" =~ \"loggedIn\"[[:space:]]*:[[:space:]]*true ]]; then
    claude_health="healthy"
  elif [[ "$claude_auth_status" =~ \"loggedIn\"[[:space:]]*:[[:space:]]*false ]]; then
    claude_health="missing"
  elif [[ "$claude_auth_exit" -eq 124 ]]; then
    claude_health="timeout"
  elif run_with_timeout "$ENGINE_CHECK_TIMEOUT_SECONDS" claude --version >/dev/null 2>&1; then
    claude_health="installed"
  else
    claude_health="unhealthy"
  fi
fi

gateway_pid="$(systemctl --user show --property MainPID --value openclaw-gateway.service 2>/dev/null || true)"
if [[ -n "${ARC_SELF_DRIVE_SYSTEM_METRICS_JSON:-}" ]]; then
  system_metrics_json="${ARC_SELF_DRIVE_SYSTEM_METRICS_JSON}"
else
  system_metrics_json="$(
    ARC_HEALTHCHECK_GATEWAY_PID="$gateway_pid" ARC_HEALTHCHECK_ROOT_DIR="$ROOT_DIR" python3 <<'PY'
import json
import os
import subprocess
from pathlib import Path


def run(*argv: str) -> str:
    try:
        result = subprocess.run(argv, check=False, capture_output=True, text=True)
        return result.stdout.strip()
    except FileNotFoundError:
        return ""


def parse_memory_metrics() -> tuple[int | None, int | None]:
    raw = run("free", "-m")
    if not raw:
        return None, None
    memory_available = None
    swap_used = None
    for line in raw.splitlines():
        columns = line.split()
        if not columns:
            continue
        if columns[0] == "Mem:" and len(columns) >= 7:
            try:
                memory_available = int(columns[6])
            except ValueError:
                memory_available = None
        if columns[0] == "Swap:" and len(columns) >= 3:
            try:
                swap_used = int(columns[2])
            except ValueError:
                swap_used = None
    return memory_available, swap_used


def parse_disk_free_gib(root_dir: str) -> float | None:
    raw = run("df", "-Pk", root_dir)
    lines = [line for line in raw.splitlines() if line.strip()]
    if len(lines) < 2:
        return None
    columns = lines[-1].split()
    if len(columns) < 4:
        return None
    try:
        available_kib = int(columns[3])
    except ValueError:
        return None
    return round(available_kib / (1024 * 1024), 1)


def parse_top_processes() -> list[dict[str, object]]:
    raw = run("ps", "-axo", "pid=,rss=,comm=")
    rows = []
    for line in raw.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 3:
            continue
        try:
            pid = int(parts[0])
            rss = int(parts[1])
        except ValueError:
            continue
        rows.append({"pid": pid, "rssMiB": max(0, round(rss / 1024)), "command": parts[2]})
    rows.sort(key=lambda item: int(item["rssMiB"]), reverse=True)
    return rows[:5]


def parse_gateway_rss(gateway_pid: str) -> int | None:
    if not gateway_pid or gateway_pid == "0":
        return None
    raw = run("ps", "-o", "rss=", "-p", gateway_pid)
    try:
        return max(0, round(int(raw.strip()) / 1024))
    except ValueError:
        return None


system_metrics = {
    "memoryAvailableMiB": parse_memory_metrics()[0],
    "swapUsedMiB": parse_memory_metrics()[1],
    "diskFreeGiB": parse_disk_free_gib(os.environ.get("ARC_HEALTHCHECK_ROOT_DIR", "/")),
    "gatewayRssMiB": parse_gateway_rss(os.environ.get("ARC_HEALTHCHECK_GATEWAY_PID", "")),
    "topProcesses": parse_top_processes(),
}
print(json.dumps(system_metrics))
PY
  )"
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
  --arg ghPath "$gh_path" \
  --arg githubHealth "$github_health" \
  --arg githubBaseBranch "$github_base_branch" \
  --arg githubPushUrl "$github_push_url" \
  --argjson githubTokenConfigured "$github_token_configured" \
  --arg codexPath "$codex_path" \
  --arg codexHealth "$codex_health" \
  --arg claudePath "$claude_path" \
  --arg claudeHealth "$claude_health" \
  --argjson systemMetrics "$system_metrics_json" \
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
    github: {
      path: (if $ghPath == "" then null else $ghPath end),
      health: $githubHealth,
      tokenConfigured: $githubTokenConfigured,
      baseBranch: (if $githubBaseBranch == "" then null else $githubBaseBranch end),
      pushUrl: (if $githubPushUrl == "" then null else $githubPushUrl end)
    },
    engines: {
      codex: {
        path: (if $codexPath == "" then null else $codexPath end),
        health: $codexHealth
      },
      claude: {
        path: (if $claudePath == "" then null else $claudePath end),
        health: $claudeHealth
      }
    },
    system: $systemMetrics
  }'
