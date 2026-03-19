<div align="center">

# Arc

### A personal coding cockpit for building anything with agentic AI.

`always-on` · `vps-first` · `claude-first` · `codex fallback` · `human taste stays in charge`

</div>

Arc is built around a simple belief:

software creation should not collapse every time you close a terminal.

The system you actually want is one that can hold direction, keep work moving,
route execution across the best available agents, and stay alive long enough to
compound momentum.

That is what Arc is for.

---

## The Vision

Arc is meant to feel less like “using an AI tool” and more like having a real
cockpit for software creation.

Not a chatbot.  
Not a one-off coding session.  
Not a glorified terminal wrapper.  
Not a black box that replaces your judgment.

Arc should let you:

- decide what matters
- express intent clearly
- hand work off to persistent agent workers
- keep multiple efforts moving over time
- come back to outcomes, state, and follow-up instead of lost context

The long-term promise is not just faster coding.

It is sustained software momentum.

---

## What Arc Should Feel Like

The ideal Arc loop is:

1. You define the direction.
2. Arc turns that direction into organized execution.
3. Claude and Codex carry the coding workload.
4. Arc keeps running while you handle higher-leverage work.
5. You return to a system that still remembers what happened.

That is the core product idea:

**a persistent operator system for building software, including itself.**

---

## What Arc Believes

| Principle                         | Meaning                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| The human keeps taste             | Arc should multiply judgment, not erase it.                             |
| Sessions are not enough           | Great agent runs are useful, but durable state is more valuable.        |
| The best engine should win        | Arc should orchestrate Claude and Codex, not try to replace them.       |
| Async matters                     | The system should keep building while your attention is somewhere else. |
| Notes and execution are different | Obsidian should hold thinking; Arc should hold live execution state.    |

---

## Arc, OpenClaw, Claude, Codex, Obsidian

Arc only makes sense if the layers stay clean.

| Layer              | Role                                                              |
| ------------------ | ----------------------------------------------------------------- |
| **Arc**            | product, operator workflow, cockpit, queue and control experience |
| **OpenClaw**       | modified runtime, gateway, worker lifecycle, durable state        |
| **Claude + Codex** | external worker engines that do the coding work                   |
| **Obsidian**       | planning, notes, specs, architecture, and project memory          |

The intended workflow is:

- think in Obsidian
- decide in Arc
- execute through Claude and Codex
- keep OpenClaw underneath as the durable control plane

Obsidian should be the brain.  
Arc should be the hands.

---

## Why This Exists

The failure mode of current agent workflows is obvious:

- a powerful session
- a burst of progress
- a lot of context in your head
- then the shell closes and the momentum dies

Arc exists to replace that with something stronger:

- persistent backlog
- durable runs
- isolated worktrees
- engine routing
- asynchronous execution
- visible blocked states
- recoverable momentum

Arc is not trying to out-model Claude or Codex.

It is trying to give them a better operating environment.

---

## Current Reality

As of `2026-03-19`, Arc is already a real system, not just a concept.

What is true today:

- the canonical async runtime lives on a VPS at `/srv/arc/repo`
- OpenClaw is running as the durable control plane under Arc
- the self-drive loop can execute queued work asynchronously
- Claude is preferred first, with Codex fallback
- workers run in isolated git worktrees on local branches
- task, worker, run, and review state are persisted
- the macOS shell is underway, but not yet the finished daily-driver cockpit

So Arc is already real. It is just earlier than the final product shape.

---

## The Repo Direction

This repository is being steered as Arc.

- `arc` is the primary remote for product work
- `upstream` remains the reference remote for the original OpenClaw codebase
- internal symbols may still say `OpenClaw` or `Cockpit*`
- that naming lag is an implementation detail, not the product identity

OpenClaw still exists here, but not as the headline product.

Arc is the thing being built.

---

## Read Next

- [PRODUCT-SPLIT.md](PRODUCT-SPLIT.md)
- [Arc Context](docs/cockpit/README.md)
- [Arc Self-Drive](docs/cockpit/SELF-DRIVE.md)
- [Arc Architecture](docs/cockpit/ARCHITECTURE.md)
