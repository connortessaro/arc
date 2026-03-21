<div align="center">

# Arc

### A personal project cockpit for building software with persistent agent workers.

[![CI](https://github.com/connortessaro/arc/actions/workflows/ci.yml/badge.svg)](https://github.com/connortessaro/arc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)

`review-and-steer` · `always-on` · `vps-first runtime` · `swift flagship app` · `claude-first` · `codex fallback`

</div>

---

Arc is built around a simple belief: the next step after today's IDEs and AI coding tools is not more autocomplete, more chat panes, or a better one-off session.

The next step is a system that can **keep software moving**. Arc is meant to be that system.

## ✨ Features

- **Persistent workers** — Claude and Codex agents keep running after a session ends
- **Isolated worktrees** — Every task runs on its own git branch in its own directory
- **Review & steer** — Diffs, tests, summaries, and blocked queues in one place
- **Async execution** — Queue work and come back to results, not in-progress prompts
- **Multi-project home** — Operate many projects from a single cockpit
- **VPS-first runtime** — Runs on a remote server; stay in control from anywhere

## 🚀 Quick Start

```sh
npm install -g openclaw
openclaw onboard
```

> See the [full docs](docs/cockpit/README.md) for gateway setup, VPS configuration, and worker configuration.

## 🏗️ Architecture

Arc has one runtime with two surfaces:

| Surface | Role |
| --- | --- |
| **Swift macOS app** | Flagship review workstation — diffs, queues, decisions |
| **VPS TUI** | Fast remote operator console — queue, inspect, unblock |

### The Layer Model

Arc only makes sense if the layers stay clean:

| Layer | Role |
| --- | --- |
| **Arc** | product, workflow, workstation, project cockpit |
| **OpenClaw** | runtime, gateway, worktrees, worker lifecycle, durable state |
| **Claude + Codex** | worker engines that do the coding work |
| **Obsidian** | planning, notes, specs, architecture, project memory |

Obsidian should hold thinking. Arc should hold execution.

## 🔄 The Human Loop

The human role in Arc is mostly to **review and steer**:

1. Decide what matters
2. Queue or reshape work
3. Let Claude and Codex execute in isolated worktrees
4. Return to diffs, tests, summaries, and blocked items
5. Approve, redirect, retry, or reprioritize

Arc should feel like a **workstation for software momentum**, not a prompt box with file access.

## 📖 Documentation

- [Vision](VISION.md)
- [Product / Runtime Split](PRODUCT-SPLIT.md)
- [Arc Context](docs/cockpit/README.md)
- [Arc Architecture](docs/cockpit/ARCHITECTURE.md)
- [Arc Self-Drive](docs/cockpit/SELF-DRIVE.md)
- [Arc V1 Product Spec](docs/plans/2026-03-20-arc-v1-product-spec.md)

## 🗺️ Roadmap

Near-term product priorities:

1. Review queue UI
2. Blocked / needs-input queue
3. Run summaries and review-ready artifacts
4. Diff / test / log review lane
5. Workspace persistence
6. Better-looking, more functional TUI ops console
7. Richer multi-project home

The first unmistakable flagship milestone is a **review workstation** — not a full editor, not just a daemon dashboard.

## 📍 Current Status

Arc is already a real system, not just a concept. What exists today:

- Canonical async runtime running on a VPS
- OpenClaw as the durable control plane
- Self-drive loop executing queued work asynchronously
- Claude-first with Codex fallback
- Workers running in isolated git worktrees on local branches
- Persisted task, worker, run, and review state
- Swift macOS shell (review workstation in progress)
- TUI remote operator surface (polish in progress)

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

- **Bugs & small fixes** → Open a PR
- **New features / architecture** → Open a [GitHub Discussion](https://github.com/connortessaro/arc/discussions) or ask in Discord first
- **Questions** → Check [CONTRIBUTING.md](CONTRIBUTING.md) for support links

## 📄 License

[MIT](LICENSE) — built on [OpenClaw](https://github.com/openclaw/openclaw).
