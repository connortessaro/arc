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
    completedLanes: [],
    blockedLanes: [],
    needsInputLanes: [],
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
      },
      statusMessage: "Ready. 1 active tasks · 1 items need attention.",
    });

    const rendered = lines.join("\n");
    expect(rendered).toContain("ARC OPERATOR CONSOLE");
    expect(rendered).toContain("OPERATIONS");
    expect(rendered).toContain("ATTENTION");
    expect(rendered).toContain("SYSTEM PULSE");
    expect(rendered).toContain("RECENT RUNS");
  });

  it("renders the COMPLETED pane with done/cancelled tasks", () => {
    const lines = renderArcDashboardForTest({
      width: 158,
      repoRoot: "/srv/arc/repo",
      summary: makeSummary(),
      tasks: [
        makeTask({ id: "task_done", title: "Ship queue routing", status: "done" }),
        makeTask({ id: "task_cancelled", title: "Abandoned spike", status: "cancelled" }),
      ],
      reviews: [],
      health: null,
    });

    const rendered = lines.join("\n");
    expect(rendered).toContain("COMPLETED");
    expect(rendered).toContain("Ship queue routing");
    expect(rendered).toContain("Abandoned spike");
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
      },
      statusMessage: "Ready. 0 active tasks · 1 items need attention.",
    });

    const overflow = lines.find((line) => visibleWidth(line) > 158);
    expect(
      overflow,
      overflow ? `overflowed line (${visibleWidth(overflow)}): ${overflow}` : "",
    ).toBeUndefined();
  });
});
