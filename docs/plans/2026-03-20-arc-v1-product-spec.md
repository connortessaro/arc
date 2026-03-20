# Arc V1 Product Spec

## Summary

Arc is a personal project cockpit for software creation.

It should feel like the next step beyond an IDE plus a prompt box: a system
where persistent Claude and Codex workers keep software moving while the human
stays focused on review, direction, and taste.

Arc is personal-first in v1. It should work well with collaborative repos,
GitHub, and open source, but it is not a multi-user shared cockpit yet.

## What Arc Is

- A review-and-steer workstation over persistent agent execution.
- A project-centric cockpit, not an agent-centric shell.
- A system that can keep working on projects, including Arc itself, while the
  user is away.

## What Arc Is Not

- Not primarily a prompt box.
- Not primarily a terminal multiplexer.
- Not a full editor-first IDE in v1.
- Not a multi-user collaboration product in v1.
- Not a replacement for Claude or Codex.

## Who Arc Is For

Arc is for a developer who wants one place to:

- build personal projects
- work inside real team and open-source repos
- review AI-generated changes with taste and context
- keep background workers moving while attention is elsewhere

## Product Shape

### Arc Home

The top-level Arc surface should answer:

- What projects exist?
- What is active right now?
- What needs my attention?
- What is blocked?

### Project Workspace

The project workspace is the real center of gravity.

It should prioritize:

- review queue
- blocked / needs-input queue
- changed files and diffs
- test and log output
- recent worker runs and summaries
- quick task steering

### Worker Detail

Each worker detail surface should show:

- what the worker was trying to do
- what changed
- what checks ran
- what branch / worktree it used
- what happened next

### VPS TUI

The TUI is the remote operator console.

It should be the quickest way to:

- see health
- inspect active work
- queue tasks
- unblock failed work
- intervene while AFK from the Mac app

It is important, but it is not the whole product.

### Swift macOS App

The Swift app is the flagship Arc surface.

It should become the place where the user actually wants to spend time:

- understanding project state
- reviewing code changes
- seeing tests and logs
- steering what happens next

## Layer Model

- `Arc` = product, workstation, user experience
- `OpenClaw` = runtime, gateway, durable state, worker lifecycle
- `Claude` + `Codex` = worker engines
- `Obsidian` = thinking, notes, specs, and product memory

Obsidian is the planning layer, not the live runtime store.

## Primary User Loop

1. Define work or queue a goal.
2. Let Arc route work to Claude first, then Codex as needed.
3. Arc runs work in isolated git worktrees on the VPS.
4. Return to Arc to review changed files, tests, logs, and blocked items.
5. Approve, redirect, retry, or queue the next task.

The user should spend more time steering and reviewing than manually prompting.

## V1 Boundary

### Included

- persistent background workers
- project backlog and task steering
- isolated git worktrees
- review-ready outputs
- blocked / needs-input handling
- Git and GitHub friendly workflows
- Swift app plus VPS TUI over the same runtime

### Not Included

- shared multi-user cockpit state
- auto-push or auto-merge
- full editor parity with existing IDEs
- hosted-first platform ambitions

## First Flagship Milestone

The first unmistakable Arc milestone is a review workstation.

That means the Swift app must become good enough to:

- show what changed
- show what failed
- show what needs attention
- keep project context across relaunches
- let the user decide what happens next without dropping back to terminals for
  every action

The TUI should support the same system as a fast remote console, but the app is
the flagship.

## Success Criteria For V1

Arc v1 is successful when:

- it can keep work moving on the VPS without constant prompting
- the user can return to meaningful project state instead of raw logs
- the Swift app feels like a real review-and-steer workstation
- the TUI feels like a competent remote operator console
- Arc helps the user build personal and open-source software faster than their
  current IDE plus ad hoc agent workflow
