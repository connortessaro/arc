# Arc Architecture

Arc is the product/app name. OpenClaw remains the runtime owner and control
plane.

## Goal

Build a native macOS developer shell that can replace the current
multi-terminal workflow with:

- gateway-owned background workers
- embedded local terminal lanes
- a review lane for logs, diffs, and tests

## Product Split

### OpenClaw control plane

OpenClaw remains the backend owner for:

- task, worker, run, review, and decision persistence
- worktree creation and branch naming
- worker lifecycle: `start`, `send`, `pause`, `resume`, `cancel`
- gateway RPCs consumed by the native app

Key files:

- `src/code-cockpit/store.ts`
- `src/code-cockpit/runtime.ts`
- `src/gateway/server-methods/code-cockpit.ts`

### Native macOS Arc shell

The macOS app is the operator surface for:

- project/workspace selection
- lane layout
- worker controls
- log and review UX
- future embedded terminal panes

Key files:

- `apps/macos/Sources/OpenClaw/CockpitData.swift`
- `apps/macos/Sources/OpenClaw/CockpitStore.swift`
- `apps/macos/Sources/OpenClaw/CockpitWindow.swift`
- `apps/macos/Sources/OpenClaw/GatewayConnection.swift`

## Current Runtime Model

### Durable entities

The persisted coding cockpit store tracks:

- `Task`
- `WorkerSession`
- `Run`
- `ReviewRequest`
- `DecisionLog`
- `ContextSnapshot`

### Worker ownership

Workers are gateway-owned. The native app is not allowed to become the runtime
owner. Closing the Arc window should not terminate active workers if the
gateway is still running.

### Worktree model

Workers are intended to run in isolated worktrees with predictable paths and
branches. The point is to prevent worker collisions and make review/cleanup
deterministic.

## What Exists Right Now

### Backend

- `openclaw code` command family exists
- worker runtime exists
- gateway methods exist
- workspace summary RPC exists for the native shell

### Native shell

- menu entry opens the cockpit window
- a native cockpit store exists
- the window can render current summary data

## What Is Missing

### Immediate

- worker action buttons in the native cockpit
- live log streaming or polling in the native cockpit
- run detail surface

### Next

- review-ready artifacts in the native cockpit
- diff/test panel
- project workspace save/restore

### Later

- PTY-backed embedded terminal lanes
- per-lane backend/model picker
- local interactive session model beside worker sessions

## Build Constraint To Remember

The macOS app must build under the full Xcode developer dir, not just Command
Line Tools, because SwiftUI macro/plugin dependencies require Xcode’s toolchain
layout.

Helper:

- `scripts/use-xcode-developer-dir.sh`
