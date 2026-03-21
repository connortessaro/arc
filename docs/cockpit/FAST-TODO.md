# Arc Fast TODO

Arc is the product and workstation. OpenClaw remains the backend runtime and
control plane.

This is the shortest path to making Arc feel like a real review-and-steer
workstation. Keep `docs/cockpit/TODO.md` as the longer backlog.

## Switch Threshold

Arc becomes the default daily surface when these are all done:

- [ ] route completed, blocked, and needs-input work into clear queues
- [ ] inspect logs and latest run state in-app
- [ ] review changed work in a dedicated lane without dropping to terminal
- [ ] reopen the app without losing project context

## Phase A: Review Workstation

- [x] Add native worker controls: start, pause, resume, cancel
- [x] Add selected worker detail panel
- [x] Add selected worker log tail panel
- [ ] Add blocked / needs-input queue
- [ ] Add review-ready queue
- [ ] Expose run summaries and review-ready artifacts from the gateway
- [ ] Add diff/test/log review lane
- [ ] Add workspace persistence

## Phase B: Embedded Execution Surface

- [ ] Add embedded PTY terminal lanes
- [ ] Bind terminal lanes to worktrees
- [ ] Add default 3-worker + 1-review layout
- [ ] Save and restore project layouts

## Phase C: Always-On Arc

- [x] Add durable async orchestration mode
- [x] Add VPS / hybrid control-plane path
- [ ] Make the VPS TUI a clearer operator console for health, queue, and unblock

## Not Now

- [ ] broad product polish for strangers
- [ ] hosted-first architecture
- [x] generalized platform abstractions
- [ ] multi-user shared cockpit state
- [ ] advanced memory / retrieval work
- [ ] full-editor ambitions before the review workstation is strong
