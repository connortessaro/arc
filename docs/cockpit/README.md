# Arc Context

Arc is the product/app name. OpenClaw remains the runtime and control plane.
This folder is the durable context for the native Arc operator shell work. Read
this before continuing implementation from chat history.

## Status

As of `2026-03-19`, Arc exists as a real native macOS shell, but it is not a
daily-driver developer environment yet.

Implemented:

- `openclaw code` CLI surface and persisted cockpit store
- gateway-owned worker runtime with worktree-aware worker sessions
- native macOS cockpit window and menu entry
- workspace summary RPC from gateway to native app
- native worker controls and selected-worker log panel
- remote gateway status banner with reconnect path
- macOS Swift toolchain helper so cockpit smoke tests build under full Xcode
- self-drive supervisor loop with Codex and Claude worker engines
- source-based VPS gateway runner and self-drive systemd installer
- VPS-first canonical repo/runtime workflow for async Arc development
- Claude-first self-drive routing with Codex fallback on the VPS
- queue-first self-drive with auto-continue on successful unattended runs
- remote-aware `openclaw code task` / `review` commands so the VPS queue can be managed from the Mac CLI
- VPS operator dashboard via `arc` / `openclaw code tui`

Not implemented yet:

- review/diff/test surface
- embedded PTY terminal lanes
- saved per-project cockpit layout

## Reading Order

1. `PRODUCT-SPLIT.md`
2. `docs/cockpit/ARCHITECTURE.md`
3. `docs/cockpit/FAST-TODO.md`
4. `docs/cockpit/SELF-DRIVE.md`

Useful VPS commands:

```bash
arc
arc dashboard
arc status
arc do "Ship the next Arc feature"
arc tasks --json
arc reviews --json
openclaw code tui --repo /srv/arc/repo
cd /srv/arc/repo && bash scripts/arc-self-drive/deploy.sh
```

Useful Mac-side queue commands when `gateway.mode=remote` targets the VPS:

```bash
openclaw code task add "Ship the next Arc feature" --repo /srv/arc/repo --priority high --json
openclaw code task list --json
openclaw code review list --json
openclaw code review status review_123 approved --json
```

If you do not want to switch your global CLI config yet, use the repo-local wrapper instead:

```bash
cd /Users/tessaro/openclaw/.worktrees/coding-cockpit
bash scripts/arc-self-drive/mac-remote-code.sh task list --json
bash scripts/arc-self-drive/mac-remote-code.sh review list --json
```

Persist Claude for unattended service use:

```bash
cd /srv/arc/repo
export CLAUDE_CODE_OAUTH_TOKEN='...'
bash scripts/arc-self-drive/install-engine-auth.sh
```

5. `docs/cockpit/TODO.md`
6. `docs/plans/2026-03-19-elite-developer-cockpit-v1.md`

## Current Code Map

Backend orchestration:

- `src/code-cockpit/store.ts`
- `src/code-cockpit/runtime.ts`
- `src/gateway/server-methods/code-cockpit.ts`
- `src/gateway/server-methods.ts`
- `src/gateway/server-methods-list.ts`
- `src/gateway/method-scopes.ts`

CLI:

- `src/cli/code-cli.ts`
- `src/commands/code.ts`
- `src/cli/program/register.subclis.ts`
- `src/cli/program/subcli-descriptors.ts`

Native macOS shell:

- `apps/macos/Sources/OpenClaw/CockpitData.swift`
- `apps/macos/Sources/OpenClaw/CockpitStore.swift`
- `apps/macos/Sources/OpenClaw/CockpitWindow.swift`
- `apps/macos/Sources/OpenClaw/GatewayConnection.swift`
- `apps/macos/Sources/OpenClaw/MenuContentView.swift`

Tests:

- `src/code-cockpit/store.test.ts`
- `src/code-cockpit/runtime.test.ts`
- `src/code-cockpit/gateway-handlers.test.ts`
- `src/cli/code-cli.test.ts`
- `src/cli/code-cli.worker-gateway.test.ts`
- `apps/macos/Tests/OpenClawIPCTests/CockpitWindowSmokeTests.swift`

macOS build helper:

- `scripts/use-xcode-developer-dir.sh`

## Commands That Matter

TypeScript verification:

```bash
pnpm exec vitest run --config vitest.unit.config.ts \
  src/code-cockpit/store.test.ts \
  src/code-cockpit/runtime.test.ts \
  src/code-cockpit/gateway-handlers.test.ts \
  src/cli/code-cli.test.ts \
  src/cli/code-cli.worker-gateway.test.ts \
  --maxWorkers=1
```

macOS smoke test:

```bash
source scripts/use-xcode-developer-dir.sh
cd apps/macos
swift test --filter CockpitWindowSmokeTests
```

## Practical Meaning

The system is now split correctly:

- OpenClaw owns worker orchestration and durable state
- the macOS app owns the future cockpit UX
- the VPS checkout is the canonical async development runtime
- the Mac CLI can queue and review remote work without SSHing into the VPS
- the repo-local remote wrapper can drive the VPS queue without changing your global OpenClaw config
- the VPS dashboard gives Arc a simple operator surface without replacing the desktop app direction
- the Mac stays responsible for Swift/macOS verification

The next work should make the native window useful, not broaden the backend
without an operator surface.
