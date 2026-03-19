import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMethods = vi.hoisted(() => ({
  runtime: {
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
      recentRuns: [],
      activeLanes: [],
    })),
  },
  getCodeCockpitRuntime: vi.fn(),
}));

runtimeMethods.getCodeCockpitRuntime.mockImplementation(() => runtimeMethods.runtime);

vi.mock("../code-cockpit/runtime.js", () => runtimeMethods);

beforeEach(() => {
  runtimeMethods.getCodeCockpitRuntime.mockClear();
  runtimeMethods.runtime.startWorker.mockClear();
  runtimeMethods.runtime.sendWorker.mockClear();
  runtimeMethods.runtime.pauseWorker.mockClear();
  runtimeMethods.runtime.resumeWorker.mockClear();
  runtimeMethods.runtime.cancelWorker.mockClear();
  runtimeMethods.runtime.showWorker.mockClear();
  runtimeMethods.runtime.readWorkerLogs.mockClear();
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
});
