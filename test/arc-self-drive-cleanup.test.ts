import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd());
const cleanupScript = path.join(repoRoot, "scripts", "arc-self-drive", "cleanup.sh");

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

async function touchOld(targetPath: string) {
  const stamp = new Date("2026-03-10T00:00:00.000Z");
  await fs.utimes(targetPath, stamp, stamp);
}

describe("arc self-drive cleanup", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("reports safe cleanup candidates in dry-run mode without deleting them", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cleanup-dry-run-"));
    tempDirs.push(tempHome);

    const oldWorktree = path.join(tempHome, "repo", ".worktrees", "code", "cleanup-me");
    await fs.mkdir(oldWorktree, { recursive: true });
    await touchOld(oldWorktree);
    const reviewWorktree = path.join(tempHome, "repo", ".worktrees", "code", "keep-review");
    await fs.mkdir(reviewWorktree, { recursive: true });
    await touchOld(reviewWorktree);
    const oldStdoutLog = path.join(tempHome, ".openclaw", "logs", "worker.stdout.log");
    await fs.mkdir(path.dirname(oldStdoutLog), { recursive: true });
    await fs.writeFile(oldStdoutLog, "old log\n", "utf8");
    await touchOld(oldStdoutLog);

    await writeCockpitStore(tempHome, {
      tasks: [
        {
          id: "task_done",
          title: "Completed cleanup task",
          status: "done",
          priority: "normal",
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
          workerIds: ["worker_done"],
          reviewIds: [],
        },
        {
          id: "task_review",
          title: "Keep review worktree",
          status: "review",
          priority: "normal",
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
          workerIds: ["worker_review"],
          reviewIds: ["review_1"],
        },
      ],
      workers: [
        {
          id: "worker_done",
          taskId: "task_done",
          name: "cleanup-worker",
          status: "completed",
          lane: "worker",
          worktreePath: oldWorktree,
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
        },
        {
          id: "worker_review",
          taskId: "task_review",
          name: "review-worker",
          status: "completed",
          lane: "worker",
          worktreePath: reviewWorktree,
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
        },
      ],
      runs: [
        {
          id: "run_old_log",
          taskId: "task_done",
          workerId: "worker_done",
          status: "failed",
          stdoutLogPath: oldStdoutLog,
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
        },
      ],
    });

    const result = spawnSync("bash", [cleanupScript, "--json"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: tempHome,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.mode).toBe("dry-run");
    expect(summary.counts).toMatchObject({ worktrees: 1, logs: 1, locks: 0 });
    await expect(fs.access(oldWorktree)).resolves.toBeUndefined();
    await expect(fs.access(reviewWorktree)).resolves.toBeUndefined();
    await expect(fs.access(oldStdoutLog)).resolves.toBeUndefined();
  });

  it("deletes safe cleanup candidates in apply mode while preserving review-related worktrees", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cleanup-apply-"));
    tempDirs.push(tempHome);

    const oldWorktree = path.join(tempHome, "repo", ".worktrees", "code", "cleanup-me");
    await fs.mkdir(oldWorktree, { recursive: true });
    await touchOld(oldWorktree);
    const reviewWorktree = path.join(tempHome, "repo", ".worktrees", "code", "keep-review");
    await fs.mkdir(reviewWorktree, { recursive: true });
    await touchOld(reviewWorktree);
    const oldStdoutLog = path.join(tempHome, ".openclaw", "logs", "worker.stdout.log");
    await fs.mkdir(path.dirname(oldStdoutLog), { recursive: true });
    await fs.writeFile(oldStdoutLog, "old log\n", "utf8");
    await touchOld(oldStdoutLog);

    await writeCockpitStore(tempHome, {
      tasks: [
        {
          id: "task_done",
          title: "Completed cleanup task",
          status: "done",
          priority: "normal",
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
          workerIds: ["worker_done"],
          reviewIds: [],
        },
        {
          id: "task_review",
          title: "Keep review worktree",
          status: "review",
          priority: "normal",
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
          workerIds: ["worker_review"],
          reviewIds: ["review_1"],
        },
      ],
      workers: [
        {
          id: "worker_done",
          taskId: "task_done",
          name: "cleanup-worker",
          status: "completed",
          lane: "worker",
          worktreePath: oldWorktree,
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
        },
        {
          id: "worker_review",
          taskId: "task_review",
          name: "review-worker",
          status: "completed",
          lane: "worker",
          worktreePath: reviewWorktree,
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
        },
      ],
      runs: [
        {
          id: "run_old_log",
          taskId: "task_done",
          workerId: "worker_done",
          status: "failed",
          stdoutLogPath: oldStdoutLog,
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
        },
      ],
    });

    const result = spawnSync("bash", [cleanupScript, "--apply", "--json"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: tempHome,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.mode).toBe("apply");
    expect(summary.deleted).toMatchObject({ worktrees: 1, logs: 1, locks: 0 });
    await expect(fs.access(oldWorktree)).rejects.toThrow();
    await expect(fs.access(oldStdoutLog)).rejects.toThrow();
    await expect(fs.access(reviewWorktree)).resolves.toBeUndefined();
  });
});
