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
- `arc` now opens a VPS dashboard TUI by default, so the operator surface does not depend on memorizing subcommands
- `arc self-drive` is the shortest path to start or inspect the background loop without remembering `daemon` plus `tick`
- when `arc` runs on a machine without `systemctl` available, it now acts as a thin SSH client to the VPS operator shell instead of trying to boot a second local runtime

## Commands

Use these commands from either the VPS shell or your Mac when `arc-droplet` SSH access works.
On the Mac, `arc` delegates the operator command to the VPS `arc` wrapper over `ssh`:

```bash
arc
arc self-drive
arc drive status
arc dashboard
arc status
arc do "Build the next Arc feature"
arc tasks --json
arc reviews --json
arc approve review_123
arc daemon status
```

Run one supervisor cycle through the gateway:

```bash
openclaw code tui --repo /srv/arc/repo
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

Configure Telegram runtime alerts and the hourly summary job:

```bash
cd /srv/arc/repo
bash scripts/arc-self-drive/configure-telegram-monitoring.sh
```

If you want to stage the units before entering the bot token, seed the template only:

```bash
cd /srv/arc/repo
bash scripts/arc-self-drive/install-telegram-monitoring.sh
```

That writes `~/.config/arc-self-drive/telegram-watchdog.env`, installs the
`arc-telegram-watchdog.service` plus `arc-telegram-watchdog.timer` user units,
and configures an hourly OpenClaw cron summary once `ARC_TELEGRAM_BOT_TOKEN`
and `ARC_TELEGRAM_CHAT_ID` are present.

That installer now also installs user-level `arc` and `openclaw` shims into `~/.local/bin`
and adds `~/.local/bin` plus `~/.npm-global/bin` to the shell `PATH`.

Persist Claude's unattended token from the current VPS shell into the service/timer environment:

```bash
cd /srv/arc/repo
export CLAUDE_CODE_OAUTH_TOKEN='...'
bash scripts/arc-self-drive/install-engine-auth.sh
```

Persist the Arc-only GitHub token for draft PR publishing from successful worker branches:

```bash
export ARC_SELF_DRIVE_GITHUB_TOKEN='github_token_here'
bash scripts/arc-self-drive/install-github-auth.sh
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
- Telegram monitoring reads `~/.config/arc-self-drive/telegram-watchdog.env`
- `healthcheck.sh` reports whether that env file exists, so unattended auth drift is visible
- add `[engine:claude]` or `[engine:codex]` to a task title/goal/notes when a task must use one engine
- set `ARC_SELF_DRIVE_STRICT_ENGINE=claude` in `~/.config/arc-self-drive/engine.env` when the queue must never fall back to Codex
- if Claude hits a usage-limit or rate-limit style failure, self-drive cools it down for six hours and lets Codex carry the queue
- the Telegram watchdog sends transition-based alerts directly through the Bot API, so primary runtime alerts still fire even if the OpenClaw gateway scheduler is down

## Current Policy

- one worker per supervisor tick
- default engine order is Claude first, then Codex as fallback when Claude is unavailable or cooling down after a usage-limit failure
- `ARC_SELF_DRIVE_STRICT_ENGINE=claude` or `codex` disables fallback entirely and overrides per-task engine hints until the selected engine is healthy again
- Claude becomes fully unattended only after its token is persisted into the service env file
- draft PR publishing becomes fully unattended only after `gh` and `ARC_SELF_DRIVE_GITHUB_TOKEN` are installed through `install-github-auth.sh`
- task source order is explicit queue first, then unchecked items in `docs/cockpit/FAST-TODO.md`
- `openclaw code task *` and `openclaw code review *` use the remote gateway automatically when `gateway.mode=remote`, so the VPS queue can still be managed from the Mac CLI
- `scripts/arc-self-drive/mac-remote-code.sh` opens a temporary SSH tunnel, reads the active VPS gateway token, and runs the source CLI in remote mode without changing your global config
- `scripts/arc-self-drive/run-code-via-gateway.sh` forces `openclaw code` traffic through the live gateway on the VPS instead of mutating the cockpit store directly from a second process
- `arc` and `openclaw code tui` open the same VPS dashboard; on the Mac this happens through SSH passthrough to the VPS dashboard, not through a local TypeScript runtime
- successful unattended runs mark the worker `completed`, mark the task `done`, and let the queue continue
- failed unattended runs mark the worker `failed` and move the task to `blocked`, so bad work becomes visible instead of silently retrying
- manual reviews still work when they exist: `approved` marks the task done, `changes_requested` reopens it for another worker pass, and `dismissed` cancels it
- `deploy.sh` is the canonical VPS refresh path; it fast-forwards the current branch, refreshes dependencies, rewrites the systemd units, restarts the gateway, and leaves the timer enabled
