# Arc Vision

Arc is the product being built in this repository.
OpenClaw remains the runtime and control plane underneath it.

This document is the high-level product direction for Arc.
It should stay stable enough to steer decisions, but practical enough to match
the system that exists today.

Project overview: [`README.md`](README.md)  
Product/runtime split: [`PRODUCT-SPLIT.md`](PRODUCT-SPLIT.md)  
Current cockpit direction: [`docs/cockpit/README.md`](docs/cockpit/README.md)

## The Core Bet

The next step forward should not be “yet another code editor with AI.”

The better direction is a **project cockpit**:

- a system that keeps work moving after a terminal closes
- a system that can hold multiple projects over time
- a system that lets humans review, steer, and decide instead of micromanaging prompts
- a system that uses the best available engines without pretending to replace them

Arc should feel like a real workstation for software creation, not a chat box
with file access.

## What Arc Is

Arc is a **personal project cockpit** for building software with persistent
agent workers.

It should let one human:

- direct multiple projects from one home surface
- hand work to background Claude and Codex workers
- return to diffs, tests, summaries, and blocked decisions
- keep momentum across open source work, client work, and personal projects

Arc is personal-first in v1, but it must fit real collaborative software work:
Git, GitHub, reviews, branches, worktrees, and open source contribution
patterns.

## What Arc Is Not

Arc is not:

- a replacement foundation model
- a glorified prompt runner
- a thin terminal wrapper as the end state
- a full multi-user collaborative workspace in v1
- a normal IDE with an AI sidebar bolted on

If Arc ever feels like “just another editor plus AI,” it has failed to move the
category forward.

## The Product Shape

Arc should have two product surfaces over one runtime:

### Swift macOS app

The Swift app is the flagship Arc product.
It should become the place where you actually spend time.

Its job is:

- project home
- project workspace
- review queue
- blocked / needs-input queue
- changed files and diffs
- tests, summaries, and worker detail

It does not need to become a full editor before it becomes useful.
Reading code, reviewing work, and steering agents matter more first.

### VPS TUI

The TUI is the fast remote operator console.
It should feel functional, intentional, and pleasant, but it is still the ops
face of Arc, not the whole product.

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
| **Arc**            | product, operator workflow, workstation, project cockpit     |
| **OpenClaw**       | runtime, gateway, worktrees, worker lifecycle, durable state |
| **Claude + Codex** | worker engines that do the coding work                       |
| **Obsidian**       | planning, notes, specs, architecture, project memory         |

Obsidian should hold thinking.  
Arc should hold execution.

## The Human Role

The human should mostly **review and steer**.

That means Arc should optimize for:

- seeing what changed
- seeing what failed
- seeing what needs a decision
- reprioritizing work
- nudging the system back on course

Prompting still matters, but prompting is not the center of the product.

## The First Flagship Milestone

The first unmistakable Arc milestone is a **review workstation**.

That means the app becomes good enough to:

- inspect diffs and changed files
- inspect test and log output
- understand worker summaries
- resolve blocked items
- keep project context between launches

This matters more than:

- turning the app into a full editor
- building broad team collaboration
- making the TUI the whole product

## Guardrails

To preserve the shape of Arc:

- keep Arc personal-first in v1
- keep collaboration Git-native, not live-shared-state-first
- keep OpenClaw as the runtime owner
- keep Claude and Codex as the coding engines
- keep worktree isolation and no auto-push / no auto-merge safety rails
- keep the TUI useful, but do not let it become the entire product direction

## Near-Term Product Priorities

1. Review queue UI
2. Blocked / needs-input queue
3. Run summaries and review-ready artifacts
4. Diff / test / log review lane
5. Workspace persistence
6. Better-looking, more functional TUI ops console
7. Richer global project home

That sequence should hold unless a concrete runtime blocker forces a temporary
detour.
