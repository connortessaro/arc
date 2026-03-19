import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callGatewayMock } = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: callGatewayMock,
}));

let tempStateDir: string;

async function importCliModule() {
  vi.resetModules();
  return await Promise.all([
    import("./code-cli.js"),
    import("../gateway/call.js"),
    import("../runtime.js"),
    import("../commands/code.js"),
  ]);
}

beforeEach(async () => {
  tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-code-cli-worker-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", tempStateDir);
  callGatewayMock.mockReset();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tempStateDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe("code worker gateway cli", () => {
  async function createProgram() {
    const [{ registerCodeCli }, gateway, runtime, commands] = await importCliModule();
    const program = new Command();
    program.name("openclaw");
    registerCodeCli(program);
    return { program, gateway, runtime, commands };
  }

  it("routes worker start through the gateway", async () => {
    const { program, gateway, runtime } = await createProgram();
    const log = vi.spyOn(runtime.defaultRuntime, "log").mockImplementation(() => {});
    vi.mocked(gateway.callGateway).mockResolvedValue({
      worker: { id: "worker_123", status: "running" },
      run: { id: "run_123", status: "running" },
    });

    await program.parseAsync(["code", "worker", "start", "worker_123", "--json"], { from: "user" });

    expect(gateway.callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "code.worker.start",
        params: { workerId: "worker_123" },
      }),
    );
    const payload = log.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");
    expect(JSON.parse(payload as string)).toMatchObject({
      worker: { id: "worker_123", status: "running" },
    });
  });

  it("routes worker send through the gateway without a local fallback path", async () => {
    const { gateway, runtime, commands } = await createProgram();
    const log = vi.spyOn(runtime.defaultRuntime, "log").mockImplementation(() => {});
    vi.mocked(gateway.callGateway).mockResolvedValue({
      worker: { id: "worker_123", status: "running" },
      run: { id: "run_456", status: "running" },
    });

    await commands.codeWorkerSendCommand(
      "worker_123",
      { message: "Continue the task", json: true },
      runtime.defaultRuntime,
    );

    expect(gateway.callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "code.worker.send",
        params: { workerId: "worker_123", message: "Continue the task" },
      }),
    );
    const payload = log.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");
    expect(JSON.parse(payload as string)).toMatchObject({
      run: { id: "run_456", status: "running" },
    });
  });

  it("routes supervisor tick through the gateway", async () => {
    const { program, gateway, runtime } = await createProgram();
    const log = vi.spyOn(runtime.defaultRuntime, "log").mockImplementation(() => {});
    vi.mocked(gateway.callGateway).mockResolvedValue({
      action: "started",
      task: { id: "task_123", title: "Ship blocked queue" },
      worker: { id: "worker_123", status: "running" },
    });

    await program.parseAsync(["code", "supervisor", "tick", "--repo", "/srv/arc/repo", "--json"], {
      from: "user",
    });

    expect(gateway.callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "code.supervisor.tick",
        params: { repoRoot: "/srv/arc/repo" },
      }),
    );
    const payload = log.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");
    expect(JSON.parse(payload as string)).toMatchObject({
      action: "started",
      task: { id: "task_123" },
    });
  });
});
