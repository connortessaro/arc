#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
STORE_PATH="${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}/code/cockpit.json"
STATE_FILE="${ARC_TELEGRAM_WATCHDOG_STATE_FILE:-${HOME}/.local/state/arc-self-drive/telegram-watchdog-state.json}"

# shellcheck source=./load-telegram-env.sh
source "$ROOT_DIR/scripts/arc-self-drive/load-telegram-env.sh"

load_arc_self_drive_telegram_env

if [[ -z "${ARC_TELEGRAM_BOT_TOKEN:-}" || -z "${ARC_TELEGRAM_CHAT_ID:-}" ]]; then
  echo "Telegram watchdog is not configured. Run configure-telegram-monitoring.sh first." >&2
  exit 0
fi

healthcheck_json=""
healthcheck_error=""
set +e
healthcheck_json="$(bash "$ROOT_DIR/scripts/arc-self-drive/healthcheck.sh" 2>/dev/null)"
healthcheck_exit=$?
set -e
if [[ "$healthcheck_exit" -ne 0 ]]; then
  healthcheck_error="healthcheck exited with ${healthcheck_exit}"
fi

mkdir -p "$(dirname "$STATE_FILE")"
chmod 700 "$(dirname "$STATE_FILE")"

host_name="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown-host)"

decision_json="$(
  ARC_HEALTHCHECK_JSON="$healthcheck_json" \
  ARC_HEALTHCHECK_ERROR="$healthcheck_error" \
  ARC_STORE_PATH="$STORE_PATH" \
  ARC_STATE_FILE="$STATE_FILE" \
  ARC_HOST_NAME="$host_name" \
  ARC_NOTIFY_ON_HEALTHY="${ARC_TELEGRAM_NOTIFY_ON_HEALTHY:-true}" \
  ARC_STALL_THRESHOLD="${ARC_TELEGRAM_STALL_THRESHOLD:-3}" \
  python3 <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

healthcheck_raw = os.environ.get("ARC_HEALTHCHECK_JSON", "").strip()
healthcheck_error = os.environ.get("ARC_HEALTHCHECK_ERROR", "").strip()
store_path = Path(os.environ["ARC_STORE_PATH"])
state_path = Path(os.environ["ARC_STATE_FILE"])
host_name = os.environ.get("ARC_HOST_NAME", "unknown-host")
notify_on_healthy = os.environ.get("ARC_NOTIFY_ON_HEALTHY", "true") == "true"
stall_threshold = max(1, int(os.environ.get("ARC_STALL_THRESHOLD", "3")))
timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

if healthcheck_raw:
    try:
        healthcheck = json.loads(healthcheck_raw)
    except json.JSONDecodeError:
        healthcheck = {}
        if not healthcheck_error:
            healthcheck_error = "healthcheck returned invalid JSON"
else:
    healthcheck = {}

