# Arc / OpenClaw Product Split

## Short Version

- `Arc` is the product and app.
- `OpenClaw` is the runtime and control plane under it.

Arc owns the user-facing experience:

- native macOS shell
- operator workflow
- review UX
- terminal lanes
- product identity and docs

OpenClaw owns the backend substrate:

- gateway process
- worker lifecycle
- durable task/run/review state
- remote execution plumbing
- agent/runtime internals

## Repo Direction

This repository is now being steered as `Arc`.

Git remotes:

- `arc`: primary push target for Arc work
- `upstream`: reference remote for the original OpenClaw codebase

Operational intent:

- new product work lands against `arc`
- upstream OpenClaw changes are pulled intentionally, not by habit
- we do not optimize for staying a clean fork if that slows Arc down

## Naming Rule

When there is ambiguity:

- prefer `Arc` for product, app, and UX language
- prefer `OpenClaw` for runtime, gateway, and worker substrate language

Internal symbols and file names may continue to use `Cockpit*` or `OpenClaw`
temporarily while the product direction settles. That is an implementation
detail, not the product identity.
