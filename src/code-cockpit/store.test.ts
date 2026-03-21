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

  it("persists tags on context snapshots", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({ title: "Tag test" });

    const snapshot = await storeModule.appendCodeContextSnapshot({
      taskId: task.id,
      kind: "brief",
      title: "Architecture notes",
      body: "We use a layered store model.",
      tags: ["architecture", "store", "Architecture"],
    });

    expect(snapshot.tags).toEqual(["architecture", "store"]);

    const store = await storeModule.loadCodeCockpitStore();
    const persisted = store.contextSnapshots.find((entry) => entry.id === snapshot.id);
    expect(persisted?.tags).toEqual(["architecture", "store"]);
  });

  it("omits tags field when no tags are provided", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({ title: "No tag test" });

    const snapshot = await storeModule.appendCodeContextSnapshot({
      taskId: task.id,
      kind: "brief",
      title: "Simple note",
      body: "No tags here.",
    });

    expect(snapshot.tags).toBeUndefined();
  });

  it("retrieves a single context snapshot by id", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({ title: "Show test" });

    const snapshot = await storeModule.appendCodeContextSnapshot({
      taskId: task.id,
      kind: "repo",
      title: "Repo overview",
      body: "The repo uses TypeScript ESM.",
    });

    const retrieved = await storeModule.getCodeContextSnapshot(snapshot.id);
    expect(retrieved).toMatchObject({
      id: snapshot.id,
      title: "Repo overview",
      kind: "repo",
    });
  });

  it("throws when retrieving a non-existent snapshot", async () => {
    const storeModule = await importStoreModule();
    await expect(storeModule.getCodeContextSnapshot("memory_nonexistent")).rejects.toThrow(
      'Memory "memory_nonexistent" not found',
    );
  });

  it("searches context snapshots by text query with relevance scoring", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({ title: "Search test" });

    await storeModule.appendCodeContextSnapshot({
      taskId: task.id,
      kind: "brief",
      title: "Gateway architecture",
      body: "The gateway uses RPC methods for communication.",
    });
    await storeModule.appendCodeContextSnapshot({
      taskId: task.id,
      kind: "brief",
      title: "CLI commands",
      body: "CLI commands parse arguments and delegate to runtime.",
    });
    await storeModule.appendCodeContextSnapshot({
      taskId: task.id,
      kind: "brief",
      title: "Gateway RPC protocol",
      body: "RPC protocol uses JSON-RPC 2.0 over the gateway.",
    });

    const result = await storeModule.searchCodeContextSnapshots({
      query: "gateway RPC",
    });

    expect(result.snapshots.length).toBe(2);
    // The snapshot mentioning both "gateway" and "RPC" in title+body should rank highest.
    expect(result.snapshots[0].title).toBe("Gateway RPC protocol");
    expect(result.snapshots[0].score).toBeGreaterThan(0);
    expect(result.snapshots[1].title).toBe("Gateway architecture");
  });

  it("filters search results by tags", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({ title: "Tag filter test" });

    await storeModule.appendCodeContextSnapshot({
      taskId: task.id,
      kind: "brief",
      title: "Tagged note",
      body: "This has relevant tags.",
      tags: ["infra", "gateway"],
    });
    await storeModule.appendCodeContextSnapshot({
      taskId: task.id,
      kind: "brief",
      title: "Untagged note",
      body: "This also mentions gateway.",
    });

    const result = await storeModule.searchCodeContextSnapshots({
      tags: ["gateway"],
    });

    expect(result.snapshots.length).toBe(1);
    expect(result.snapshots[0].title).toBe("Tagged note");
  });

  it("retrieves context for a task with related snapshots ranked by relevance", async () => {
    const storeModule = await importStoreModule();

    const task = await storeModule.createCodeTask({
      title: "Implement gateway health checks",
      goal: "Add deep health probes to the gateway RPC layer",
    });

    // Direct task snapshot.
    await storeModule.appendCodeContextSnapshot({
      taskId: task.id,
      kind: "brief",
      title: "Health check design",
      body: "Probe each backend via RPC ping.",
    });

    // Unrelated task with a relevant snapshot.
    const otherTask = await storeModule.createCodeTask({ title: "Other work" });
    await storeModule.appendCodeContextSnapshot({
      taskId: otherTask.id,
      kind: "repo",
      title: "Gateway RPC internals",
      body: "The gateway exposes health and status methods.",
    });

    // Completely unrelated snapshot.
    await storeModule.appendCodeContextSnapshot({
      taskId: otherTask.id,
      kind: "brief",
      title: "Mobile app styling",
      body: "iOS uses SwiftUI with the Observation framework.",
    });

    const result = await storeModule.retrieveCodeContextForTask(task.id);

    expect(result.taskSnapshots.length).toBe(1);
    expect(result.taskSnapshots[0].title).toBe("Health check design");

    expect(result.relatedSnapshots.length).toBe(1);
    expect(result.relatedSnapshots[0].title).toBe("Gateway RPC internals");
    expect(result.relatedSnapshots[0].score).toBeGreaterThan(0);
  });

  it("returns empty related snapshots when no matches exist", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({
      title: "Unique obscure topic",
      goal: "Something with no related snapshots",
    });

    const result = await storeModule.retrieveCodeContextForTask(task.id);

    expect(result.taskSnapshots).toEqual([]);
    expect(result.relatedSnapshots).toEqual([]);
  });

  it("respects limit in search results", async () => {
    const storeModule = await importStoreModule();
    const task = await storeModule.createCodeTask({ title: "Limit test" });

    for (let i = 0; i < 5; i++) {
      await storeModule.appendCodeContextSnapshot({
        taskId: task.id,
        kind: "brief",
        title: `Note about gateway ${i}`,
        body: `Gateway detail number ${i}.`,
      });
    }

    const result = await storeModule.searchCodeContextSnapshots({
      query: "gateway",
      limit: 2,
    });

    expect(result.snapshots.length).toBe(2);
  });
});
