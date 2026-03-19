# Elite Developer Cockpit v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the native macOS cockpit shell into a usable operator surface for gateway-owned coding workers.

**Architecture:** Keep OpenClaw as the control plane and runtime owner. The macOS app becomes the thin shell for worker actions, logs, review context, and later PTY lanes. Do not move orchestration logic into Swift.

**Tech Stack:** TypeScript gateway/runtime, SwiftUI/AppKit macOS shell, Swift Package Manager tests, Vitest for backend tests.

---

### Task 1: Make The Native Cockpit Actionable

**Files:**

- Modify: `apps/macos/Sources/OpenClaw/CockpitStore.swift`
- Modify: `apps/macos/Sources/OpenClaw/CockpitWindow.swift`
- Modify: `apps/macos/Sources/OpenClaw/GatewayConnection.swift`
- Test: `apps/macos/Tests/OpenClawIPCTests/CockpitWindowSmokeTests.swift`

**Step 1: Add worker lifecycle actions to the gateway client**

Add typed wrappers for:

- `code.worker.start`
- `code.worker.send`
- `code.worker.pause`
- `code.worker.resume`
- `code.worker.cancel`

**Step 2: Add async action methods to `CockpitStore`**

Add store methods that:

- dispatch one gateway call
- set a transient loading state
- refresh workspace summary on success
- capture error text for the UI

**Step 3: Add worker action controls to `CockpitWindow`**

Add visible controls for the selected worker:

- `Start`
- `Pause`
- `Resume`
- `Cancel`

**Step 4: Add smoke coverage**

Extend `CockpitWindowSmokeTests.swift` to verify the UI renders these controls
for representative worker states.

**Step 5: Verify**

Run:

```bash
source scripts/use-xcode-developer-dir.sh
cd apps/macos
swift test --filter CockpitWindowSmokeTests
```

### Task 2: Add Run Detail And Logs

**Files:**

- Modify: `src/code-cockpit/runtime.ts`
- Modify: `src/gateway/server-methods/code-cockpit.ts`
- Modify: `apps/macos/Sources/OpenClaw/CockpitData.swift`
- Modify: `apps/macos/Sources/OpenClaw/CockpitStore.swift`
- Modify: `apps/macos/Sources/OpenClaw/CockpitWindow.swift`
- Test: `src/code-cockpit/gateway-handlers.test.ts`

**Step 1: Expose lane-friendly run detail from the gateway**

Add or extend a summary/read method so the native app can fetch:

- selected worker latest run id
- status
- timestamps
- recent stdout/stderr tail

**Step 2: Model run detail in Swift**

Add native data structs for run detail and log tail payloads.

**Step 3: Show a log panel in the cockpit window**

The selected worker should show:

- current state
- last exit reason
- bounded log tail

**Step 4: Verify**

Run:

```bash
pnpm exec vitest run --config vitest.unit.config.ts \
  src/code-cockpit/gateway-handlers.test.ts \
  src/code-cockpit/runtime.test.ts \
  --maxWorkers=1
```

### Task 3: Add Review Lane Basics

**Files:**

- Modify: `src/code-cockpit/store.ts`
- Modify: `src/code-cockpit/runtime.ts`
- Modify: `src/gateway/server-methods/code-cockpit.ts`
- Modify: `apps/macos/Sources/OpenClaw/CockpitData.swift`
- Modify: `apps/macos/Sources/OpenClaw/CockpitWindow.swift`
- Test: `src/code-cockpit/store.test.ts`

**Step 1: Ensure worker completion maps cleanly into review state**

Make review-ready state obvious in the summary model:

- awaiting review
- failed
- cancelled

**Step 2: Add a visible review lane in Swift**

Show a separate area for:

- workers awaiting review
- latest completed/failed run

**Step 3: Verify**

Run:

```bash
pnpm exec vitest run --config vitest.unit.config.ts src/code-cockpit/store.test.ts --maxWorkers=1
source scripts/use-xcode-developer-dir.sh
cd apps/macos
swift test --filter CockpitWindowSmokeTests
```

### Task 4: Add Embedded Terminal Lane Foundations

**Files:**

- Create: `apps/macos/Sources/OpenClaw/CockpitTerminalSession.swift`
- Modify: `apps/macos/Sources/OpenClaw/CockpitData.swift`
- Modify: `apps/macos/Sources/OpenClaw/CockpitStore.swift`
- Modify: `apps/macos/Sources/OpenClaw/CockpitWindow.swift`

**Step 1: Define a local terminal lane model**

Track:

- repo root
- worktree path
- lane id
- backend/profile
- optional linked worker id

**Step 2: Add placeholder lane rendering first**

Do not implement PTY transport yet. First land:

- lane list
- selected lane state
- layout intent in the store

**Step 3: Verify**

Run:

```bash
source scripts/use-xcode-developer-dir.sh
cd apps/macos
swift test --filter CockpitWindowSmokeTests
```

### Task 5: Add Workspace Persistence

**Files:**

- Modify: `src/code-cockpit/store.ts`
- Modify: `src/code-cockpit/runtime.ts`
- Modify: `apps/macos/Sources/OpenClaw/CockpitStore.swift`
- Modify: `apps/macos/Sources/OpenClaw/CockpitWindow.swift`
- Test: `src/code-cockpit/store.test.ts`

**Step 1: Persist selected project and lane layout state**

Persist only what the app needs to restore context:

- selected repo root
- selected worker
- lane ordering
- review lane visibility

**Step 2: Hydrate on app open**

The cockpit should reopen into the last project context instead of a blank
window.

**Step 3: Verify**

Run:

```bash
pnpm exec vitest run --config vitest.unit.config.ts src/code-cockpit/store.test.ts --maxWorkers=1
```

## Exit Criteria For v1 Alpha

- one native cockpit window opens from the app menu
- workers can be started, paused, resumed, and cancelled from the window
- selected worker logs are visible in-app
- review-ready workers are visible in a dedicated lane
- workspace state restores on reopen

Plan complete and saved to `docs/plans/2026-03-19-elite-developer-cockpit-v1.md`.