store = {}
if store_path.exists():
    try:
        store = json.loads(store_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        healthcheck_error = healthcheck_error or f"invalid cockpit store at {store_path}"

previous_state = {}
if state_path.exists():
    try:
        previous_state = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        previous_state = {}

gateway = healthcheck.get("gateway", {}) if isinstance(healthcheck, dict) else {}
gateway_status = gateway.get("status") or "unknown"
gateway_health = gateway.get("health") if isinstance(gateway, dict) else {}
gateway_health_status = gateway_health.get("status") if isinstance(gateway_health, dict) else "down"
gateway_ok = (
    isinstance(gateway_health, dict)
    and gateway_status == "active"
    and gateway_health.get("ok") is True
)

claude = (
    healthcheck.get("engines", {}).get("claude", {})
    if isinstance(healthcheck, dict)
    else {}
)
claude_health = claude.get("health") or "unknown"

tasks = store.get("tasks", []) if isinstance(store, dict) else []
workers = store.get("workers", []) if isinstance(store, dict) else []
reviews = store.get("reviews", []) if isinstance(store, dict) else []
runs = store.get("runs", []) if isinstance(store, dict) else []

running_workers = [worker for worker in workers if worker.get("status") == "running"]
active_tasks = [
    task for task in tasks if task.get("status") in {"queued", "planning", "in_progress"}
]
blocked_tasks = [task for task in tasks if task.get("status") == "blocked"]
pending_reviews = [review for review in reviews if review.get("status") == "pending"]

previous_stall_checks = int(previous_state.get("stallChecks") or 0)
stall_checks = previous_stall_checks + 1 if active_tasks and not running_workers else 0

recent_runs = sorted(runs, key=lambda item: item.get("updatedAt", ""), reverse=True)[:5]
alert_failures = [
    run
    for run in recent_runs
    if run.get("status") == "failed"
    and run.get("terminationReason") in {"no-output-timeout", "spawn-error", "overall-timeout"}
]

issues = []
if healthcheck_error:
    issues.append(healthcheck_error)
if not gateway_ok:
    issues.append(f"gateway is not healthy ({gateway_status}/{gateway_health_status})")
if claude_health != "healthy":
    issues.append(f"claude auth health is {claude_health}")
if stall_checks >= stall_threshold:
    issues.append(
        f"stalled queue: {len(active_tasks)} active tasks, 0 running workers for {stall_checks} consecutive checks"
    )
if alert_failures:
    issues.append(
        "recent failing runs: "
        + "; ".join(
            f"{run.get('id', 'unknown-run')} {run.get('terminationReason', 'failed')}"
            for run in alert_failures[:3]
        )
    )

signals = [
    f"- gateway: {gateway_status}/{gateway_health_status}",
    f"- claude: {claude_health}",
    f"- active tasks: {len(active_tasks)}",
    f"- running workers: {len(running_workers)}",
    f"- blocked tasks: {len(blocked_tasks)}",
    f"- pending reviews: {len(pending_reviews)}",
]

status = "healthy" if not issues else "degraded"
fingerprint = "healthy" if not issues else "\n".join(issues)
previous_status = previous_state.get("status")
previous_fingerprint = previous_state.get("fingerprint")

send = False
message = ""
if status == "healthy":
    if previous_status and previous_status != "healthy" and notify_on_healthy:
        send = True
        message = "\n".join(
            [
                "Arc runtime recovered",
                f"Host: {host_name}",
                f"Time: {timestamp}",
                *signals,
            ]
        )
else:
    if previous_fingerprint != fingerprint:
        send = True
        message = "\n".join(
            [
                "Arc runtime alert",
                f"Host: {host_name}",
                f"Time: {timestamp}",
                "Issues:",
                *[f"- {issue}" for issue in issues],
                "Signals:",
                *signals,
            ]
        )

state_path.write_text(
    json.dumps(
        {
            "status": status,
            "fingerprint": fingerprint,
            "stallChecks": stall_checks,
            "updatedAt": timestamp,
        },
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)

print(json.dumps({"send": send, "message": message}))
PY
)"

should_send="$(printf '%s' "$decision_json" | jq -r '.send')"
message_text="$(printf '%s' "$decision_json" | jq -r '.message // empty')"

if [[ "$should_send" != "true" || -z "$message_text" ]]; then
  exit 0
fi

curl_args=(
  -fsS
  -X POST
  "https://api.telegram.org/bot${ARC_TELEGRAM_BOT_TOKEN}/sendMessage"
  --data-urlencode "chat_id=${ARC_TELEGRAM_CHAT_ID}"
  --data-urlencode "text=${message_text}"
  --data-urlencode "disable_web_page_preview=true"
)
if [[ -n "${ARC_TELEGRAM_THREAD_ID:-}" ]]; then
  curl_args+=(--data-urlencode "message_thread_id=${ARC_TELEGRAM_THREAD_ID}")
fi

curl "${curl_args[@]}" >/dev/null
