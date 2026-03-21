# Arc Ops Runbook

Use this when the VPS loop is running overnight and you need a fast read on what Arc is doing.

## Primary Commands

```bash
arc status
arc cleanup
arc cleanup --apply
arc self-drive tick
```

`arc status` is the main operator snapshot. It now includes:

- gateway and engine health
- memory headroom, swap use, disk headroom, and gateway RSS
- retry-backoff count
- blocked task counts grouped by failure class
- safe cleanup candidate counts
- running workers and recent runs

`arc cleanup` is dry-run by default. It reports what can be deleted safely without touching blocked, failed, or review-related worktrees.

## Failure Classes

- `transient-runtime`: worker spawn, no-output, or overall timeout problems. Arc schedules one automatic retry after a 15-minute backoff.
- `engine-auth`: Claude/Codex auth is missing or expired. Fix auth before retrying.
- `engine-capacity`: the engine is rate-limited or quota-constrained. Wait for capacity recovery before retrying.
- `task-error`: the worker ran and failed in a way that looks task-specific. Inspect output before retrying.
- `operator-needed`: ambiguous or workflow-level failures that need a human decision.

## Auto-Retry Rules

- Arc automatically retries only `transient-runtime` failures.
- Each task gets one automatic retry per failure burst.
- The backoff is 15 minutes.
- When the retry budget is spent, the task moves to `blocked` with an operator hint.

Queued tasks that are waiting on retry backoff do not count as active work for stall detection.

## Cleanup Safety

`arc cleanup --apply` only deletes:

- completed or cancelled worker worktrees older than the retention window
- archived stdout/stderr log files older than the retention window
- orphan gateway lock files with no live PID and no local listener

It does not delete:

- blocked worktrees
- failed worktrees
- review-related worktrees

## Manual Recovery

If `arc status` shows `engine-auth`:

```bash
cd /srv/arc/repo
bash scripts/arc-self-drive/install-engine-auth.sh
arc self-drive tick
```

If a task is `blocked` with `task-error` or `operator-needed`:

1. Inspect the latest run in `arc status` or the dashboard.
2. Fix the repo/config issue.
3. Requeue the task by moving it back to `planning` or `in_progress`.

If the VPS is healthy but cluttered:

```bash
arc cleanup
arc cleanup --apply
```
