# Arc / OpenClaw Product Split

## Short Version

- `Arc` is the product and workstation.
- `OpenClaw` is the runtime and control plane underneath it.

That split should stay stable.

## Arc Owns

Arc owns the user-facing experience:

- project cockpit identity
- global Arc home across projects
- project workspace UX
- review queue and blocked queue UX
- worker detail and operator workflow
- TUI operator surface
- native macOS app
- product docs and product direction

Arc should be described as a **personal project cockpit**, not as a generic
assistant shell.

## OpenClaw Owns

OpenClaw owns the backend substrate:

- gateway process
- task / worker / run / review persistence
- worktree creation and branch naming
- worker lifecycle and execution plumbing
- remote execution and daemon ownership
- runtime internals, adapters, and control-plane behavior

OpenClaw should be described as the **runtime**, not the end-user product.

## Surface Split Inside Arc

Arc itself has two important surfaces:

### Swift macOS app

This is the flagship Arc product surface.

Its role is:

- daily-driver review-and-steer workstation
- project home and project workspace
- diffs, changed files, tests, summaries, blocked items, and worker detail

### VPS TUI

This is the remote operator console.

Its role is:

- fast remote health and queue inspection
- task creation and retry/unblock actions
- VPS-first background-ops interaction

The TUI is important, but it is not the whole product direction.

## Repo Direction

This repository is being steered as `Arc`.

Git remotes:

- `arc`: primary push target for Arc work
- `upstream`: reference remote for the original OpenClaw codebase

Operational intent:

- new product work lands against `arc`
- upstream OpenClaw changes are pulled intentionally, not by habit
- we do not optimize for staying a clean fork if that slows Arc down

## Naming Rule

When there is ambiguity:

- prefer `Arc` for product, app, workstation, TUI, and UX language
- prefer `OpenClaw` for runtime, gateway, worktrees, and worker substrate language

Internal symbols and file names may continue to use `Cockpit*` or `OpenClaw`
temporarily while the product direction settles. That is an implementation
detail, not the product identity.
