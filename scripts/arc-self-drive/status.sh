#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
STORE_PATH="${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}/code/cockpit.json"

bash "$ROOT_DIR/scripts/arc-self-drive/healthcheck.sh"
echo "---"

if [[ ! -f "$STORE_PATH" ]]; then
  echo "Store not found: $STORE_PATH" >&2
  exit 1
fi

python3 - "$STORE_PATH" <<'PY'
import json
import pathlib
import sys

store_path = pathlib.Path(sys.argv[1])
data = json.loads(store_path.read_text())

workers = data.get("workers", [])
runs = data.get("runs", [])
tasks = {entry["id"]: entry for entry in data.get("tasks", [])}
reviews = data.get("reviews", [])

running = [entry for entry in workers if entry.get("status") == "running"]
pending_reviews = [entry for entry in reviews if entry.get("status") == "pending"]

latest_run_by_worker = {}
for run in sorted(runs, key=lambda item: item.get("updatedAt", ""), reverse=True):
    worker_id = run.get("workerId")
    if worker_id and worker_id not in latest_run_by_worker:
        latest_run_by_worker[worker_id] = run

print(f"store={store_path}")
print(f"tasks={len(tasks)} workers={len(workers)} runs={len(runs)} pending_reviews={len(pending_reviews)}")

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
        print(
            f"- {run['id']} | status={run.get('status')} | worker={run.get('workerId')} | "
            f"reason={run.get('terminationReason') or 'n/a'}"
        )
PY
