# Finish Fast Arc Design

Arc is the product/app name. OpenClaw remains the backend runtime and control
plane for workers, queues, and durable state.

## Goal

Get Arc to the point where it is already better than using Codex or
OpenCode in a terminal, as fast as possible.

The product test is simple:

- you choose Arc on purpose because orchestration, review, and visibility
  are better there
- then you use Arc to improve Arc

## Product Thesis

Arc wins before it becomes a full terminal replacement.

It does that by being a better **operator shell**:

- better worker control
- better blocked-state handling
- better logs and run visibility
- better review flow
- better continuity across restarts

Embedded terminals matter, but they are not the first reason to switch.

## Hard Scope Line

### What counts as finished-fast

Arc v1-fast includes:

- one native macOS app window
- one project workspace
- worker start/pause/resume/cancel controls
- visible worker status and latest run state
- visible log tail for the selected worker
- visible blocked / needs-operator-input state
- review-ready queue
- workspace persistence

### What is intentionally deferred

- full terminal replacement
- VPS-first architecture
- multi-user/general-product polish
- broad backend abstraction work
- fancy memory/retrieval systems
- hosted worker infrastructure
- plugin/platform work unrelated to the cockpit loop

## Why this is the right cut

This version becomes better than terminal use because it solves the real pain:

- knowing what workers are doing
- resuming after interruption
- seeing failures quickly
- reviewing outputs in one place
- not rebuilding your mental state every time

It does not need to beat Ghostty/iTerm on terminal fidelity on day one.

## Fast Roadmap

### Phase A: Operator shell

This is the minimum version worth switching into.

Build:

- worker controls
- selected worker detail
- log tail panel
- blocked queue
- review-ready queue
- workspace restore

Success condition:

- Arc is already better than terminal-only coding for workered tasks

### Phase B: Terminal convergence

Build:

- embedded PTY lanes
- worktree-bound terminal sessions
- 3 worker lanes + 1 review lane layout
- saved project layouts

Success condition:

- Arc can replace the current local 4-terminal workflow

### Phase C: Always-on brain

Build:

- move OpenClaw control plane to always-on mode when useful
- VPS/hybrid deployment if needed
- remote/background durability

Success condition:

- Arc stays your front-end while OpenClaw continues work when you are away

## The Dogfooding Loop

The intended loop is:

1. Use Arc to run Arc work
2. Notice friction immediately
3. Convert that friction into an Arc task
4. Run the next Arc improvement through Arc

That means the app does not have to be perfect before it starts compounding.
It just has to cross the threshold where it is the preferred place to supervise
work.

## Kill List

To finish fast, actively avoid:

- redesigning the whole backend for elegance
- adding infrastructure because it feels “serious”
- building a generalized agent platform before your own shell works
- chasing hosted-first async before the local cockpit is good
- spending time on beautiful but low-leverage terminal chrome

## Finish-Fast Priority Order

1. Native worker controls
2. Selected worker logs and run detail
3. Blocked/review queue
4. Workspace persistence
5. Embedded terminal lanes
6. VPS / always-on orchestration

## Success Criteria

You should switch into Arc as your default environment when:

- it can manage workers in-app
- it can show worker state and logs in-app
- it can route completed work into review
- it can survive app restarts without losing project context

At that point, terminal-only use becomes the fallback, not the default.
