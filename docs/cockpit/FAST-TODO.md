# Arc Fast TODO

Arc is the product/app name. OpenClaw remains the backend runtime.

This is the short execution track for getting Arc to useful as fast as
possible. Keep `docs/cockpit/TODO.md` as the long backlog.

## Switch Threshold

Arc becomes the default when these are all done:

- [x] manage workers in-app
- [ ] inspect logs and latest run state in-app
- [ ] route completed and blocked work into clear queues
- [ ] reopen the app without losing project context

## Phase A: Better Than Terminal

- [x] Add native worker controls: start, pause, resume, cancel
- [x] Add selected worker detail panel
- [x] Add selected worker log tail panel
- [ ] Add blocked / needs-input queue
- [ ] Add review-ready queue
- [ ] Add workspace persistence

## Phase B: Replace 4 Terminals

- [ ] Add embedded PTY terminal lanes
- [ ] Bind terminal lanes to worktrees
- [ ] Add default 3-worker + 1-review layout
- [ ] Save and restore project layouts

## Phase C: Always-On

- [ ] Add durable async orchestration mode
- [ ] Add VPS/hybrid control-plane path if still needed

## Not Now

- [ ] broad product polish for strangers
- [ ] hosted-first architecture
- [ ] generalized platform abstractions
- [ ] advanced memory/retrieval work
