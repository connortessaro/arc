import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliBackendConfig } from "../config/types.js";
import type { ProcessSupervisor, RunExit, SpawnInput } from "../process/supervisor/index.js";
import { createCodeCockpitRuntime, resetCodeCockpitRuntimeForTests } from "./runtime.js";
import * as store from "./store.js";

const execFileAsync = promisify(execFile);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type PendingManagedRun = {
  input: SpawnInput;
  deferred: Deferred<RunExit>;
  runId: string;
};

const backend: CliBackendConfig = {
  command: "codex",
  args: ["exec", "--json", "--color", "never"],
  resumeArgs: ["exec", "resume", "{sessionId}", "--color", "never"],
  output: "jsonl",
  resumeOutput: "text",
  input: "arg",
  modelArg: "--model",
  sessionIdFields: ["thread_id"],
  sessionMode: "existing",
};

const claudeBackend: CliBackendConfig = {
  command: "claude",
  args: ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"],
  resumeArgs: [
    "-p",
    "--output-format",
    "json",
    "--permission-mode",
    "bypassPermissions",
    "--resume",
    "{sessionId}",
  ],
  output: "json",
  input: "arg",
  modelArg: "--model",
  sessionArg: "--session-id",
  sessionMode: "always",
  sessionIdFields: ["session_id", "sessionId", "conversation_id", "conversationId"],
};

let tempStateDir: string;
let tempRepoRoot: string;

async function runGit(args: string[], cwd = tempRepoRoot): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return result.stdout.trim();
}

async function runCommandWithTimeoutStub(
  argv: string[],
  optionsOrTimeout: number | { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv },
) {
  if (argv[0] === "codex" && argv[1] === "login" && argv[2] === "status") {
    return {
      pid: undefined,
      stdout: "logged in\n",
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
      termination: "exit" as const,
    };
  }
  if (argv[0] === "claude" && argv[1] === "auth" && argv[2] === "status") {
    return {
      pid: undefined,
      stdout: JSON.stringify({
        loggedIn: false,
        authMethod: "none",
        apiProvider: "firstParty",
      }),
      stderr: "",
      code: 0,
      signal: null,
      killed: false,
      termination: "exit" as const,
    };
  }
  const options =
    typeof optionsOrTimeout === "number" ? { timeoutMs: optionsOrTimeout } : optionsOrTimeout;
  try {
    const result = await execFileAsync(argv[0] ?? "", argv.slice(1), {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      encoding: "utf8",
    });
    return {
      pid: undefined,
      stdout: result.stdout,
      stderr: result.stderr,
      code: 0,
      signal: null,
      killed: false,
      termination: "exit" as const,
    };
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string | null;
      signal?: NodeJS.Signals | null;
      killed?: boolean;
    };
    return {
      pid: undefined,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? failed.message,
      code: typeof failed.code === "number" ? failed.code : 1,
      signal: failed.signal ?? null,
      killed: failed.killed ?? false,
      termination: "exit" as const,
    };
  }
}

