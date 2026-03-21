import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMethods = vi.hoisted(() => ({
  runtime: {
    addTask: vi.fn(async ({ title, repoRoot }: { title: string; repoRoot?: string }) => ({
      id: "task_123",
      title,
      repoRoot,
      status: "queued",
      priority: "normal",
    })),
    listTasks: vi.fn(async ({ repoRoot }: { repoRoot?: string }) => ({
      storePath: "/tmp/openclaw/code-cockpit.json",
      tasks: [{ id: "task_123", title: "Ship blocked queue", repoRoot, status: "queued" }],
    })),
    showTask: vi.fn(async ({ taskId }: { taskId: string }) => ({
      storePath: "/tmp/openclaw/code-cockpit.json",
      task: { id: taskId, title: "Ship blocked queue", status: "review" },
      workers: [],
      reviews: [],
    })),
    updateTaskStatus: vi.fn(async ({ taskId, status }: { taskId: string; status: string }) => ({
      id: taskId,
      title: "Ship blocked queue",
      status,
    })),
    addReview: vi.fn(async ({ taskId, title }: { taskId: string; title: string }) => ({
      id: "review_123",
      taskId,
      title,
      status: "pending",
    })),
    listReviews: vi.fn(async ({ taskId }: { taskId?: string }) => ({
      storePath: "/tmp/openclaw/code-cockpit.json",
      reviews: [
        {
          id: "review_123",
          taskId: taskId ?? "task_123",
          title: "Review queue",
          status: "pending",
        },
      ],
    })),
    resolveReviewStatus: vi.fn(
      async ({ reviewId, status }: { reviewId: string; status: string }) => ({
        review: { id: reviewId, taskId: "task_123", title: "Review queue", status },
        task: {
          id: "task_123",
          title: "Ship blocked queue",
          status: status === "approved" ? "done" : "in_progress",
        },
        worker: { id: "worker_123", status: status === "approved" ? "completed" : "failed" },
      }),
    ),
    startWorker: vi.fn(async ({ workerId }: { workerId: string }) => ({
      worker: { id: workerId, status: "running" },
      run: { id: "run_123", status: "running" },
    })),
    sendWorker: vi.fn(async ({ workerId, message }: { workerId: string; message: string }) => ({
      worker: { id: workerId, status: "running" },
      run: { id: "run_456", status: "running", message },
    })),
    pauseWorker: vi.fn(async ({ workerId }: { workerId: string }) => ({
      worker: { id: workerId, status: "paused" },
    })),
    resumeWorker: vi.fn(async ({ workerId }: { workerId: string }) => ({
      worker: { id: workerId, status: "running" },
      run: { id: "run_789", status: "running" },
    })),
    cancelWorker: vi.fn(async ({ workerId }: { workerId: string }) => ({
      worker: { id: workerId, status: "cancelled" },
    })),
    showWorker: vi.fn(async ({ workerId }: { workerId: string }) => ({
      worker: { id: workerId, status: "paused" },
      runs: [],
      reviews: [],
    })),
    readWorkerLogs: vi.fn(async ({ workerId }: { workerId: string }) => ({
      workerId,
      latestRun: null,
      stdoutTail: "",
      stderrTail: "",
    })),
    supervisorTick: vi.fn(async ({ repoRoot }: { repoRoot?: string }) => ({
      action: "started",
      task: { id: "task_123", title: "Ship blocked queue", repoRoot },
      worker: { id: "worker_123", status: "running" },
    })),
    getWorkspaceSummary: vi.fn(async () => ({
      storePath: "/tmp/openclaw/code-cockpit.json",
      generatedAt: "2026-03-19T12:00:00.000Z",
      totals: {
        tasks: 1,
        workers: 1,
        reviews: 0,
        decisions: 0,
        contextSnapshots: 0,
        runs: 1,
      },
      taskStatusCounts: {
        queued: 0,
        planning: 0,
        in_progress: 1,
        review: 0,
        blocked: 0,
        done: 0,
        cancelled: 0,
      },
      workerStatusCounts: {
        queued: 0,
        running: 1,
        awaiting_review: 0,
        awaiting_approval: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
      },
      reviewStatusCounts: { pending: 0, approved: 0, changes_requested: 0, dismissed: 0 },
      recentTasks: [],
      recentWorkers: [],
      pendingReviews: [],
      blockedTaskFailureCounts: {
        "transient-runtime": 0,
        "engine-auth": 0,
        "engine-capacity": 0,
        "task-error": 0,
        "operator-needed": 0,
      },
      retryBackoffCount: 0,
      recentRuns: [],
      activeLanes: [],
      reviewReadyLanes: [],
    })),
  },
  getCodeCockpitRuntime: vi.fn(),
}));

