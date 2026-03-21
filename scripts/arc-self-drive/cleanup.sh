#!/usr/bin/env bash
set -euo pipefail

STORE_PATH="${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}/code/cockpit.json"
KEEP_DAYS=7
MODE="dry-run"
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      MODE="apply"
      ;;
    --dry-run)
      MODE="dry-run"
      ;;
    --keep-days)
      if [[ $# -lt 2 ]]; then
        echo "--keep-days requires a value" >&2
        exit 1
      fi
      KEEP_DAYS="$2"
      shift
      ;;
    --json)
      JSON_OUTPUT=true
      ;;
    *)
      echo "Unknown cleanup option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

python3 - "$STORE_PATH" "$MODE" "$KEEP_DAYS" "$JSON_OUTPUT" <<'PY'
import glob
import json
import os
import shutil
import socket
import sys
import tempfile
import time
from pathlib import Path

store_path = Path(sys.argv[1])
mode = sys.argv[2]
keep_days = int(sys.argv[3])
json_output = sys.argv[4].lower() == "true"
cutoff = time.time() - (keep_days * 24 * 60 * 60)


def is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def port_has_listener(port: int) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.5)
    try:
        sock.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def older_than_cutoff(path: Path) -> bool:
    try:
        return path.stat().st_mtime <= cutoff
    except FileNotFoundError:
        return False


store = {}
if store_path.exists():
    store = json.loads(store_path.read_text(encoding="utf-8"))

tasks = {task.get("id"): task for task in store.get("tasks", [])}
reviews = store.get("reviews", [])
workers = store.get("workers", [])
runs = store.get("runs", [])

pending_review_task_ids = {
    review.get("taskId") for review in reviews if review.get("status") == "pending" and review.get("taskId")
}

worktree_candidates: list[Path] = []
seen_worktrees: set[str] = set()
for worker in workers:
    if worker.get("status") not in {"completed", "cancelled"}:
        continue
    worktree_path = worker.get("worktreePath")
    if not worktree_path or worktree_path in seen_worktrees:
        continue
    task = tasks.get(worker.get("taskId"))
    if task and (task.get("status") in {"review", "blocked"} or task.get("id") in pending_review_task_ids):
        continue
    candidate = Path(worktree_path)
    if candidate.exists() and older_than_cutoff(candidate):
        worktree_candidates.append(candidate)
        seen_worktrees.add(worktree_path)

log_candidates: list[Path] = []
seen_logs: set[str] = set()
for run in runs:
    if run.get("status") == "running":
        continue
    for field in ("stdoutLogPath", "stderrLogPath"):
        raw_path = run.get(field)
        if not raw_path or raw_path in seen_logs:
            continue
        candidate = Path(raw_path)
        if candidate.exists() and older_than_cutoff(candidate):
            log_candidates.append(candidate)
            seen_logs.add(raw_path)

uid = os.getuid() if hasattr(os, "getuid") else None
lock_root = Path(tempfile.gettempdir()) / (f"openclaw-{uid}" if uid is not None else "openclaw")
lock_candidates: list[Path] = []
for raw_path in glob.glob(str(lock_root / "gateway.*.lock")):
    candidate = Path(raw_path)
    try:
        payload = json.loads(candidate.read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    pid = payload.get("pid")
    pid_alive = isinstance(pid, int) and is_pid_alive(pid)
    if pid_alive or port_has_listener(18789):
        continue
    if older_than_cutoff(candidate):
        lock_candidates.append(candidate)

deleted = {"worktrees": 0, "logs": 0, "locks": 0}
if mode == "apply":
    for candidate in worktree_candidates:
        shutil.rmtree(candidate, ignore_errors=True)
        deleted["worktrees"] += 1
    for candidate in log_candidates:
        try:
            candidate.unlink(missing_ok=True)
        finally:
            deleted["logs"] += 1
    for candidate in lock_candidates:
        try:
            candidate.unlink(missing_ok=True)
        finally:
            deleted["locks"] += 1

result = {
    "mode": mode,
    "keepDays": keep_days,
    "counts": {
        "worktrees": len(worktree_candidates),
        "logs": len(log_candidates),
        "locks": len(lock_candidates),
    },
    "deleted": deleted,
    "candidates": {
        "worktrees": [str(entry) for entry in worktree_candidates],
        "logs": [str(entry) for entry in log_candidates],
        "locks": [str(entry) for entry in lock_candidates],
    },
}

if json_output:
    print(json.dumps(result))
    raise SystemExit(0)

print(f"mode={mode} keep_days={keep_days}")
print(
    "cleanup_candidates: "
    f"worktrees={result['counts']['worktrees']} "
    f"logs={result['counts']['logs']} "
    f"locks={result['counts']['locks']}"
)
if mode == "apply":
    print(
        "deleted: "
        f"worktrees={deleted['worktrees']} "
        f"logs={deleted['logs']} "
        f"locks={deleted['locks']}"
    )
PY
