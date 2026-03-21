#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
STORE_PATH="${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}/code/cockpit.json"

healthcheck_json="$(bash "$ROOT_DIR/scripts/arc-self-drive/healthcheck.sh")"
printf '%s\n' "$healthcheck_json"
echo "---"

if [[ ! -f "$STORE_PATH" ]]; then
  echo "Store not found: $STORE_PATH" >&2
  exit 1
fi

cleanup_json="$(bash "$ROOT_DIR/scripts/arc-self-drive/cleanup.sh" --json 2>/dev/null || printf '{}')"

ARC_HEALTHCHECK_JSON="$healthcheck_json" ARC_CLEANUP_JSON="$cleanup_json" python3 - "$STORE_PATH" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone
from collections import Counter

store_path = pathlib.Path(sys.argv[1])
data = json.loads(store_path.read_text())
healthcheck = json.loads(__import__("os").environ.get("ARC_HEALTHCHECK_JSON", "{}") or "{}")
cleanup = json.loads(__import__("os").environ.get("ARC_CLEANUP_JSON", "{}") or "{}")

workers = data.get("workers", [])
runs = data.get("runs", [])
tasks = {entry["id"]: entry for entry in data.get("tasks", [])}
reviews = data.get("reviews", [])

running = [entry for entry in workers if entry.get("status") == "running"]
pending_reviews = [entry for entry in reviews if entry.get("status") == "pending"]
now = datetime.now(timezone.utc)

def in_retry_backoff(task):
    retry_after = task.get("retryAfter")
    if not retry_after or task.get("status") in {"done", "cancelled"}:
        return False
    try:
        retry_at = datetime.fromisoformat(retry_after.replace("Z", "+00:00"))
    except ValueError:
        return False
    return retry_at > now

retry_backoff_count = sum(1 for task in tasks.values() if in_retry_backoff(task))
blocked_by_class = Counter(
    (task.get("lastFailureClass") or "operator-needed")
    for task in tasks.values()
    if task.get("status") == "blocked"
)
system = healthcheck.get("system") if isinstance(healthcheck, dict) else {}
memory_available = system.get("memoryAvailableMiB")
swap_used = system.get("swapUsedMiB")
disk_free = system.get("diskFreeGiB")
gateway_rss = system.get("gatewayRssMiB")
top_processes = system.get("topProcesses") or []
cleanup_counts = cleanup.get("counts") if isinstance(cleanup, dict) else {}

latest_run_by_worker = {}
for run in sorted(runs, key=lambda item: item.get("updatedAt", ""), reverse=True):
    worker_id = run.get("workerId")
    if worker_id and worker_id not in latest_run_by_worker:
        latest_run_by_worker[worker_id] = run

print(f"store={store_path}")
print(f"tasks={len(tasks)} workers={len(workers)} runs={len(runs)} pending_reviews={len(pending_reviews)}")
if any(value is not None for value in (memory_available, swap_used, disk_free, gateway_rss)):
    print(
        "system: "
        f"memory_available={memory_available if memory_available is not None else 'n/a'}MiB "
        f"swap_used={swap_used if swap_used is not None else 'n/a'}MiB "
        f"disk_free={disk_free if disk_free is not None else 'n/a'}GiB "
        f"gateway_rss={gateway_rss if gateway_rss is not None else 'n/a'}MiB"
    )
if top_processes:
    print("top_memory:")
    for process in top_processes[:3]:
        print(
            f"- pid={process.get('pid')} rss={process.get('rssMiB')}MiB command={process.get('command')}"
        )
print(f"retry_backoff={retry_backoff_count}")
if blocked_by_class:
    print(
        "blocked_by_class: "
        + " ".join(f"{failure_class}={count}" for failure_class, count in sorted(blocked_by_class.items()))
    )
else:
    print("blocked_by_class: none")
if cleanup_counts:
    print(
        "cleanup_candidates: "
        f"worktrees={cleanup_counts.get('worktrees', 0)} "
        f"logs={cleanup_counts.get('logs', 0)} "
        f"locks={cleanup_counts.get('locks', 0)}"
    )

if not running:
    print("running_workers=none")
else:
    print("running_workers:")
    for worker in running:
        task = tasks.get(worker.get("taskId"))
        run = latest_run_by_worker.get(worker["id"])
        title = task.get("title") if task else "unknown task"
        model = worker.get("engineModel") or worker.get("backendId") or "unknown-engine"
        print(
            f"- {worker['id']} | {worker.get('name')} | task={title} | engine={model} | "
            f"run={run.get('id') if run else 'n/a'}"
        )

recent = sorted(
    runs,
    key=lambda item: item.get("updatedAt", ""),
    reverse=True,
)[:5]
if recent:
    print("recent_runs:")
    for run in recent:
        task = tasks.get(run.get("taskId"))
        print(
            f"- {run['id']} | status={run.get('status')} | worker={run.get('workerId')} | "
            f"class={(task.get('lastFailureClass') if task else None) or 'n/a'} | "
            f"reason={run.get('terminationReason') or 'n/a'}"
        )
PY
