# Arc Architecture

Arc is the product/workstation name.
OpenClaw remains the runtime owner and control plane.

## Goal

Build a workstation that replaces the current multi-terminal, multi-window
agent workflow with:

- a global Arc home across projects
- a project workspace focused on review and steering
- gateway-owned background workers
- a remote ops console on the VPS

## Product Shape

### Arc home

The top-level Arc surface should show:

- projects
- active workers across projects
- blocked / needs-input items
- attention queue

This is the “body” layer of Arc.

### Project workspace

Each project workspace should center on:

- review queue
- blocked / needs-input queue
- changed files and diffs
- tests and logs
- recent runs and worker summaries

This is the main daily-driver surface for the human.

### Worker detail

Worker detail should show:

- run summary
- branch/worktree info
- latest logs
- control actions

### TUI console

The TUI should remain the fast VPS operator surface for:

- health
- queue
- unblock / retry
- active worker inspection
- quick intervention

It is important, but it is not the flagship product surface.

## Product Split

### OpenClaw control plane

OpenClaw remains the backend owner for:

- task, worker, run, review, and decision persistence
- worktree creation and branch naming
- worker lifecycle: `start`, `send`, `pause`, `resume`, `cancel`
- gateway RPCs consumed by the app and TUI

Key files:

- `src/code-cockpit/store.ts`
- `src/code-cockpit/runtime.ts`
- `src/gateway/server-methods/code-cockpit.ts`

### Swift macOS Arc shell

The macOS app is the flagship Arc surface for:

- project/workspace selection
- review and blocked-item UX
- worker detail
- diffs, tests, and run summaries
- future embedded terminal lanes

Key files:

- `apps/macos/Sources/OpenClaw/CockpitData.swift`
- `apps/macos/Sources/OpenClaw/CockpitStore.swift`
- `apps/macos/Sources/OpenClaw/CockpitWindow.swift`
- `apps/macos/Sources/OpenClaw/GatewayConnection.swift`

## Current Runtime Model

### Durable entities

The persisted cockpit store tracks:

- `Task`
- `WorkerSession`
- `Run`
- `ReviewRequest`
- `DecisionLog`
- `ContextSnapshot`

### Worker ownership

Workers are gateway-owned.
The app and TUI are not allowed to become the runtime owner.
Closing an Arc surface should not terminate active workers if the gateway is
still running.

### Worktree model

Workers run in isolated worktrees with predictable paths and branches.
This prevents worker collisions and makes review/cleanup deterministic.

## What Exists Right Now

### Backend

- `openclaw code` command family exists
- worker runtime exists
- gateway methods exist
- workspace summary RPC exists
- self-drive loop exists on the VPS

### Product surfaces

- a native Arc window exists
- a VPS TUI exists
- the app can render current summary data and worker state
- the TUI can operate the live VPS queue

## What Is Missing

### Immediate

- blocked / needs-input queue in the app
- review queue in the app
- run summary surface in the app
- diff/test/log review lane

### Next

- project/workspace persistence
- stronger global project home
- better visual polish for the TUI

### Later

- PTY-backed embedded terminal lanes
- per-lane backend/model picker
- local interactive sessions beside background workers

## Build Constraint To Remember

The macOS app must build under the full Xcode developer dir, not just Command
Line Tools, because SwiftUI macro/plugin dependencies require Xcode’s toolchain
layout.

Helper:

- `scripts/use-xcode-developer-dir.sh`
