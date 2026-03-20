<div align="center">

# Arc

### A personal project cockpit for building software with persistent agent workers.

`review-and-steer` · `always-on` · `vps-first runtime` · `swift flagship app` · `claude-first` · `codex fallback`

</div>

Arc is built around a simple belief:

the next step after today’s IDEs and AI coding tools is not more autocomplete,
more chat panes, or a better one-off session.

The next step is a system that can **keep software moving**.

Arc is meant to be that system.

---

## The Leap

Current agent workflows usually die the same way:

- a strong session
- a burst of progress
- a lot of context in your head
- then the shell closes and the momentum disappears

Arc exists to replace that with something stronger:

- persistent backlog
- durable worker state
- isolated worktrees
- asynchronous execution
- blocked queues and review queues
- a cockpit you can return to instead of a terminal transcript

Arc should feel like a **workstation for software momentum**, not a prompt box
with file access.

## What Arc Is

Arc is a **personal project cockpit**.

It is designed for one human to:

- operate multiple projects from one place
- hand work to persistent Claude and Codex workers
- review diffs, changed files, tests, and run summaries
- unblock work when agents get stuck
- keep moving across personal projects, work projects, and open source

Arc is personal-first in v1, but it should already fit real collaborative
software work through normal Git and GitHub workflows.

## What Arc Is Not

Arc is not:

- a chatbot
- a full editor-first IDE in v1
- a terminal wrapper as the end state
- a replacement model runtime
- a shared multi-user cockpit in v1

Arc should move the category forward by changing the center of gravity from
editing and prompting to **persistent execution plus review and steering**.

## The Product Shape

Arc has one runtime with two important surfaces:

### Swift macOS app

The Swift app is the flagship Arc product.
It should become the place where you actually spend time.

Its job is:

- global Arc home across projects
- project workspaces
- review queue
- blocked / needs-input queue
- changed files, diffs, tests, and summaries
- worker detail and operator decisions

Arc does not need to become a full code editor before it becomes valuable.
Reading code and steering work matter more first.

### VPS TUI

The TUI is the remote operator console.
It should be fast, attractive, and more functional than it is today, but it is
still the ops face of Arc, not the whole product.

Its job is:

- queue work
- inspect health
- unblock failed tasks
- watch active workers
- intervene quickly while away from the app

## The Layer Model

Arc only makes sense if the layers stay clean.

| Layer              | Role                                                         |
| ------------------ | ------------------------------------------------------------ |
| **Arc**            | product, workflow, workstation, project cockpit              |
| **OpenClaw**       | runtime, gateway, worktrees, worker lifecycle, durable state |
| **Claude + Codex** | worker engines that do the coding work                       |
| **Obsidian**       | planning, notes, specs, architecture, project memory         |

Obsidian should hold thinking.  
Arc should hold execution.

## The Human Loop

The human role in Arc is mostly to **review and steer**:

1. Decide what matters.
2. Queue or reshape work.
3. Let Claude and Codex execute in isolated worktrees.
4. Return to diffs, tests, summaries, and blocked items.
5. Approve, redirect, retry, or reprioritize.

That is the product loop.

## Current Reality

As of `2026-03-20`, Arc is already a real system, not just a concept.

What exists today:

- the canonical async runtime lives on a VPS at `/srv/arc/repo`
- OpenClaw is running as the durable control plane under Arc
- the self-drive loop can execute queued work asynchronously
- Claude is preferred first, with Codex fallback
- workers run in isolated git worktrees on local branches
- task, worker, run, and review state are persisted
- the Swift macOS shell exists, but is not yet the finished review workstation
- the TUI exists as the remote operator surface, but still needs product polish

So Arc is already alive. The main work now is making the product surface worthy
of the runtime.

## Near-Term Product Priorities

1. Review queue UI
2. Blocked / needs-input queue
3. Run summaries and review-ready artifacts
4. Diff / test / log review lane
5. Workspace persistence
6. Better-looking, more functional TUI ops console
7. Richer multi-project home

The first unmistakable flagship milestone is a **review workstation**, not a
full editor and not just a daemon dashboard.

## Repo Direction

This repository is being steered as Arc.

- `arc` is the primary remote for product work
- `upstream` remains the reference remote for the original OpenClaw codebase
- internal symbols may still say `OpenClaw` or `Cockpit*`
- that naming lag is an implementation detail, not the product identity

OpenClaw still exists here, but not as the headline product.
Arc is the thing being built.

## Read Next

- [VISION.md](VISION.md)
- [PRODUCT-SPLIT.md](PRODUCT-SPLIT.md)
- [Arc Context](docs/cockpit/README.md)
- [Arc Architecture](docs/cockpit/ARCHITECTURE.md)
- [Arc Self-Drive](docs/cockpit/SELF-DRIVE.md)
- [Arc V1 Product Spec](docs/plans/2026-03-20-arc-v1-product-spec.md)
