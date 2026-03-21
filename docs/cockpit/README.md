# Arc Context

Arc is the product/app/workstation name.
OpenClaw remains the runtime and control plane.

This folder is the durable context for building Arc as a **personal project
cockpit**. Read this before continuing implementation from chat history.

## Product Direction

Arc is not being built as:

- a generic AI shell
- a full editor-first IDE
- a daemon console as the final product

Arc is being built as:

- a global home across projects
- a project workspace for review and steering
- a persistent worker system that keeps moving while you are away
- a workstation that fits real Git/GitHub/open-source collaboration

The center of the product is **review, steering, and momentum**, not prompting.

## Current State

As of `2026-03-20`, Arc has a real backend and an early product shell.

Implemented:

- `openclaw code` CLI surface and persisted cockpit store
- gateway-owned worker runtime with worktree-aware worker sessions
- native macOS cockpit window and menu entry
- workspace summary RPC from gateway to native app
- native worker controls and selected-worker log panel
- review queue for completed/failed workers with approve/dismiss/changes-requested actions
- remote gateway status banner with reconnect path
- self-drive supervisor loop with Claude-first routing and Codex fallback
- source-based VPS gateway runner and self-drive systemd installer
- VPS-first canonical repo/runtime workflow for async Arc development
- VPS operator dashboard via `arc` / `openclaw code tui`

Not implemented yet:

- blocked / needs-input queue UI
- diff/test/log review lane
- full project/workspace persistence
- richer global multi-project home

## What The Swift App Must Become

The Swift app is the flagship Arc surface.
Its job is to become a real **review workstation**.

That means:

- project header and project context
- review queue first
- blocked / needs-input queue
- worker detail
- changed files and diffs
- tests, logs, and run summaries

It does not need to become a full code editor before it becomes valuable.

## What The TUI Must Become

The TUI is the fast remote operator console.
Its job is:

- health
- queue
- unblock / retry
- inspect active workers
- intervene quickly while the VPS keeps running

It should become better-looking and more functional, but it is still the ops
face of Arc, not the flagship product surface.

## Reading Order

1. `VISION.md`
2. `PRODUCT-SPLIT.md`
3. `docs/cockpit/ARCHITECTURE.md`
4. `docs/plans/2026-03-20-arc-v1-product-spec.md`
5. `docs/cockpit/FAST-TODO.md`
6. `docs/cockpit/SELF-DRIVE.md`
7. `docs/cockpit/OPS-RUNBOOK.md`
8. `docs/cockpit/TODO.md`

## Useful Commands

VPS operator commands:

```bash
arc
arc self-drive
arc dashboard
arc status
arc cleanup
arc do "Ship the next Arc feature"
arc tasks --json
arc reviews --json
openclaw code tui --repo /srv/arc/repo
cd /srv/arc/repo && bash scripts/arc-self-drive/deploy.sh
```

On a Mac without `systemctl`, `arc` behaves as a thin SSH client to the VPS
operator shell. `arc`, `arc dashboard`, `arc do`, `arc tasks`, `arc reviews`,
`arc self-drive`, `arc daemon ...`, `arc status`, and `arc tick` all delegate
to the VPS over `ssh`.

## Current Code Map

Backend orchestration:

- `src/code-cockpit/store.ts`
- `src/code-cockpit/runtime.ts`
- `src/gateway/server-methods/code-cockpit.ts`
- `src/gateway/server-methods.ts`
- `src/gateway/server-methods-list.ts`
- `src/gateway/method-scopes.ts`

CLI and TUI:

- `src/cli/code-cli.ts`
- `src/commands/code.ts`
- `src/code-cockpit/tui.ts`
- `scripts/arc-self-drive/arc.sh`

Native macOS shell:

- `apps/macos/Sources/OpenClaw/CockpitData.swift`
- `apps/macos/Sources/OpenClaw/CockpitStore.swift`
- `apps/macos/Sources/OpenClaw/CockpitWindow.swift`
- `apps/macos/Sources/OpenClaw/GatewayConnection.swift`

## Practical Meaning

The system is now split correctly:

- OpenClaw owns worker orchestration and durable state
- the VPS is the canonical async execution body
- the TUI is the remote ops console
- the Swift app is the flagship Arc direction
- the next work should make the app feel like a review workstation, not just
  widen backend capability
