<div align="center">

# Arc

### Run Claude and Codex coding agents on a server, then review their work when you're ready.

[![CI](https://github.com/connortessaro/arc/actions/workflows/ci.yml/badge.svg)](https://github.com/connortessaro/arc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 22.16+](https://img.shields.io/badge/node-%3E%3D22.16-brightgreen)](https://nodejs.org/)

</div>

---

AI coding tools stop when you close the chat. Arc keeps going. You queue tasks, agents work on them on a remote server, and you come back to diffs, test results, and a list of anything that got stuck.

## Features

- **Agents keep running** after you log off. Claude does the work, and Codex takes over if Claude fails.
- **One branch per task.** Each task gets its own git branch and folder, so agents don't step on each other.
- **One review screen** for diffs, tests, summaries, and tasks waiting on you.
- **Many projects** from one place.
- **Runs on your server**, so you can check in from any machine.

## Quick start

You need Node 22.16 or newer and pnpm.

```sh
git clone https://github.com/connortessaro/arc.git
cd arc
pnpm install
pnpm build
pnpm start onboard
```

The [setup guide](docs/cockpit/README.md) covers server setup and agent settings.

## How it fits together

You get two ways in:

| App | What you do there |
| --- | --- |
| **Mac app** (Swift) | Review diffs, work through the queue, approve or reject |
| **Terminal app** on the server | Queue tasks, check progress, unblock stuck agents |

Behind them:

| Part | Job |
| --- | --- |
| **Arc** | The apps and the review workflow |
| **Runtime** | Runs agents, manages branches, saves task state |
| **Claude and Codex** | Write the code |
| **Obsidian** | Holds plans, notes, and specs |

## Your part

1. Decide what matters.
2. Queue or reshape tasks.
3. Let the agents work, each on its own branch.
4. Come back to diffs, tests, summaries, and stuck tasks.
5. Approve, redirect, retry, or reorder.

## What works today

- Agents run on a server and work through the queue on their own
- Claude runs first, with Codex as backup
- Each agent works on its own git branch
- Tasks, agents, runs, and reviews survive restarts
- Mac app: review screen in progress
- Terminal app: works, polish in progress

## Next up

1. Review queue screen
2. Queue for tasks that need your input
3. Run summaries
4. Side-by-side diff, test, and log review
5. Saved workspaces
6. A better terminal app
7. A richer home screen for many projects

## Docs

- [Vision](VISION.md)
- [Product and runtime split](PRODUCT-SPLIT.md)
- [Setup guide](docs/cockpit/README.md)
- [Architecture](docs/cockpit/ARCHITECTURE.md)
- [Self-drive loop](docs/cockpit/SELF-DRIVE.md)
- [V1 product spec](docs/plans/2026-03-20-arc-v1-product-spec.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Open a pull request for bugs and small fixes. For new features, open an [issue](https://github.com/connortessaro/arc/issues) first.

## License

[MIT](LICENSE). Built on [OpenClaw](https://github.com/openclaw/openclaw).
