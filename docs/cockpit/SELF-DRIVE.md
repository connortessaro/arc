# Arc Self-Drive

Arc can now run a constrained self-drive loop on the VPS:

- it bootstraps work from `docs/cockpit/FAST-TODO.md`
- it accepts queued task and review updates over the remote gateway, so you can steer it from your Mac CLI without SSHing into the VPS
- it creates isolated worktree workers
- it keeps polling for the next eligible worker without waiting for chat prompts
- it allows local branch commits
- it does not push or merge
- it treats `/srv/arc/repo` as the canonical Arc checkout
- it can expose `arc` and `openclaw` as real VPS commands so you do not have to remember repo-local script paths

## Commands

Use the VPS operator shell commands after installing the runtime:

```bash
arc
arc status
arc do "Build the next Arc feature"
arc tasks --json
arc reviews --json
arc approve review_123
arc daemon status
```

Run one supervisor cycle through the gateway:

```bash
openclaw code supervisor tick --repo /srv/arc/repo --json
```

Queue a new Arc task from your Mac when `gateway.mode=remote` points at the VPS:

```bash
openclaw code task add "Build the next Arc feature" --repo /srv/arc/repo --priority high --json
openclaw code review list --json
openclaw code review status review_123 approved --json
```

Or use the repo-local remote wrapper from your Mac without touching global CLI config:

```bash
cd /Users/tessaro/openclaw/.worktrees/coding-cockpit
bash scripts/arc-self-drive/mac-remote-code.sh task list --json
bash scripts/arc-self-drive/mac-remote-code.sh review list --json
bash scripts/arc-self-drive/mac-remote-code.sh review status review_123 approved --json
```

Run one supervisor cycle directly from source on the VPS:

```bash
cd /srv/arc/repo
bash scripts/arc-self-drive/run-supervisor-tick.sh --repo /srv/arc/repo
```

Check gateway and engine health on the VPS:

```bash
cd /srv/arc/repo
bash scripts/arc-self-drive/healthcheck.sh
```

Install the source-based gateway service and self-drive timer on the VPS:

```bash
cd /srv/arc/repo
bash scripts/arc-self-drive/install-systemd.sh
```

That installer now also installs user-level `arc` and `openclaw` shims into `~/.local/bin`
and adds `~/.local/bin` plus `~/.npm-global/bin` to the shell `PATH`.

Persist Claude's unattended token from the current VPS shell into the service/timer environment:

```bash
cd /srv/arc/repo
export CLAUDE_CODE_OAUTH_TOKEN='...'
bash scripts/arc-self-drive/install-engine-auth.sh
```

Deploy the current branch to the VPS checkout and restart the runtime cleanly:

```bash
cd /srv/arc/repo
bash scripts/arc-self-drive/deploy.sh
```

`deploy.sh` waits for the source gateway to answer `127.0.0.1:${OPENCLAW_GATEWAY_PORT:-18789}/health`
before it exits. On a cold source restart, that can take around 1–2 minutes.

Inspect the current self-drive queue, running workers, and latest runs:

```bash
cd /srv/arc/repo
bash scripts/arc-self-drive/status.sh
```

Install notes:

- the installer also rewrites `~/.openclaw/openclaw.json` so:
  - `codex-cli` uses the user-local CLI binary under `~/.npm-global/bin/codex`
  - Codex workers run with `--dangerously-bypass-approvals-and-sandbox` on the VPS
  - `claude-cli` points at `~/.npm-global/bin/claude`
- the systemd units now read `~/.config/arc-self-drive/engine.env` if it exists
- `healthcheck.sh` reports whether that env file exists, so unattended auth drift is visible
- add `[engine:claude]` or `[engine:codex]` to a task title/goal/notes when a task must use one engine
- if Claude hits a usage-limit or rate-limit style failure, self-drive cools it down for six hours and lets Codex carry the queue

## Current Policy

- one worker per supervisor tick
- default engine order is Claude first, then Codex as fallback when Claude is unavailable or cooling down after a usage-limit failure
- Claude becomes fully unattended only after its token is persisted into the service env file
- task source order is explicit queue first, then unchecked items in `docs/cockpit/FAST-TODO.md`
- `openclaw code task *` and `openclaw code review *` use the remote gateway automatically when `gateway.mode=remote`, so the VPS queue can be managed from the Mac CLI
- `scripts/arc-self-drive/mac-remote-code.sh` opens a temporary SSH tunnel, reads the active VPS gateway token, and runs the source CLI in remote mode without changing your global config
- `scripts/arc-self-drive/run-code-via-gateway.sh` forces `openclaw code` traffic through the live gateway on the VPS instead of mutating the cockpit store directly from a second process
- completed work lands in review; self-drive pauses new work when there are 3 pending reviews
- `approved` marks the task done, `changes_requested` reopens it for another worker pass, and `dismissed` cancels it
- `deploy.sh` is the canonical VPS refresh path; it fast-forwards the current branch, refreshes dependencies, rewrites the systemd units, restarts the gateway, and leaves the timer enabled