function createRunCommandWithEngineHealthStub(params: {
  codexHealthy?: boolean;
  claudeHealthy?: boolean;
}) {
  return async (
    argv: string[],
    optionsOrTimeout: number | { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ) => {
    if (argv[0] === "codex" && argv[1] === "login" && argv[2] === "status") {
      return {
        pid: undefined,
        stdout: params.codexHealthy === false ? "" : "logged in\n",
        stderr: params.codexHealthy === false ? "login required" : "",
        code: params.codexHealthy === false ? 1 : 0,
        signal: null,
        killed: false,
        termination: "exit" as const,
      };
    }
    if (argv[0] === "claude" && argv[1] === "auth" && argv[2] === "status") {
      return {
        pid: undefined,
        stdout: JSON.stringify({
          loggedIn: params.claudeHealthy === true,
          authMethod: params.claudeHealthy === true ? "oauth_token" : "none",
          apiProvider: "firstParty",
        }),
        stderr: "",
        code: 0,
        signal: null,
        killed: false,
        termination: "exit" as const,
      };
    }
    return await runCommandWithTimeoutStub(argv, optionsOrTimeout);
  };
}

async function initRepo(root: string) {
  await execFileAsync("git", ["init", "--initial-branch=main", root], { encoding: "utf8" });
  await execFileAsync("git", ["-C", root, "config", "user.name", "OpenClaw Tests"], {
    encoding: "utf8",
  });
  await execFileAsync("git", ["-C", root, "config", "user.email", "tests@example.com"], {
    encoding: "utf8",
  });
  await fs.writeFile(path.join(root, "README.md"), "seed\n", "utf8");
  await execFileAsync("git", ["-C", root, "add", "README.md"], { encoding: "utf8" });
  await execFileAsync("git", ["-C", root, "commit", "-m", "seed"], { encoding: "utf8" });
  await execFileAsync(
    "git",
    ["-C", root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    {
      encoding: "utf8",
    },
  ).catch(() => {
    // Local repos may not have origin; runtime should fall back safely.
  });
}

async function waitForStoreState<T>(
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 2_000,
): Promise<T> {
  const startedAt = Date.now();
  let last = await load();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    last = await load();
  }
  return last;
}

function createSupervisorStub() {
  const pendingRuns: PendingManagedRun[] = [];
  const cancel = vi.fn();
  const spawn = vi.fn(async (input: SpawnInput) => {
    const deferred = createDeferred<RunExit>();
    const runId = `supervisor-${pendingRuns.length + 1}`;
    pendingRuns.push({ input, deferred, runId });
    return {
      runId,
      pid: 4242 + pendingRuns.length,
      startedAtMs: Date.now(),
      wait: async () => await deferred.promise,
      cancel: vi.fn(),
    };
  });

  const supervisor: ProcessSupervisor = {
    spawn,
    cancel,
    cancelScope: vi.fn(),
    reconcileOrphans: vi.fn(async () => {}),
    getRecord: vi.fn(),
  };

  return { supervisor, pendingRuns, cancel };
}

beforeEach(async () => {
  tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-code-cockpit-state-"));
  tempRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-code-cockpit-repo-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", tempStateDir);
  await initRepo(tempRepoRoot);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  resetCodeCockpitRuntimeForTests();
  await fs.rm(tempStateDir, { recursive: true, force: true });
  await fs.rm(tempRepoRoot, { recursive: true, force: true });
});

describe("code cockpit runtime", () => {
  it("starts a worker in an auto-created worktree and moves it to awaiting_review on clean exit", async () => {
    const { supervisor, pendingRuns } = createSupervisorStub();

    const task = await store.createCodeTask({
      title: "Build coding cockpit runtime",
      repoRoot: tempRepoRoot,
      goal: "Ship worker orchestration",
    });
    const worker = await store.createCodeWorkerSession({
      taskId: task.id,
      name: "Planner",
      objective: "Plan and implement the runtime",
    });

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: () => ({ id: "codex-cli", config: backend }),
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: runCommandWithTimeoutStub,
    });

    const started = await runtime.startWorker({ workerId: worker.id });
    const worktreePath = path.join(tempRepoRoot, ".worktrees", "code", "planner");

    expect(started.worker.scopeKey).toBe(`code-worker:${worker.id}`);
    expect(started.worker.backendId).toBe("codex-cli");
    expect(started.worker.worktreePath).toBe(worktreePath);
    expect(started.worker.branch).toBe(`code/${task.id}/planner`);
    expect(pendingRuns).toHaveLength(1);
    expect(pendingRuns[0]?.input.cwd).toBe(worktreePath);
    expect(pendingRuns[0]?.input.argv).toEqual(
      expect.arrayContaining(["codex", "exec", "--json", "--color", "never"]),
    );
    expect(pendingRuns[0]?.input.argv).toEqual(expect.arrayContaining(["--model", "gpt-5.4"]));
    expect(pendingRuns[0]?.input.argv.at(-1)).toContain("Plan and implement the runtime");
    await expect(fs.stat(worktreePath)).resolves.toBeTruthy();
    await expect(runGit(["branch", "--show-current"], worktreePath)).resolves.toBe(
      `code/${task.id}/planner`,
    );

    pendingRuns[0]?.deferred.resolve({
      reason: "exit",
      exitCode: 0,
      exitSignal: null,
      durationMs: 50,
      stdout: `${JSON.stringify({ thread_id: "thread-123", item: { type: "assistant_message", text: "done" } })}\n`,
      stderr: "",
      timedOut: false,
      noOutputTimedOut: false,
    });

    const refreshed = await waitForStoreState(
      async () => await store.loadCodeCockpitStore(),
      (nextStore) =>
        nextStore.workers.some(
          (entry) =>
            entry.id === worker.id &&
            entry.status === "awaiting_review" &&
            entry.threadId === "thread-123" &&
            !entry.activeRunId,
        ),
    );
    const nextWorker = refreshed.workers.find((entry) => entry.id === worker.id);
    expect(nextWorker).toMatchObject({
      status: "awaiting_review",
      threadId: "thread-123",
      lastExitReason: "succeeded",
    });
    expect(nextWorker?.activeRunId).toBeUndefined();
    expect(
      refreshed.reviews.some((entry) => entry.workerId === worker.id && entry.status === "pending"),
    ).toBe(true);
    expect(refreshed.runs.find((entry) => entry.id === started.run.id)).toMatchObject({
      status: "succeeded",
      supervisorRunId: pendingRuns[0]?.runId,
      threadId: "thread-123",
    });
  });

  it("uses the persisted thread id when sending a follow-up worker turn", async () => {
    const { supervisor, pendingRuns } = createSupervisorStub();

    const task = await store.createCodeTask({
      title: "Follow up on a worker thread",
      repoRoot: tempRepoRoot,
    });
    const worker = await store.createCodeWorkerSession({
      taskId: task.id,
      name: "Executor",
      repoRoot: tempRepoRoot,
      status: "awaiting_review",
    });
    await store.updateCodeWorkerSession(worker.id, {
      threadId: "thread-existing",
      worktreePath: path.join(tempRepoRoot, ".worktrees", "code", "executor"),
      branch: `code/${task.id}/executor`,
      backendId: "codex-cli",
      scopeKey: `code-worker:${worker.id}`,
    });
    await fs.mkdir(path.join(tempRepoRoot, ".worktrees", "code", "executor"), { recursive: true });

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: () => ({ id: "codex-cli", config: backend }),
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: runCommandWithTimeoutStub,
    });

    const started = await runtime.sendWorker({
      workerId: worker.id,
      message: "Continue with the next implementation step",
    });

    expect(started.worker.threadId).toBe("thread-existing");
    expect(pendingRuns).toHaveLength(1);
    expect(pendingRuns[0]?.input.argv).toEqual(
      expect.arrayContaining(["codex", "exec", "resume", "thread-existing"]),
    );
    expect(pendingRuns[0]?.input.argv.at(-1)).toContain(
      "Continue with the next implementation step",
    );

    pendingRuns[0]?.deferred.resolve({
      reason: "exit",
      exitCode: 0,
      exitSignal: null,
      durationMs: 25,
      stdout: "continued",
      stderr: "",
      timedOut: false,
      noOutputTimedOut: false,
    });

    const refreshed = await waitForStoreState(
      async () => await store.loadCodeCockpitStore(),
      (nextStore) =>
        nextStore.runs.some((entry) => entry.id === started.run.id && entry.status === "succeeded"),
    );
    expect(refreshed.workers.find((entry) => entry.id === worker.id)).toMatchObject({
      status: "awaiting_review",
      threadId: "thread-existing",
    });
    expect(refreshed.runs.find((entry) => entry.id === started.run.id)).toMatchObject({
      status: "succeeded",
      threadId: "thread-existing",
    });
  });

  it("routes Claude workers through the claude-cli backend with engine-specific model metadata", async () => {
    const { supervisor, pendingRuns } = createSupervisorStub();

    const task = await store.createCodeTask({
      title: "Review a change with Claude",
      repoRoot: tempRepoRoot,
    });
    const worker = await store.createCodeWorkerSession({
      taskId: task.id,
      name: "Claude Reviewer",
      repoRoot: tempRepoRoot,
      objective: "Review the current implementation and propose fixes",
      engineId: "claude",
      engineModel: "claude-sonnet-4-6",
    });

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: (provider) => {
        if (provider === "claude-cli") {
          return { id: "claude-cli", config: claudeBackend };
        }
        if (provider === "codex-cli") {
          return { id: "codex-cli", config: backend };
        }
        return null;
      },
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: runCommandWithTimeoutStub,
    });

    const started = await runtime.startWorker({ workerId: worker.id });

    expect(started.worker.engineId).toBe("claude");
    expect(started.worker.engineModel).toBe("claude-sonnet-4-6");
    expect(started.worker.backendId).toBe("claude-cli");
    expect(started.worker.commandPath).toBe("claude");
    expect(pendingRuns).toHaveLength(1);
    expect(pendingRuns[0]?.input.argv).toEqual(
      expect.arrayContaining([
        "claude",
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        "bypassPermissions",
      ]),
    );
    expect(pendingRuns[0]?.input.argv).toEqual(
      expect.arrayContaining(["--model", "claude-sonnet-4-6"]),
    );
    expect(pendingRuns[0]?.input.argv.at(-1)).toContain("Review the current implementation");

    pendingRuns[0]?.deferred.resolve({
      reason: "exit",
      exitCode: 0,
      exitSignal: null,
      durationMs: 25,
      stdout: JSON.stringify({
        session_id: "claude-session-123",
        result: "Review complete",
      }),
      stderr: "",
      timedOut: false,
      noOutputTimedOut: false,
    });

    const refreshed = await waitForStoreState(
      async () => await store.loadCodeCockpitStore(),
      (nextStore) =>
        nextStore.workers.some(
          (entry) =>
            entry.id === worker.id &&
            entry.status === "awaiting_review" &&
            entry.threadId === "claude-session-123" &&
            entry.authHealth === "healthy",
        ),
    );
    expect(refreshed.workers.find((entry) => entry.id === worker.id)).toMatchObject({
      engineId: "claude",
      engineModel: "claude-sonnet-4-6",
      backendId: "claude-cli",
      commandPath: "claude",
      threadId: "claude-session-123",
      authHealth: "healthy",
    });
  });

  it("pauses a running worker through the supervisor and requires explicit resume after reconciliation", async () => {
    const { supervisor, pendingRuns, cancel } = createSupervisorStub();

    const task = await store.createCodeTask({
      title: "Pause a worker",
      repoRoot: tempRepoRoot,
    });
    const worker = await store.createCodeWorkerSession({
      taskId: task.id,
      name: "Reviewer",
      objective: "Prepare a diff review",
    });

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: () => ({ id: "codex-cli", config: backend }),
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: runCommandWithTimeoutStub,
    });

    const started = await runtime.startWorker({ workerId: worker.id });
    await runtime.pauseWorker({ workerId: worker.id });

    expect(cancel).toHaveBeenCalledWith(pendingRuns[0]?.runId, "manual-cancel");
    expect(
      (await store.loadCodeCockpitStore()).workers.find((entry) => entry.id === worker.id),
    ).toMatchObject({
      status: "paused",
      activeRunId: started.run.id,
    });

    pendingRuns[0]?.deferred.resolve({
      reason: "manual-cancel",
      exitCode: null,
      exitSignal: "SIGKILL",
      durationMs: 10,
      stdout: "",
      stderr: "",
      timedOut: false,
      noOutputTimedOut: false,
    });

    const refreshed = await waitForStoreState(
      async () => await store.loadCodeCockpitStore(),
      (nextStore) =>
        nextStore.runs.some((entry) => entry.id === started.run.id && entry.status === "cancelled"),
    );
    const pausedWorker = refreshed.workers.find((entry) => entry.id === worker.id);
    expect(pausedWorker).toMatchObject({
      status: "paused",
      lastExitReason: "paused",
    });
    expect(pausedWorker?.activeRunId).toBeUndefined();
    expect(refreshed.runs.find((entry) => entry.id === started.run.id)).toMatchObject({
      status: "cancelled",
      terminationReason: "paused",
    });
  });

  it("reconciles interrupted running workers to paused on gateway-owned runtime startup", async () => {
    const { supervisor } = createSupervisorStub();

    const task = await store.createCodeTask({
      title: "Recover after restart",
      repoRoot: tempRepoRoot,
    });
    const worker = await store.createCodeWorkerSession({
      taskId: task.id,
      name: "Recovery",
      status: "running",
    });
    const run = await store.createCodeRun({
      taskId: task.id,
      workerId: worker.id,
      status: "running",
    });
    await store.updateCodeWorkerSession(worker.id, {
      backendId: "codex-cli",
      scopeKey: `code-worker:${worker.id}`,
      activeRunId: run.id,
    });

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: () => ({ id: "codex-cli", config: backend }),
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: runCommandWithTimeoutStub,
    });

    const shown = await runtime.showWorker({ workerId: worker.id });

    expect(shown.worker).toMatchObject({
      status: "paused",
      lastExitReason: "interrupted",
    });
    expect(shown.worker.activeRunId).toBeUndefined();
    expect(shown.runs.find((entry) => entry.id === run.id)).toMatchObject({
      status: "failed",
      terminationReason: "interrupted",
    });
  });

  it("bootstraps the next task from FAST-TODO and starts a self-drive worker", async () => {
    const { supervisor, pendingRuns } = createSupervisorStub();

    await fs.mkdir(path.join(tempRepoRoot, "docs", "cockpit"), { recursive: true });
    await fs.writeFile(
      path.join(tempRepoRoot, "docs", "cockpit", "FAST-TODO.md"),
      "# Fast TODO\n\n- [ ] Ship blocked queue\n- [ ] Add workspace persistence\n",
      "utf8",
    );

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: (provider) =>
        provider === "codex-cli" ? { id: "codex-cli", config: backend } : null,
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: runCommandWithTimeoutStub,
    });

    const result = await runtime.supervisorTick({ repoRoot: tempRepoRoot });

    expect(result.action).toBe("started");
    expect(result.task).toMatchObject({
      title: "Ship blocked queue",
      repoRoot: tempRepoRoot,
      status: "in_progress",
    });
    expect(result.worker).toMatchObject({
      taskId: result.task?.id,
      status: "running",
      engineId: "codex",
      engineModel: "gpt-5.4",
    });
    expect(pendingRuns).toHaveLength(1);
    expect(pendingRuns[0]?.input.argv).toEqual(expect.arrayContaining(["--model", "gpt-5.4"]));
    expect(pendingRuns[0]?.input.argv.at(-1)).toContain(
      "Do not push, merge, or touch the main checkout",
    );
  });

  it("resumes a paused worker before creating new self-drive work", async () => {
    const { supervisor, pendingRuns } = createSupervisorStub();

    const task = await store.createCodeTask({
      title: "Resume a paused change",
      repoRoot: tempRepoRoot,
      status: "in_progress",
    });
    const worktreePath = path.join(tempRepoRoot, ".worktrees", "code", "resume-worker");
    await fs.mkdir(worktreePath, { recursive: true });
    const worker = await store.createCodeWorkerSession({
      taskId: task.id,
      name: "resume-worker",
      repoRoot: tempRepoRoot,
      worktreePath,
      branch: `code/${task.id}/resume-worker`,
      objective: "Finish the paused task",
      status: "paused",
      engineId: "codex",
      engineModel: "gpt-5.4",
    });
    await store.updateCodeWorkerSession(worker.id, {
      threadId: "thread-existing",
      backendId: "codex-cli",
      scopeKey: `code-worker:${worker.id}`,
    });

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: (provider) =>
        provider === "codex-cli" ? { id: "codex-cli", config: backend } : null,
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: runCommandWithTimeoutStub,
    });

    const result = await runtime.supervisorTick({ repoRoot: tempRepoRoot });

    expect(result.action).toBe("resumed");
    expect(result.worker?.id).toBe(worker.id);
    expect(pendingRuns).toHaveLength(1);
    expect(pendingRuns[0]?.input.argv).toEqual(
      expect.arrayContaining(["codex", "exec", "resume", "thread-existing"]),
    );
  });

  it("prefers Claude when both engines are healthy", async () => {
    const { supervisor, pendingRuns } = createSupervisorStub();

    await fs.mkdir(path.join(tempRepoRoot, "docs", "cockpit"), { recursive: true });
    await fs.writeFile(
      path.join(tempRepoRoot, "docs", "cockpit", "FAST-TODO.md"),
      "# Fast TODO\n\n- [ ] Review the current logs with Claude\n",
      "utf8",
    );

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: (provider) => {
        if (provider === "claude-cli") {
          return { id: "claude-cli", config: claudeBackend };
        }
        if (provider === "codex-cli") {
          return { id: "codex-cli", config: backend };
        }
        return null;
      },
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: createRunCommandWithEngineHealthStub({
        codexHealthy: true,
        claudeHealthy: true,
      }),
    });

    const result = await runtime.supervisorTick({ repoRoot: tempRepoRoot });

    expect(result.action).toBe("started");
    expect(result.worker).toMatchObject({
      engineId: "claude",
      engineModel: "claude-sonnet-4-6",
      backendId: "claude-cli",
      authHealth: "healthy",
    });
    expect(pendingRuns).toHaveLength(1);
    expect(pendingRuns[0]?.input.argv).toEqual(expect.arrayContaining(["claude", "-p"]));
  });

  it("falls back to Codex when Claude is unhealthy", async () => {
    const { supervisor, pendingRuns } = createSupervisorStub();

    await fs.mkdir(path.join(tempRepoRoot, "docs", "cockpit"), { recursive: true });
    await fs.writeFile(
      path.join(tempRepoRoot, "docs", "cockpit", "FAST-TODO.md"),
      "# Fast TODO\n\n- [ ] Implement the remote review queue\n",
      "utf8",
    );

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: (provider) => {
        if (provider === "claude-cli") {
          return { id: "claude-cli", config: claudeBackend };
        }
        if (provider === "codex-cli") {
          return { id: "codex-cli", config: backend };
        }
        return null;
      },
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: createRunCommandWithEngineHealthStub({
        codexHealthy: true,
        claudeHealthy: false,
      }),
    });

    const result = await runtime.supervisorTick({ repoRoot: tempRepoRoot });

    expect(result.action).toBe("started");
    expect(result.worker).toMatchObject({
      engineId: "codex",
      engineModel: "gpt-5.4",
      backendId: "codex-cli",
      authHealth: "healthy",
    });
    expect(pendingRuns).toHaveLength(1);
    expect(pendingRuns[0]?.input.argv).toEqual(expect.arrayContaining(["codex", "exec"]));
  });

  it("falls back to Codex when Claude recently failed with a usage-limit style auth error", async () => {
    const { supervisor, pendingRuns } = createSupervisorStub();

    await fs.mkdir(path.join(tempRepoRoot, "docs", "cockpit"), { recursive: true });
    await fs.writeFile(
      path.join(tempRepoRoot, "docs", "cockpit", "FAST-TODO.md"),
      "# Fast TODO\n\n- [ ] Keep self-drive moving on the VPS\n",
      "utf8",
    );

    const task = await store.createCodeTask({
      title: "Previous Claude run",
      repoRoot: tempRepoRoot,
    });
    await store.createCodeWorkerSession({
      taskId: task.id,
      name: "Claude Exhausted",
      repoRoot: tempRepoRoot,
      engineId: "claude",
      engineModel: "claude-sonnet-4-6",
      status: "failed",
      authHealth: "expired",
    });
    const savedStore = await store.loadCodeCockpitStore();
    const savedWorker = savedStore.workers.find((entry) => entry.name === "Claude Exhausted");
    expect(savedWorker).toBeTruthy();
    if (!savedWorker) {
      throw new Error("Expected saved worker");
    }
    await store.updateCodeWorkerSession(savedWorker.id, {
      lastExitReason: "failed",
      lastExitedAt: new Date().toISOString(),
    });

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: (provider) => {
        if (provider === "claude-cli") {
          return { id: "claude-cli", config: claudeBackend };
        }
        if (provider === "codex-cli") {
          return { id: "codex-cli", config: backend };
        }
        return null;
      },
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: createRunCommandWithEngineHealthStub({
        codexHealthy: true,
        claudeHealthy: true,
      }),
    });

    const result = await runtime.supervisorTick({ repoRoot: tempRepoRoot });

    expect(result.action).toBe("started");
    expect(result.worker?.engineId).toBe("codex");
    expect(pendingRuns).toHaveLength(1);
    expect(pendingRuns[0]?.input.argv).toEqual(expect.arrayContaining(["codex", "exec"]));
  });

  it("blocks a preferred-engine task when its requested engine is unavailable", async () => {
    const { supervisor, pendingRuns } = createSupervisorStub();

    await fs.mkdir(path.join(tempRepoRoot, "docs", "cockpit"), { recursive: true });
    await fs.writeFile(
      path.join(tempRepoRoot, "docs", "cockpit", "FAST-TODO.md"),
      "# Fast TODO\n\n- [ ] [engine:claude] Review the remote auth loop\n",
      "utf8",
    );

    const runtime = createCodeCockpitRuntime({
      getProcessSupervisor: () => supervisor,
      loadConfig: () => ({}),
      resolveCliBackendConfig: (provider) => {
        if (provider === "claude-cli") {
          return { id: "claude-cli", config: claudeBackend };
        }
        if (provider === "codex-cli") {
          return { id: "codex-cli", config: backend };
        }
        return null;
      },
      prepareCliBundleMcpConfig: async ({ backendId, backend: input }) => ({
        backendId,
        backend: input,
      }),
      runCommandWithTimeout: createRunCommandWithEngineHealthStub({
        codexHealthy: true,
        claudeHealthy: false,
      }),
    });

    const result = await runtime.supervisorTick({ repoRoot: tempRepoRoot });

    expect(result).toMatchObject({
      action: "noop",
      reason: "preferred-engine-unhealthy:claude",
      task: {
        title: "[engine:claude] Review the remote auth loop",
        status: "blocked",
      },
    });
    expect(pendingRuns).toHaveLength(0);
  });
});
