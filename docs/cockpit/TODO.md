# Arc TODO

Arc is the product/app name. OpenClaw remains the backend runtime and control
plane while internal code symbols still use `Cockpit*`.

## Done

- [x] Create `openclaw code` command family
- [x] Add durable coding cockpit store
- [x] Add gateway-owned worker runtime
- [x] Add native macOS Arc window shell
- [x] Add Arc workspace summary RPC
- [x] Fix macOS Swift toolchain selection for Arc smoke testing

## Now

- [x] Add native worker controls: start, pause, resume, cancel
- [x] Show worker status and latest run state in the cockpit window
- [x] Show log tail for the selected worker/run
- [x] Add native smoke tests for cockpit interactions beyond render-only

## Next

- [x] Add review queue UI for completed and failed runs
- [ ] Add blocked / needs-input queue UI
- [ ] Expose run summaries and review-ready artifacts from the gateway
- [ ] Add diff/test/log review lane in the native window
- [ ] Add project/workspace persistence for cockpit layout

## After That

- [ ] Add PTY-backed embedded terminal lanes
- [ ] Bind terminal lanes to repo root + worktree + backend profile
- [ ] Add saved lane layouts per project
- [ ] Add backend/model selection per lane and per worker

## Nice To Have Later

- [ ] Add a richer Arc home across multiple projects
- [ ] Push subscriptions instead of summary-only refresh for cockpit state
- [ ] Mixed local interactive sessions plus background workers in one workspace
- [ ] Better review handoff from worker completion to merge-ready output
- [ ] Obsidian-aware spec handoff into Arc task creation

## Definition Of “Real App”

The cockpit becomes a real daily-driver app when all of these are true:

- [x] You can open one native window and manage workers there
- [ ] You can inspect logs and run state without dropping to terminal
- [ ] You can review finished and blocked work in dedicated lanes
- [ ] You can keep local terminal lanes inside the same app

## Product Direction

Arc v1 is a personal project cockpit:

- Swift app = flagship review-and-steer workstation
- VPS TUI = remote operator console
- OpenClaw = runtime and control plane
- Claude and Codex = worker engines

The first flagship milestone is the review workstation, not a full editor and
not a multi-user collaboration surface.

## Blockers

Current blocker count: `0`

The previous macOS build blocker was resolved by routing macOS Swift commands
through the Xcode toolchain helper.
