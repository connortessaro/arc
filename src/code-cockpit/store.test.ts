import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempStateDir: string;

async function importStoreModule() {
  vi.resetModules();
  return await import("./store.js");
}

beforeEach(async () => {
  tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-code-cockpit-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", tempStateDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tempStateDir, { recursive: true, force: true });
});

describe("code cockpit store", () => {
  it("persists tasks, workers, reviews, decisions, and context snapshots", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({
      title: "Build coding cockpit",
      repoRoot: "/tmp/openclaw",
      goal: "Ship the first vertical slice",
      priority: "high",
    });

    const worker = await storeModule.createCodeWorkerSession({
      taskId: task.id,
      name: "planner",
      status: "running",
      repoRoot: "/tmp/openclaw",
      worktreePath: "/tmp/openclaw/.worktrees/planner",
      branch: "feature/planner",
      objective: "Map the first milestone",
    });

    const review = await storeModule.createCodeReviewRequest({
      taskId: task.id,
      workerId: worker.id,
      title: "Review planner branch",
      summary: "Ready for an initial diff review",
    });

    const decision = await storeModule.appendCodeDecisionLog({
      taskId: task.id,
      workerId: worker.id,
      kind: "routing",
      summary: "Keep Codex as the only worker runtime in v1",
    });

    const snapshot = await storeModule.appendCodeContextSnapshot({
      taskId: task.id,
      workerId: worker.id,
      kind: "repo",
      title: "CLI architecture",
      body: "The CLI uses lazy-loaded subcommand registrars.",
    });

    const store = await storeModule.loadCodeCockpitStore();
    const persistedTask = store.tasks.find((entry) => entry.id === task.id);

    expect(persistedTask).toMatchObject({
      title: "Build coding cockpit",
      repoRoot: "/tmp/openclaw",
      goal: "Ship the first vertical slice",
      priority: "high",
      workerIds: [worker.id],
      reviewIds: [review.id],
    });
    expect(store.workers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: worker.id,
          taskId: task.id,
          worktreePath: "/tmp/openclaw/.worktrees/planner",
          status: "running",
        }),
      ]),
    );
    expect(store.reviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: review.id,
          taskId: task.id,
          workerId: worker.id,
          status: "pending",
        }),
      ]),
    );
    expect(store.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: decision.id,
          taskId: task.id,
          workerId: worker.id,
          kind: "routing",
        }),
      ]),
    );
    expect(store.contextSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: snapshot.id,
          taskId: task.id,
          workerId: worker.id,
          kind: "repo",
          title: "CLI architecture",
        }),
      ]),
    );
  });

  it("persists worker engine metadata and runtime health fields", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({
      title: "Run a Claude worker",
      repoRoot: "/tmp/openclaw",
    });

    const worker = await storeModule.createCodeWorkerSession({
      taskId: task.id,
      name: "reviewer",
      engineId: "claude",
      engineModel: "claude-sonnet-4-6",
      commandPath: "/usr/local/bin/claude",
      authHealth: "healthy",
      repoRoot: "/tmp/openclaw",
    });

    await storeModule.updateCodeWorkerSession(worker.id, {
      lastAuthCheckedAt: "2026-03-19T12:00:00.000Z",
      lastCommitHash: "abc1234",
      pushedBranch: "code/task_123/reviewer",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/connortessaro/arc/pull/42",
      pullRequestState: "draft",
    });

    const store = await storeModule.loadCodeCockpitStore();

    expect(store.workers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: worker.id,
          taskId: task.id,
          engineId: "claude",
          engineModel: "claude-sonnet-4-6",
          commandPath: "/usr/local/bin/claude",
          authHealth: "healthy",
          lastAuthCheckedAt: "2026-03-19T12:00:00.000Z",
          lastCommitHash: "abc1234",
          pushedBranch: "code/task_123/reviewer",
          pullRequestNumber: 42,
          pullRequestUrl: "https://github.com/connortessaro/arc/pull/42",
          pullRequestState: "draft",
        }),
      ]),
    );
  });

  it("enforces worker lifecycle transitions", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({ title: "Run worker lifecycle checks" });
    const worker = await storeModule.createCodeWorkerSession({
      taskId: task.id,
      name: "executor",
    });

    await storeModule.updateCodeWorkerSessionStatus(worker.id, "running");
    await storeModule.updateCodeWorkerSessionStatus(worker.id, "awaiting_review");

    await expect(storeModule.updateCodeWorkerSessionStatus(worker.id, "queued")).rejects.toThrow(
      'Invalid worker transition from "awaiting_review" to "queued"',
    );
  });

  it("builds a summary with status counts and pending review focus", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({
      title: "Prepare review lane",
      status: "review",
    });
    const worker = await storeModule.createCodeWorkerSession({
      taskId: task.id,
      name: "reviewer",
      status: "awaiting_review",
      lane: "review",
    });
    await storeModule.createCodeReviewRequest({
      taskId: task.id,
      workerId: worker.id,
      title: "Validate review lane",
    });

    const summary = await storeModule.getCodeCockpitSummary();

    expect(summary.totals).toMatchObject({
      tasks: 1,
      workers: 1,
      reviews: 1,
    });
    expect(summary.taskStatusCounts.review).toBe(1);
    expect(summary.workerStatusCounts.awaiting_review).toBe(1);
    expect(summary.reviewStatusCounts.pending).toBe(1);
    expect(summary.pendingReviews[0]).toMatchObject({
      taskId: task.id,
      workerId: worker.id,
      title: "Validate review lane",
    });
  });

  it("resolves review statuses into task and worker progression", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({
      title: "Review progression",
      status: "review",
    });
    const worker = await storeModule.createCodeWorkerSession({
      taskId: task.id,
      name: "review-worker",
      status: "awaiting_review",
    });
    const review = await storeModule.createCodeReviewRequest({
      taskId: task.id,
      workerId: worker.id,
      title: "Approve the work",
    });

    const approved = await storeModule.resolveCodeReviewRequestStatus(review.id, "approved");

    expect(approved.review).toMatchObject({ status: "approved" });
    expect(approved.task).toMatchObject({ status: "done" });
    expect(approved.worker).toMatchObject({ status: "completed" });

    const reworkTask = await storeModule.createCodeTask({
      title: "Need another pass",
      status: "review",
    });
    const reworkWorker = await storeModule.createCodeWorkerSession({
      taskId: reworkTask.id,
      name: "rework-worker",
      status: "awaiting_review",
    });
    const reworkReview = await storeModule.createCodeReviewRequest({
      taskId: reworkTask.id,
      workerId: reworkWorker.id,
      title: "Request changes",
    });

    const changesRequested = await storeModule.resolveCodeReviewRequestStatus(
      reworkReview.id,
      "changes_requested",
    );

    expect(changesRequested.review).toMatchObject({ status: "changes_requested" });
    expect(changesRequested.task).toMatchObject({ status: "in_progress" });
    expect(changesRequested.worker).toMatchObject({ status: "failed" });

    const cancelledTask = await storeModule.createCodeTask({
      title: "Drop this review",
      status: "review",
    });
    const cancelledWorker = await storeModule.createCodeWorkerSession({
      taskId: cancelledTask.id,
      name: "dismiss-worker",
      status: "awaiting_review",
    });
    const dismissedReview = await storeModule.createCodeReviewRequest({
      taskId: cancelledTask.id,
      workerId: cancelledWorker.id,
      title: "Dismiss this work",
    });

    const dismissed = await storeModule.resolveCodeReviewRequestStatus(
      dismissedReview.id,
      "dismissed",
    );

    expect(dismissed.review).toMatchObject({ status: "dismissed" });
    expect(dismissed.task).toMatchObject({ status: "cancelled" });
    expect(dismissed.worker).toMatchObject({ status: "awaiting_review" });
  });

  it("builds a workspace summary with active lanes and recent runs", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({
      title: "Ship the cockpit shell",
      repoRoot: "/tmp/openclaw",
      status: "in_progress",
    });
    const worker = await storeModule.createCodeWorkerSession({
      taskId: task.id,
      name: "shell-lane",
      status: "running",
      lane: "worker",
      repoRoot: "/tmp/openclaw",
      worktreePath: "/tmp/openclaw/.worktrees/code/shell-lane",
      branch: "code/task/shell-lane",
    });
    const run = await storeModule.createCodeRun({
      taskId: task.id,
      workerId: worker.id,
      status: "running",
      summary: "Rendering the cockpit shell",
      backendId: "codex-cli",
      startedAt: "2026-03-19T12:00:00.000Z",
    });
    await storeModule.updateCodeWorkerSession(worker.id, {
      activeRunId: run.id,
      backendId: "codex-cli",
      lastStartedAt: "2026-03-19T12:00:00.000Z",
    });
    const review = await storeModule.createCodeReviewRequest({
      taskId: task.id,
      workerId: worker.id,
      title: "Review cockpit shell",
    });

    const summary = await storeModule.getCodeCockpitWorkspaceSummary();

    expect(summary.generatedAt).toMatch(/T/);
    expect(summary.recentRuns[0]).toMatchObject({
      id: run.id,
      workerId: worker.id,
      status: "running",
    });
    expect(summary.activeLanes[0]).toMatchObject({
      workerId: worker.id,
      workerName: "shell-lane",
      taskId: task.id,
      taskTitle: "Ship the cockpit shell",
      backendId: "codex-cli",
    });
    expect(summary.activeLanes[0].latestRun).toMatchObject({
      id: run.id,
      status: "running",
    });
    expect(summary.activeLanes[0].pendingReview).toMatchObject({
      id: review.id,
      title: "Review cockpit shell",
    });
  });

  it("tracks blocked failure classes and retry backoff counts in the workspace summary", async () => {
    const storeModule = await importStoreModule();
    const blockedTask = await storeModule.createCodeTask({
      title: "Repair Claude auth",
      repoRoot: "/tmp/openclaw",
      status: "blocked",
    });
    await storeModule.updateCodeTask(blockedTask.id, {
      lastFailureClass: "engine-auth",
      lastOperatorHint: "Claude auth is missing on the VPS.",
    });

    const retryingTask = await storeModule.createCodeTask({
      title: "Retry the transient worker failure",
      repoRoot: "/tmp/openclaw",
      status: "queued",
    });
    await storeModule.updateCodeTask(retryingTask.id, {
      lastFailureClass: "transient-runtime",
      autoRetryCount: 1,
      retryAfter: "2026-03-20T00:15:00.000Z",
      lastOperatorHint: "Auto-retry scheduled after a transient runtime failure.",
    });

    const summary = await storeModule.getCodeCockpitWorkspaceSummary({
      now: () => new Date("2026-03-20T00:05:00.000Z"),
    });

    expect(summary.blockedTaskFailureCounts["engine-auth"]).toBe(1);
    expect(summary.blockedTaskFailureCounts["transient-runtime"]).toBe(0);
    expect(summary.retryBackoffCount).toBe(1);
  });

  it("keeps failed workers in the lane summary so they stay manageable", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({
      title: "Retry a failed worker",
      repoRoot: "/tmp/openclaw",
    });
    const worker = await storeModule.createCodeWorkerSession({
      taskId: task.id,
      name: "retry-worker",
      status: "failed",
      lane: "worker",
      repoRoot: "/tmp/openclaw",
    });
    const run = await storeModule.createCodeRun({
      taskId: task.id,
      workerId: worker.id,
      status: "failed",
      summary: "Last run timed out",
    });

    const summary = await storeModule.getCodeCockpitWorkspaceSummary();

    expect(summary.activeLanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workerId: worker.id,
          status: "failed",
          latestRun: expect.objectContaining({
            id: run.id,
            status: "failed",
          }),
        }),
      ]),
    );
  });

  it("creates and persists terminal lanes bound to worktrees", async () => {
    const storeModule = await importStoreModule();
    const lane = await storeModule.createCodeTerminalLane({
      repoRoot: "/tmp/openclaw",
      worktreePath: "/tmp/openclaw/.worktrees/code/feature-a",
      backendProfile: "codex-cli",
      title: "feature-a",
    });

    expect(lane).toMatchObject({
      repoRoot: "/tmp/openclaw",
      worktreePath: "/tmp/openclaw/.worktrees/code/feature-a",
      backendProfile: "codex-cli",
      status: "open",
      title: "feature-a",
    });
    expect(lane.id).toMatch(/^tl_/);

    const store = await storeModule.loadCodeCockpitStore();
    expect(store.terminalLanes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: lane.id })]),
    );
  });

  it("links a terminal lane to an existing worker", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({
      title: "Worker-linked lane",
      repoRoot: "/tmp/openclaw",
    });
    const worker = await storeModule.createCodeWorkerSession({
      taskId: task.id,
      name: "lane-worker",
      repoRoot: "/tmp/openclaw",
      worktreePath: "/tmp/openclaw/.worktrees/code/lane-worker",
    });
    const lane = await storeModule.createCodeTerminalLane({
      repoRoot: "/tmp/openclaw",
      worktreePath: worker.worktreePath,
      workerId: worker.id,
    });

    expect(lane.workerId).toBe(worker.id);
    expect(lane.worktreePath).toBe(worker.worktreePath);
  });

  it("rejects terminal lane creation with invalid worker id", async () => {
    const storeModule = await importStoreModule();
    await expect(
      storeModule.createCodeTerminalLane({
        repoRoot: "/tmp/openclaw",
        workerId: "worker_nonexistent",
      }),
    ).rejects.toThrow(/not found/);
  });

  it("updates terminal lane fields including worktree rebinding", async () => {
    const storeModule = await importStoreModule();
    const lane = await storeModule.createCodeTerminalLane({
      repoRoot: "/tmp/openclaw",
      worktreePath: "/tmp/openclaw/.worktrees/code/old-wt",
      title: "old-title",
    });

    const updated = await storeModule.updateCodeTerminalLane(lane.id, {
      worktreePath: "/tmp/openclaw/.worktrees/code/new-wt",
      backendProfile: "claude-cli",
      title: "new-title",
    });

    expect(updated.worktreePath).toBe("/tmp/openclaw/.worktrees/code/new-wt");
    expect(updated.backendProfile).toBe("claude-cli");
    expect(updated.title).toBe("new-title");
  });

  it("closes a terminal lane via status update", async () => {
    const storeModule = await importStoreModule();
    const lane = await storeModule.createCodeTerminalLane({
      repoRoot: "/tmp/openclaw",
    });
    expect(lane.status).toBe("open");

    const closed = await storeModule.updateCodeTerminalLane(lane.id, { status: "closed" });
    expect(closed.status).toBe("closed");
  });

  it("lists terminal lanes sorted by most recently updated", async () => {
    const storeModule = await importStoreModule();
    const older = await storeModule.createCodeTerminalLane({
      repoRoot: "/tmp/openclaw",
      title: "older",
    });
    const newer = await storeModule.createCodeTerminalLane({
      repoRoot: "/tmp/openclaw",
      title: "newer",
    });

    const lanes = await storeModule.listCodeTerminalLanes();
    expect(lanes.length).toBe(2);
    expect(lanes[0].id).toBe(newer.id);
    expect(lanes[1].id).toBe(older.id);
  });

  it("removes a terminal lane from the store", async () => {
    const storeModule = await importStoreModule();
    const lane = await storeModule.createCodeTerminalLane({
      repoRoot: "/tmp/openclaw",
    });

    await storeModule.removeCodeTerminalLane(lane.id);

    const lanes = await storeModule.listCodeTerminalLanes();
    expect(lanes).toHaveLength(0);
  });

  it("includes open terminal lanes in the workspace summary", async () => {
    const storeModule = await importStoreModule();
    const open = await storeModule.createCodeTerminalLane({
      repoRoot: "/tmp/openclaw",
      worktreePath: "/tmp/openclaw/.worktrees/code/a",
      title: "open-lane",
    });
    const closed = await storeModule.createCodeTerminalLane({
      repoRoot: "/tmp/openclaw",
      title: "closed-lane",
    });
    await storeModule.updateCodeTerminalLane(closed.id, { status: "closed" });

    const summary = await storeModule.getCodeCockpitWorkspaceSummary();
    expect(summary.terminalLanes).toHaveLength(1);
    expect(summary.terminalLanes[0].id).toBe(open.id);
  });
});
