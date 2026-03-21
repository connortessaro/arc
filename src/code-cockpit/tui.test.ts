import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import type { CodeCockpitWorkspaceSummary, CodeReviewRequest, CodeTask } from "./store.js";
import { renderArcDashboardForTest } from "./tui.js";

function makeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: "task_fa54172b",
    title: "route completed and blocked work into clear queues",
    status: "review",
    priority: "high",
    repoRoot: "/srv/arc/repo",
    goal: "Route completed and blocked work into clear queues.",
    notes: undefined,
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z",
    workerIds: ["worker_4fcb41d8"],
    reviewIds: ["review_fa54172b"],
    ...overrides,
  };
}

function makeReview(overrides: Partial<CodeReviewRequest> = {}): CodeReviewRequest {
  return {
    id: "review_fa54172b",
    taskId: "task_fa54172b",
    workerId: "worker_4fcb41d8",
    title: "Review self-drive-fa54172b-1",
    status: "pending",
    summary: "Worker run completed and is ready for review.",
    notes: undefined,
    createdAt: "2026-03-19T00:00:00.000Z",
    updatedAt: "2026-03-19T00:00:00.000Z",
    ...overrides,
  };
}

function makeSummary(): CodeCockpitWorkspaceSummary {
  return {
    storePath: "/home/arc/.openclaw/code-cockpit.json",
    totals: {
      tasks: 1,
      workers: 1,
      reviews: 1,
      decisions: 0,
      contextSnapshots: 0,
      runs: 2,
    },
    taskStatusCounts: {
      queued: 0,
      planning: 0,
      in_progress: 0,
      review: 1,
      blocked: 0,
      done: 0,
      cancelled: 0,
    },
    workerStatusCounts: {
      queued: 0,
      running: 0,
      awaiting_review: 1,
      awaiting_approval: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
    reviewStatusCounts: {
      pending: 1,
      approved: 0,
      changes_requested: 0,
      dismissed: 0,
    },
    recentTasks: [],
    recentWorkers: [],
    pendingReviews: [makeReview()],
    blockedTaskFailureCounts: {
      "transient-runtime": 1,
      "engine-auth": 0,
      "engine-capacity": 0,
      "task-error": 0,
      "operator-needed": 0,
    },
    retryBackoffCount: 1,
    generatedAt: "2026-03-20T01:04:32.000Z",
    recentRuns: [
      {
        id: "run_4fcb41d8",
        taskId: "task_fa54172b",
        workerId: "worker_4fcb41d8",
        status: "succeeded",
        summary:
          'The FAST-TODO item "route completed and blocked work into clear queues" is already fully implemented and marked `[x]`. This was shipped in commit `6a247cfea`. There is no remaining work — the item was already complete when this task was assigned. No changes needed, no commit to make.',
        createdAt: "2026-03-20T01:04:30.000Z",
        updatedAt: "2026-03-20T01:04:30.000Z",
      },
      {
        id: "run_failed",
        taskId: "task_fa54172b",
        workerId: "worker_failed",
        status: "failed",
        terminationReason: "spawn-error",
        createdAt: "2026-03-20T01:03:30.000Z",
        updatedAt: "2026-03-20T01:03:30.000Z",
      },
    ],
    activeLanes: [],
  };
}

describe("arc dashboard renderer", () => {
  it("renders the local operator-console sections", () => {
    const lines = renderArcDashboardForTest({
      width: 158,
      repoRoot: "/srv/arc/repo",
      summary: makeSummary(),
      tasks: [makeTask({ status: "in_progress" })],
      reviews: [makeReview()],
      health: {
        gateway: { status: "active", port: "18789", health: { ok: true, status: "live" } },
        engines: {
          claude: { health: "healthy" },
          codex: { health: "healthy" },
        },
        system: {
          memoryAvailableMiB: 2560,
          swapUsedMiB: 320,
          diskFreeGiB: 97.2,
          gatewayRssMiB: 668,
        },
      },
      statusMessage: "Ready. 1 active tasks · 1 items need attention.",
    });

    const rendered = lines.join("\n");
    expect(rendered).toContain("ARC OPERATOR CONSOLE");
    expect(rendered).toContain("OPERATIONS");
    expect(rendered).toContain("ATTENTION");
    expect(rendered).toContain("SYSTEM PULSE");
    expect(rendered).toContain("RECENTLY COMPLETED");
    expect(rendered).toContain("RECENT RUNS");
  });

  it("keeps every rendered line within the terminal width for long recent-run summaries", () => {
    const lines = renderArcDashboardForTest({
      width: 158,
      repoRoot: "/srv/arc/repo",
      summary: makeSummary(),
      tasks: [makeTask()],
      reviews: [makeReview()],
      health: {
        gateway: { status: "active", port: "18789", health: { ok: true, status: "live" } },
        engines: {
          claude: { health: "healthy" },
          codex: { health: "healthy" },
        },
        system: {
          memoryAvailableMiB: 2560,
          swapUsedMiB: 320,
          diskFreeGiB: 97.2,
          gatewayRssMiB: 668,
        },
      },
      statusMessage: "Ready. 0 active tasks · 1 items need attention.",
    });

    const overflow = lines.find((line) => visibleWidth(line) > 158);
    expect(
      overflow,
      overflow ? `overflowed line (${visibleWidth(overflow)}): ${overflow}` : "",
    ).toBeUndefined();
  });

  it("shows retry backoff, blocked failure classes, and memory headroom in the pulse panel", () => {
    const lines = renderArcDashboardForTest({
      width: 158,
      repoRoot: "/srv/arc/repo",
      summary: makeSummary(),
      tasks: [makeTask()],
      reviews: [makeReview()],
      health: {
        gateway: { status: "active", port: "18789", health: { ok: true, status: "live" } },
        engines: {
          claude: { health: "healthy" },
          codex: { health: "healthy" },
        },
        system: {
          memoryAvailableMiB: 2560,
          swapUsedMiB: 320,
          diskFreeGiB: 97.2,
          gatewayRssMiB: 668,
        },
      },
      statusMessage: "Ready.",
    });

    const rendered = lines.join("\n");
    expect(rendered).toContain("retry 1");
    expect(rendered).toContain("blocked transient-runtime=1");
    expect(rendered).toContain("mem 2560MiB");
  });

  it("renders the queue pipeline with task status counts", () => {
    const summary = makeSummary();
    summary.taskStatusCounts = {
      queued: 2,
      planning: 1,
      in_progress: 3,
      review: 1,
      blocked: 0,
      done: 5,
      cancelled: 0,
    };
    const lines = renderArcDashboardForTest({
      width: 158,
      repoRoot: "/srv/arc/repo",
      summary,
      tasks: [makeTask({ status: "in_progress" })],
      reviews: [],
      health: null,
      statusMessage: "Ready.",
    });

    const rendered = lines.join("\n");
    expect(rendered).toContain("Q:2");
    expect(rendered).toContain("P:1");
    expect(rendered).toContain("A:3");
    expect(rendered).toContain("R:1");
    expect(rendered).toContain("B:0");
    expect(rendered).toContain("D:5");
  });

  it("shows health warnings when system resources are critical", () => {
    const lines = renderArcDashboardForTest({
      width: 158,
      repoRoot: "/srv/arc/repo",
      summary: makeSummary(),
      tasks: [makeTask({ status: "in_progress" })],
      reviews: [],
      health: {
        gateway: { status: "active" },
        system: {
          memoryAvailableMiB: 256,
          swapUsedMiB: 2048,
          diskFreeGiB: 2.1,
          gatewayRssMiB: 3000,
        },
      },
      statusMessage: "Ready.",
    });

    const rendered = lines.join("\n");
    expect(rendered).toContain("LOW MEM 256MiB");
    expect(rendered).toContain("HIGH SWAP 2048MiB");
    expect(rendered).toContain("LOW DISK 2.1GiB");
    expect(rendered).toContain("HIGH RSS 3000MiB");
  });

  it("does not show health warnings when resources are healthy", () => {
    const lines = renderArcDashboardForTest({
      width: 158,
      repoRoot: "/srv/arc/repo",
      summary: makeSummary(),
      tasks: [makeTask({ status: "in_progress" })],
      reviews: [],
      health: {
        gateway: { status: "active" },
        system: {
          memoryAvailableMiB: 2560,
          swapUsedMiB: 320,
          diskFreeGiB: 97.2,
          gatewayRssMiB: 668,
        },
      },
      statusMessage: "Ready.",
    });

    const rendered = lines.join("\n");
    expect(rendered).not.toContain("LOW MEM");
    expect(rendered).not.toContain("HIGH SWAP");
    expect(rendered).not.toContain("LOW DISK");
    expect(rendered).not.toContain("HIGH RSS");
  });

  it("shows recently completed tasks", () => {
    const lines = renderArcDashboardForTest({
      width: 158,
      repoRoot: "/srv/arc/repo",
      summary: makeSummary(),
      tasks: [
        makeTask({ status: "in_progress" }),
        makeTask({
          id: "task_done_1",
          title: "fix the login bug",
          status: "done",
          updatedAt: "2026-03-20T02:00:00.000Z",
        }),
        makeTask({
          id: "task_done_2",
          title: "add retry logic",
          status: "done",
          updatedAt: "2026-03-20T01:00:00.000Z",
        }),
      ],
      reviews: [],
      health: null,
      statusMessage: "Ready.",
    });

    const rendered = lines.join("\n");
    expect(rendered).toContain("RECENTLY COMPLETED");
    expect(rendered).toContain("fix the login bug");
    expect(rendered).toContain("add retry logic");
  });

  it("shows updated key hints including unblock and cancel", () => {
    const lines = renderArcDashboardForTest({
      width: 158,
      repoRoot: "/srv/arc/repo",
      summary: makeSummary(),
      tasks: [makeTask({ status: "in_progress" })],
      reviews: [],
      health: null,
      statusMessage: "Ready.",
    });

    const rendered = lines.join("\n");
    expect(rendered).toContain("u unblock");
    expect(rendered).toContain("d cancel");
  });
});