runtimeMethods.getCodeCockpitRuntime.mockImplementation(() => runtimeMethods.runtime);

vi.mock("../code-cockpit/runtime.js", () => runtimeMethods);

beforeEach(() => {
  runtimeMethods.getCodeCockpitRuntime.mockClear();
  runtimeMethods.runtime.addTask.mockClear();
  runtimeMethods.runtime.listTasks.mockClear();
  runtimeMethods.runtime.showTask.mockClear();
  runtimeMethods.runtime.updateTaskStatus.mockClear();
  runtimeMethods.runtime.addReview.mockClear();
  runtimeMethods.runtime.listReviews.mockClear();
  runtimeMethods.runtime.resolveReviewStatus.mockClear();
  runtimeMethods.runtime.startWorker.mockClear();
  runtimeMethods.runtime.sendWorker.mockClear();
  runtimeMethods.runtime.pauseWorker.mockClear();
  runtimeMethods.runtime.resumeWorker.mockClear();
  runtimeMethods.runtime.cancelWorker.mockClear();
  runtimeMethods.runtime.showWorker.mockClear();
  runtimeMethods.runtime.readWorkerLogs.mockClear();
  runtimeMethods.runtime.supervisorTick.mockClear();
  runtimeMethods.runtime.getWorkspaceSummary.mockClear();
});

