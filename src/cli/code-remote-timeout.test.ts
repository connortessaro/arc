import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callGatewayMock } = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
}));
const { loadConfigMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(() => ({})),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: callGatewayMock,
}));
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => loadConfigMock(),
  };
});

async function importModules() {
  vi.resetModules();
  return await Promise.all([import("../commands/code.js"), import("../runtime.js")]);
}

describe("code remote gateway timeout", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    loadConfigMock.mockReset().mockReturnValue({
      gateway: {
        mode: "remote",
        remote: { url: "ws://127.0.0.1:28789", token: "token-123" },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("uses the extended timeout for remote summary requests", async () => {
    const [{ codeSummaryCommand }, runtime] = await importModules();
    const log = vi.spyOn(runtime.defaultRuntime, "log").mockImplementation(() => {});
    callGatewayMock.mockResolvedValue({
      storePath: "/home/arc/.openclaw/code/cockpit.json",
      totals: {
        tasks: 0,
        workers: 0,
        reviews: 0,
        decisions: 0,
        contextSnapshots: 0,
        runs: 0,
      },
      taskStatusCounts: {},
      workerStatusCounts: {},
      reviewStatusCounts: {},
      recentTasks: [],
      recentWorkers: [],
      pendingReviews: [],
      recentRuns: [],
      activeLanes: [],
      generatedAt: "2026-03-19T00:00:00.000Z",
    });

    await codeSummaryCommand({ json: true }, runtime.defaultRuntime);

    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "code.cockpit.summary",
        timeoutMs: 60_000,
      }),
    );
    expect(log).toHaveBeenCalled();
  });

  it("uses the extended timeout for supervisor ticks", async () => {
    const [{ codeSupervisorTickCommand }, runtime] = await importModules();
    const log = vi.spyOn(runtime.defaultRuntime, "log").mockImplementation(() => {});
    callGatewayMock.mockResolvedValue({
      action: "started",
      task: { id: "task_123" },
      worker: { id: "worker_123", status: "running" },
    });

    await codeSupervisorTickCommand({ repo: "/srv/arc/repo", json: true }, runtime.defaultRuntime);

    expect(callGatewayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "code.supervisor.tick",
        params: { repoRoot: "/srv/arc/repo" },
        timeoutMs: 60_000,
      }),
    );
    expect(log).toHaveBeenCalled();
  });
});
