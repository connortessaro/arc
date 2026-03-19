# Arc Self-Drive

Arc can now run a constrained self-drive loop on the VPS:

- it bootstraps work from `docs/cockpit/FAST-TODO.md`
- it creates isolated worktree workers
- it starts or resumes one eligible worker at a time
- it allows local branch commits
- it does not push or merge

## Commands

Run one supervisor cycle through the gateway:

```bash
openclaw code supervisor tick --repo /srv/arc/repo --json
```

Run one supervisor cycle directly from source on the VPS:

```bash
cd /srv/arc/repo
node --import tsx scripts/arc-self-drive/supervisor-tick.ts --repo /srv/arc/repo
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

Install notes:

- the installer also rewrites `~/.openclaw/openclaw.json` so:
  - `codex-cli` uses the user-local CLI binary under `~/.npm-global/bin/codex`
  - Codex workers run with `--dangerously-bypass-approvals-and-sandbox` on the VPS
  - `claude-cli` points at `~/.npm-global/bin/claude`

## Current Policy

- one worker per supervisor tick
- default engine is Codex
- Claude is available as an engine adapter when the CLI is installed and authenticated
- self-drive tasks are imported from unchecked items in `docs/cockpit/FAST-TODO.md`
- completed work lands in review; self-drive does not push or merge