describe("code cockpit gateway handlers", () => {
  it("rejects invalid worker.send params", async () => {
    const { codeCockpitHandlers } = await import("../gateway/server-methods/code-cockpit.js");
    const respond = vi.fn();

    await codeCockpitHandlers["code.worker.send"]({
      req: { method: "code.worker.send", id: "1", params: { workerId: "" } },
      params: { workerId: "" },
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "workerId is required",
      }),
    );
  });

  it("delegates worker.start to the gateway-owned runtime", async () => {
    const { codeCockpitHandlers } = await import("../gateway/server-methods/code-cockpit.js");
    const respond = vi.fn();

    await codeCockpitHandlers["code.worker.start"]({
      req: { method: "code.worker.start", id: "1", params: { workerId: "worker_123" } },
      params: { workerId: "worker_123" },
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(runtimeMethods.getCodeCockpitRuntime).toHaveBeenCalledTimes(1);
    expect(runtimeMethods.runtime.startWorker).toHaveBeenCalledWith({ workerId: "worker_123" });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        worker: { id: "worker_123", status: "running" },
      }),
      undefined,
    );
  });

  it("delegates task.add to the gateway-owned runtime", async () => {
    const { codeCockpitHandlers } = await import("../gateway/server-methods/code-cockpit.js");
    const respond = vi.fn();

    await codeCockpitHandlers["code.task.add"]({
      req: {
        method: "code.task.add",
        id: "1",
        params: { title: "Ship blocked queue", repoRoot: "/srv/arc/repo" },
      },
      params: { title: "Ship blocked queue", repoRoot: "/srv/arc/repo" },
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(runtimeMethods.runtime.addTask).toHaveBeenCalledWith({
      title: "Ship blocked queue",
      repoRoot: "/srv/arc/repo",
      goal: undefined,
      notes: undefined,
      priority: undefined,
      status: undefined,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        id: "task_123",
        title: "Ship blocked queue",
      }),
      undefined,
    );
  });

  it("delegates cockpit summary to the gateway-owned runtime", async () => {
    const { codeCockpitHandlers } = await import("../gateway/server-methods/code-cockpit.js");
    const respond = vi.fn();

    await codeCockpitHandlers["code.cockpit.summary"]({
      req: { method: "code.cockpit.summary", id: "1", params: {} },
      params: {},
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(runtimeMethods.getCodeCockpitRuntime).toHaveBeenCalledTimes(1);
    expect(runtimeMethods.runtime.getWorkspaceSummary).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        storePath: "/tmp/openclaw/code-cockpit.json",
        totals: expect.objectContaining({ workers: 1 }),
      }),
      undefined,
    );
  });

  it("delegates review.status to the gateway-owned runtime", async () => {
    const { codeCockpitHandlers } = await import("../gateway/server-methods/code-cockpit.js");
    const respond = vi.fn();

    await codeCockpitHandlers["code.review.status"]({
      req: {
        method: "code.review.status",
        id: "1",
        params: { reviewId: "review_123", status: "approved" },
      },
      params: { reviewId: "review_123", status: "approved" },
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(runtimeMethods.runtime.resolveReviewStatus).toHaveBeenCalledWith({
      reviewId: "review_123",
      status: "approved",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        review: expect.objectContaining({ id: "review_123", status: "approved" }),
        task: expect.objectContaining({ id: "task_123", status: "done" }),
      }),
      undefined,
    );
  });

  it("delegates supervisor tick to the gateway-owned runtime", async () => {
    const { codeCockpitHandlers } = await import("../gateway/server-methods/code-cockpit.js");
    const respond = vi.fn();

    await codeCockpitHandlers["code.supervisor.tick"]({
      req: { method: "code.supervisor.tick", id: "1", params: { repoRoot: "/srv/arc/repo" } },
      params: { repoRoot: "/srv/arc/repo" },
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(runtimeMethods.getCodeCockpitRuntime).toHaveBeenCalledTimes(1);
    expect(runtimeMethods.runtime.supervisorTick).toHaveBeenCalledWith({
      repoRoot: "/srv/arc/repo",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        action: "started",
        task: expect.objectContaining({ id: "task_123" }),
      }),
      undefined,
    );
  });

  it("builds a dashboard snapshot through the gateway-owned runtime", async () => {
    const { codeCockpitHandlers } = await import("../gateway/server-methods/code-cockpit.js");
    const respond = vi.fn();

    await codeCockpitHandlers["code.cockpit.dashboard"]({
      req: {
        method: "code.cockpit.dashboard",
        id: "1",
        params: { repoRoot: "/srv/arc/repo" },
      },
      params: { repoRoot: "/srv/arc/repo" },
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as never,
    });

    expect(runtimeMethods.getCodeCockpitRuntime).toHaveBeenCalledTimes(1);
    expect(runtimeMethods.runtime.getWorkspaceSummary).toHaveBeenCalledTimes(1);
    expect(runtimeMethods.runtime.listTasks).toHaveBeenCalledWith({
      repoRoot: "/srv/arc/repo",
    });
    expect(runtimeMethods.runtime.listReviews).toHaveBeenCalledWith({});
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        repoRoot: "/srv/arc/repo",
        summary: expect.objectContaining({
          storePath: "/tmp/openclaw/code-cockpit.json",
        }),
        tasks: [
          expect.objectContaining({
            id: "task_123",
            repoRoot: "/srv/arc/repo",
          }),
        ],
        reviews: [
          expect.objectContaining({
            id: "review_123",
            taskId: "task_123",
          }),
        ],
      }),
      undefined,
    );
  });
});
