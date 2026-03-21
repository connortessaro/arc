import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd());
const statusScript = path.join(repoRoot, "scripts", "arc-self-drive", "status.sh");

async function writeExecutable(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function writeCockpitStore(
  homeDir: string,
  params: {
    tasks?: Array<Record<string, unknown>>;
    workers?: Array<Record<string, unknown>>;
    runs?: Array<Record<string, unknown>>;
  },
) {
  const storePath = path.join(homeDir, ".openclaw", "code", "cockpit.json");
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(
    storePath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: "2026-03-20T23:00:00.000Z",
        tasks: params.tasks ?? [],
        workers: params.workers ?? [],
        reviews: [],
        decisions: [],
        contextSnapshots: [],
        runs: params.runs ?? [],
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function touchOld(filePath: string) {
  const stamp = new Date("2026-03-10T00:00:00.000Z");
  await fs.utimes(filePath, stamp, stamp);
}

describe("arc self-drive status", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("prints system metrics, retry backoff state, blocked failure classes, and cleanup candidates", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-status-"));
    tempDirs.push(tempHome);

    const binDir = path.join(tempHome, "bin");
    await writeExecutable(
      path.join(binDir, "systemctl"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--user" && "\${2:-}" == "is-active" ]]; then
  printf '%s\n' 'active'
  exit 0
fi
if [[ "\${1:-}" == "--user" && "\${2:-}" == "show" ]]; then
  printf '%s\n' '1234'
  exit 0
fi
exit 0
`,
    );
    await writeExecutable(
      path.join(binDir, "curl"),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s' '{"ok":true,"status":"live"}'
`,
    );
    await writeExecutable(
      path.join(binDir, "claude"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "auth" && "\${2:-}" == "status" ]]; then
  printf '%s\n' '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty"}'
  exit 0
fi
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\n' 'claude 1.0.0'
  exit 0
fi
exit 1
`,
    );
    await writeExecutable(
      path.join(binDir, "codex"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "login" && "\${2:-}" == "status" ]]; then
  printf '%s\n' 'Logged in using ChatGPT'
  exit 0
fi
exit 1
`,
    );
    await writeExecutable(
      path.join(binDir, "gh"),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "auth" && "\${2:-}" == "status" ]]; then
  exit 0
fi
exit 1
`,
    );

    const oldWorktree = path.join(tempHome, "repo", ".worktrees", "code", "cleanup-me");
    await fs.mkdir(oldWorktree, { recursive: true });
    await touchOld(oldWorktree);
    const oldStdoutLog = path.join(tempHome, ".openclaw", "logs", "worker.stdout.log");
    await fs.mkdir(path.dirname(oldStdoutLog), { recursive: true });
    await fs.writeFile(oldStdoutLog, "old log\n", "utf8");
    await touchOld(oldStdoutLog);

    await writeCockpitStore(tempHome, {
      tasks: [
        {
          id: "task_retry",
          title: "Wait for the retry backoff",
          status: "queued",
          priority: "normal",
          lastFailureClass: "transient-runtime",
          autoRetryCount: 1,
          retryAfter: "2099-03-21T00:15:00.000Z",
          lastOperatorHint: "Auto-retry scheduled after a transient runtime failure.",
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
          workerIds: [],
          reviewIds: [],
        },
        {
          id: "task_done",
          title: "Archive cleanup artifacts",
          status: "done",
          priority: "normal",
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
          workerIds: ["worker_cleanup"],
          reviewIds: [],
        },
        {
          id: "task_blocked",
          title: "Investigate the blocked run",
          status: "blocked",
          priority: "high",
          lastFailureClass: "transient-runtime",
          lastOperatorHint: "Automatic recovery already ran once for this task.",
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
          workerIds: ["worker_done"],
          reviewIds: [],
        },
      ],
      workers: [
        {
          id: "worker_cleanup",
          taskId: "task_done",
          name: "cleanup-worker",
          status: "completed",
          lane: "worker",
          worktreePath: oldWorktree,
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
        },
        {
          id: "worker_done",
          taskId: "task_blocked",
          name: "blocked-worker",
          status: "completed",
          lane: "worker",
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
        },
      ],
      runs: [
        {
          id: "run_failed",
          taskId: "task_blocked",
          workerId: "worker_done",
          status: "failed",
          terminationReason: "no-output-timeout",
          stdoutLogPath: oldStdoutLog,
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
        },
      ],
    });

    const result = spawnSync("bash", [statusScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: tempHome,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        ARC_SELF_DRIVE_SYSTEM_METRICS_JSON: JSON.stringify({
          memoryAvailableMiB: 2560,
          swapUsedMiB: 320,
          diskFreeGiB: 97.2,
          gatewayRssMiB: 668,
          topProcesses: [{ pid: 1234, rssMiB: 668, command: "openclaw-gateway" }],
        }),
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("memory_available=2560MiB");
    expect(result.stdout).toContain("swap_used=320MiB");
    expect(result.stdout).toContain("gateway_rss=668MiB");
    expect(result.stdout).toContain("retry_backoff=1");
    expect(result.stdout).toContain("blocked_by_class: transient-runtime=1");
    expect(result.stdout).toContain("cleanup_candidates: worktrees=1 logs=1 locks=0");
  });
});
