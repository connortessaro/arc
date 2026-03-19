import fs from "node:fs/promises";
import path from "node:path";
import { resolveCliBackendConfig } from "../agents/cli-backends.js";
import { prepareCliBundleMcpConfig } from "../agents/cli-runner/bundle-mcp.js";
import {
  buildCliArgs,
  parseCliJson,
  parseCliJsonl,
  resolveCliNoOutputTimeoutMs,
  resolvePromptInput,
} from "../agents/cli-runner/helpers.js";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { trimLogTail } from "../infra/restart-sentinel.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { getProcessSupervisor } from "../process/supervisor/index.js";
import type { ProcessSupervisor, RunExit, SpawnInput } from "../process/supervisor/index.js";
import {
  createCodeTask,
  createCodeReviewRequest,
  createCodeRun,
  createCodeWorkerSession,
  getCodeCockpitWorkspaceSummary,
  getCodeRun,
  getCodeWorkerSession,
  loadCodeCockpitStore,
  type CodeWorkerAuthHealth,
  type CodeWorkerEngineId,
  type CodeReviewRequest,
  type CodeRun,
  type CodeCockpitWorkspaceSummary,
  type CodeTask,
  type CodeWorkerSession,
  resolveCodeCockpitStorePath,
  updateCodeRun,
  updateCodeTaskStatus,
  updateCodeWorkerSession,
} from "./store.js";

const DEFAULT_CODEX_WORKER_MODEL = "gpt-5.4";
const DEFAULT_CLAUDE_WORKER_MODEL = "claude-sonnet-4-6";
const DEFAULT_WORKER_TIMEOUT_MS = 30 * 60_000;
const MAX_LOG_TAIL_CHARS = 8_000;
const FAST_TODO_RELATIVE_PATH = path.join("docs", "cockpit", "FAST-TODO.md");
const SELF_DRIVE_POLICY =
  "You may edit files, run verification, and create local commits on your worker branch. Do not push, merge, or touch the main checkout.";

type WorkerEngineAdapter = {
  engineId: CodeWorkerEngineId;
  backendId: string;
  defaultModel: string;
};

const WORKER_ENGINE_ADAPTERS: Record<CodeWorkerEngineId, WorkerEngineAdapter> = {
  codex: {
    engineId: "codex",
    backendId: "codex-cli",
    defaultModel: DEFAULT_CODEX_WORKER_MODEL,
  },
  claude: {
    engineId: "claude",
    backendId: "claude-cli",
    defaultModel: DEFAULT_CLAUDE_WORKER_MODEL,
  },
};

type WorkerStopIntent = "paused" | "cancelled" | null;

type ActiveWorkerRun = {
  workerId: string;
  localRunId: string;
  supervisorRunId: string;
  stopIntent: WorkerStopIntent;
  stdoutTail: string;
  stderrTail: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  logWrite: Promise<void>;
};

type PreparedBackend = Awaited<ReturnType<typeof prepareCliBundleMcpConfig>>;

export type CodeCockpitRuntimeDeps = {
  loadConfig?: typeof loadConfig;
  resolveCliBackendConfig?: typeof resolveCliBackendConfig;
  prepareCliBundleMcpConfig?: typeof prepareCliBundleMcpConfig;
  getProcessSupervisor?: () => ProcessSupervisor;
  runCommandWithTimeout?: typeof runCommandWithTimeout;
  now?: () => Date;
};

export type StartCodeWorkerInput = {
  workerId: string;
  message?: string;
};

export type ShowCodeWorkerResult = {
  storePath: string;
  task: CodeTask;
  worker: CodeWorkerSession;
  runs: CodeRun[];
  reviews: CodeReviewRequest[];
};

export type ReadCodeWorkerLogsResult = {
  workerId: string;
  latestRun: CodeRun | null;
  stdoutTail: string;
  stderrTail: string;
};

export type CodeSupervisorTickInput = {
  repoRoot?: string;
};

export type CodeSupervisorTickResult = {
  action: "noop" | "started" | "resumed";
  reason?: string;
  task?: CodeTask;
  worker?: CodeWorkerSession;
  run?: CodeRun;
};

const TASK_PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function normalizeString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function slugifyWorkerName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "worker";
}

function resolveWorkerEngineId(worker: CodeWorkerSession): CodeWorkerEngineId {
  if (worker.engineId === "claude" || worker.backendId === "claude-cli") {
    return "claude";
  }
  return "codex";
}

function resolveWorkerEngineAdapter(worker: CodeWorkerSession): WorkerEngineAdapter {
  return WORKER_ENGINE_ADAPTERS[resolveWorkerEngineId(worker)];
}

function inferAuthHealth(params: {
  stdout?: string;
  stderr?: string;
  success: boolean;
}): CodeWorkerAuthHealth {
  if (params.success) {
    return "healthy";
  }
  const haystack = `${params.stderr ?? ""}\n${params.stdout ?? ""}`.toLowerCase();
  if (
    /log in|login|reauth|oauth|auth expired|session expired|not supported when using .* account/.test(
      haystack,
    )
  ) {
    return "expired";
  }
  if (
    /missing.*api key|missing.*token|no api key|no token|credential|credentials|unauthorized/.test(
      haystack,
    )
  ) {
    return "missing";
  }
  return "unknown";
}

function taskMatchesRepo(task: CodeTask, repoRoot?: string): boolean {
  return !repoRoot || task.repoRoot === repoRoot;
}

function workerBlocksTask(worker: CodeWorkerSession): boolean {
  return ["queued", "running", "paused", "awaiting_review", "awaiting_approval"].includes(
    worker.status,
  );
}

function buildSelfDriveWorkerName(
  task: CodeTask,
  existingWorkers: readonly CodeWorkerSession[],
): string {
  const count = existingWorkers.filter((entry) => entry.taskId === task.id).length + 1;
  return `self-drive-${task.id.replace(/^task_/, "")}-${count}`;
}

function buildSelfDriveObjective(task: CodeTask): string {
  const taskFocus = task.goal?.trim() || task.notes?.trim() || task.title;
  return `${taskFocus}\n\n${SELF_DRIVE_POLICY}`;
}

function parseFastTodoItems(markdown: string): string[] {
  return markdown
    .split(/\r?\n/g)
    .map((line) => line.match(/^- \[ \] (.+)$/)?.[1]?.trim() ?? "")
    .filter(Boolean);
}

function buildDefaultWorktreePath(repoRoot: string, worker: CodeWorkerSession): string {
  return path.join(repoRoot, ".worktrees", "code", slugifyWorkerName(worker.name));
}

function buildDefaultBranchName(task: CodeTask, worker: CodeWorkerSession): string {
  return `code/${task.id}/${slugifyWorkerName(worker.name)}`;
}

function resolveRunSummaryText(params: {
  stdout: string;
  backend: PreparedBackend["backend"];
  useResume: boolean;
}): { text?: string; threadId?: string } {
  const outputMode = params.useResume
    ? (params.backend.resumeOutput ?? params.backend.output)
    : params.backend.output;
  if (outputMode === "jsonl") {
    const parsed = parseCliJsonl(params.stdout, params.backend);
    return { text: parsed?.text, threadId: parsed?.sessionId };
  }
  if (outputMode === "json") {
    const parsed = parseCliJson(params.stdout, params.backend);
    return { text: parsed?.text, threadId: parsed?.sessionId };
  }
  return {};
}

async function readGitValue(
  runCommand: typeof runCommandWithTimeout,
  repoRoot: string,
  args: string[],
): Promise<string | null> {
  const result = await runCommand(["git", "-C", repoRoot, ...args], {
    timeoutMs: 10_000,
  }).catch(() => null);
  if (!result || result.code !== 0) {
    return null;
  }
  const value = result.stdout.trim();
  return value || null;
}

async function resolveBaseBranch(
  runCommand: typeof runCommandWithTimeout,
  repoRoot: string,
): Promise<string> {
  const remoteHead = await readGitValue(runCommand, repoRoot, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (
    remoteHead &&
    (await readGitValue(runCommand, repoRoot, ["rev-parse", "--verify", remoteHead]))
  ) {
    return remoteHead;
  }
  const localHead = await readGitValue(runCommand, repoRoot, ["branch", "--show-current"]);
  if (localHead) {
    return localHead;
  }
  return "main";
}

async function branchExists(
  runCommand: typeof runCommandWithTimeout,
  repoRoot: string,
  branch: string,
): Promise<boolean> {
  const result = await runCommand(
    ["git", "-C", repoRoot, "show-ref", "--verify", `refs/heads/${branch}`],
    {
      timeoutMs: 10_000,
    },
  ).catch(() => null);
  return Boolean(result && result.code === 0);
}

async function worktreeLooksInitialized(worktreePath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(worktreePath, ".git"));
    return true;
  } catch {
    return false;
  }
}

type EnsureWorktreeResult = {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  created: boolean;
};

async function ensureWorkerWorktree(params: {
  worker: CodeWorkerSession;
  task: CodeTask;
  repoRoot: string;
  runCommand: typeof runCommandWithTimeout;
}): Promise<EnsureWorktreeResult> {
  const { worker, task, repoRoot, runCommand } = params;
  const worktreePath = worker.worktreePath ?? buildDefaultWorktreePath(repoRoot, worker);
  const branch = worker.branch ?? buildDefaultBranchName(task, worker);
  if (await worktreeLooksInitialized(worktreePath)) {
    return { repoRoot, worktreePath, branch, created: false };
  }

  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  const branchAlreadyExists = await branchExists(runCommand, repoRoot, branch);
  const argv = branchAlreadyExists
    ? ["git", "-C", repoRoot, "worktree", "add", worktreePath, branch]
    : [
        "git",
        "-C",
        repoRoot,
        "worktree",
        "add",
        "-b",
        branch,
        worktreePath,
        await resolveBaseBranch(runCommand, repoRoot),
      ];
  const result = await runCommand(argv, { timeoutMs: 20_000 });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Unable to create worktree");
  }
  return { repoRoot, worktreePath, branch, created: true };
}

class CodeCockpitRuntime {
  private readonly loadConfig;
  private readonly resolveCliBackendConfig;
  private readonly prepareCliBundleMcpConfig;
  private readonly getProcessSupervisor;
  private readonly runCommandWithTimeout;
  private readonly now;
  private readonly activeRuns = new Map<string, ActiveWorkerRun>();
  private initPromise: Promise<void> | null = null;

  constructor(deps: CodeCockpitRuntimeDeps = {}) {
    this.loadConfig = deps.loadConfig ?? loadConfig;
    this.resolveCliBackendConfig = deps.resolveCliBackendConfig ?? resolveCliBackendConfig;
    this.prepareCliBundleMcpConfig = deps.prepareCliBundleMcpConfig ?? prepareCliBundleMcpConfig;
    this.getProcessSupervisor = deps.getProcessSupervisor ?? getProcessSupervisor;
    this.runCommandWithTimeout = deps.runCommandWithTimeout ?? runCommandWithTimeout;
    this.now = deps.now ?? (() => new Date());
  }

  private async ensureInitialized() {
    if (!this.initPromise) {
      this.initPromise = this.reconcileInterruptedRuns();
    }
    await this.initPromise;
  }

  private async reconcileInterruptedRuns() {
    const store = await loadCodeCockpitStore();
    for (const worker of store.workers) {
      if (worker.activeRunId && worker.status === "running") {
        await updateCodeWorkerSession(worker.id, {
          status: "paused",
          activeRunId: null,
          lastExitedAt: nowIso(this.now),
          lastExitReason: "interrupted",
        });
      }
    }
    for (const run of store.runs) {
      if (run.status === "running") {
        await updateCodeRun(run.id, {
          status: "failed",
          finishedAt: nowIso(this.now),
          terminationReason: "interrupted",
          summary: run.summary ?? "Worker run was interrupted before completion.",
        });
      }
    }
  }

  private async resolveWorker(
    workerId: string,
  ): Promise<{ task: CodeTask; worker: CodeWorkerSession }> {
    const store = await loadCodeCockpitStore();
    const worker = store.workers.find((entry) => entry.id === workerId);
    if (!worker) {
      throw new Error(`Worker "${workerId}" not found`);
    }
    const task = store.tasks.find((entry) => entry.id === worker.taskId);
    if (!task) {
      throw new Error(`Task "${worker.taskId}" not found for worker "${worker.id}"`);
    }
    return { task, worker };
  }

  private createEmptyActiveRun(
    workerId: string,
    localRunId: string,
    stdoutLogPath: string,
    stderrLogPath: string,
  ) {
    return {
      workerId,
      localRunId,
      supervisorRunId: "",
      stopIntent: null,
      stdoutTail: "",
      stderrTail: "",
      stdoutLogPath,
      stderrLogPath,
      logWrite: Promise.resolve(),
    } satisfies ActiveWorkerRun;
  }

  private appendLogChunk(active: ActiveWorkerRun, stream: "stdout" | "stderr", chunk: string) {
    if (!chunk) {
      return;
    }
    const logPath = stream === "stdout" ? active.stdoutLogPath : active.stderrLogPath;
    const nextTail = trimLogTail(
      `${stream === "stdout" ? active.stdoutTail : active.stderrTail}${chunk}`,
      MAX_LOG_TAIL_CHARS,
    );
    if (stream === "stdout") {
      active.stdoutTail = nextTail ?? "";
    } else {
      active.stderrTail = nextTail ?? "";
    }
    active.logWrite = active.logWrite
      .then(async () => {
        await fs.appendFile(logPath, chunk, "utf8");
      })
      .catch(() => {});
  }

  private async ensurePendingReview(taskId: string, workerId: string, workerName: string) {
    const store = await loadCodeCockpitStore();
    const existing = store.reviews.find(
      (entry) =>
        entry.taskId === taskId && entry.workerId === workerId && entry.status === "pending",
    );
    if (existing) {
      return existing;
    }
    return await createCodeReviewRequest({
      taskId,
      workerId,
      title: `Review ${workerName}`,
      summary: "Worker run completed and is ready for review.",
    });
  }

  private async bootstrapFastTodoTask(repoRoot: string): Promise<CodeTask | null> {
    let markdown: string;
    try {
      markdown = await fs.readFile(path.join(repoRoot, FAST_TODO_RELATIVE_PATH), "utf8");
    } catch {
      return null;
    }
    const items = parseFastTodoItems(markdown);
    if (items.length === 0) {
      return null;
    }
    const store = await loadCodeCockpitStore();
    for (const title of items) {
      const existing = store.tasks.find(
        (entry) =>
          entry.title === title &&
          entry.repoRoot === repoRoot &&
          entry.status !== "done" &&
          entry.status !== "cancelled",
      );
      if (existing) {
        return existing;
      }
      return await createCodeTask({
        title,
        repoRoot,
        priority: "high",
        goal: `Complete the FAST-TODO item: ${title}`,
        notes: `Imported from ${FAST_TODO_RELATIVE_PATH}.`,
      });
    }
    return null;
  }

  private async findSupervisorCandidate(params: {
    repoRoot?: string;
  }): Promise<
    | { action: "start"; task: CodeTask; worker: CodeWorkerSession }
    | { action: "resume"; task: CodeTask; worker: CodeWorkerSession }
    | { action: "create"; task: CodeTask }
    | null
  > {
    const pickTask = (store: Awaited<ReturnType<typeof loadCodeCockpitStore>>) =>
      [...store.tasks]
        .filter((task) => taskMatchesRepo(task, params.repoRoot))
        .filter((task) => !["done", "cancelled", "review"].includes(task.status))
        .toSorted((left, right) => {
          const priorityDelta =
            (TASK_PRIORITY_ORDER[left.priority] ?? TASK_PRIORITY_ORDER.normal) -
            (TASK_PRIORITY_ORDER[right.priority] ?? TASK_PRIORITY_ORDER.normal);
          if (priorityDelta !== 0) {
            return priorityDelta;
          }
          return left.updatedAt.localeCompare(right.updatedAt);
        });

    const pickFromStore = (store: Awaited<ReturnType<typeof loadCodeCockpitStore>>) => {
      const queuedWorker = [...store.workers]
        .filter((worker) => worker.status === "queued")
        .find((worker) => {
          const task = store.tasks.find((entry) => entry.id === worker.taskId);
          return Boolean(task && taskMatchesRepo(task, params.repoRoot));
        });
      if (queuedWorker) {
        const task = store.tasks.find((entry) => entry.id === queuedWorker.taskId);
        if (task) {
          return { action: "start" as const, task, worker: queuedWorker };
        }
      }

      const pausedWorker = [...store.workers]
        .filter((worker) => worker.status === "paused")
        .find((worker) => {
          const task = store.tasks.find((entry) => entry.id === worker.taskId);
          return Boolean(task && taskMatchesRepo(task, params.repoRoot));
        });
      if (pausedWorker) {
        const task = store.tasks.find((entry) => entry.id === pausedWorker.taskId);
        if (task) {
          return { action: "resume" as const, task, worker: pausedWorker };
        }
      }

      const task = pickTask(store).find((entry) => {
        const workers = store.workers.filter((worker) => worker.taskId === entry.id);
        return !workers.some(workerBlocksTask);
      });
      if (task) {
        return { action: "create" as const, task };
      }
      return null;
    };

    const initialStore = await loadCodeCockpitStore();
    const initialCandidate = pickFromStore(initialStore);
    if (initialCandidate) {
      return initialCandidate;
    }
    if (!params.repoRoot) {
      return null;
    }
    const bootstrappedTask = await this.bootstrapFastTodoTask(params.repoRoot);
    if (!bootstrappedTask) {
      return null;
    }
    const refreshedStore = await loadCodeCockpitStore();
    return pickFromStore(refreshedStore);
  }

  private async markTaskInProgress(taskId: string) {
    await updateCodeTaskStatus(taskId, "in_progress").catch(() => undefined);
  }

  private async finalizeWorkerRun(params: {
    workerId: string;
    taskId: string;
    workerName: string;
    localRunId: string;
    engine: WorkerEngineAdapter;
    modelId: string;
    preparedBackend: PreparedBackend;
    existingThreadId?: string;
    useResume: boolean;
    exit: RunExit;
  }) {
    const active = this.activeRuns.get(params.workerId);
    if (active) {
      await active.logWrite;
      this.activeRuns.delete(params.workerId);
    }
    const stopIntent = active?.stopIntent ?? null;
    const output = resolveRunSummaryText({
      stdout: params.exit.stdout,
      backend: params.preparedBackend.backend,
      useResume: params.useResume,
    });
    const finishedAt = nowIso(this.now);
    const stdoutTail =
      active?.stdoutTail ?? trimLogTail(params.exit.stdout, MAX_LOG_TAIL_CHARS) ?? undefined;
    const stderrTail =
      active?.stderrTail ?? trimLogTail(params.exit.stderr, MAX_LOG_TAIL_CHARS) ?? undefined;
    const threadId = output.threadId ?? params.existingThreadId;
    const finishedAuthHealth = inferAuthHealth({
      stdout: params.exit.stdout,
      stderr: params.exit.stderr,
      success: params.exit.reason === "exit" && params.exit.exitCode === 0,
    });

    if (stopIntent === "paused" || stopIntent === "cancelled") {
      await updateCodeRun(params.localRunId, {
        status: "cancelled",
        finishedAt,
        terminationReason: stopIntent,
        exitCode: params.exit.exitCode,
        exitSignal: params.exit.exitSignal,
        threadId: threadId ?? null,
        stdoutTail: stdoutTail ?? null,
        stderrTail: stderrTail ?? null,
      });
      await updateCodeWorkerSession(params.workerId, {
        status: stopIntent,
        activeRunId: null,
        engineId: params.engine.engineId,
        engineModel: params.modelId,
        commandPath: params.preparedBackend.backend.command,
        authHealth: finishedAuthHealth,
        lastAuthCheckedAt: finishedAt,
        threadId: threadId ?? null,
        lastExitedAt: finishedAt,
        lastExitReason: stopIntent,
      });
      return;
    }

    if (params.exit.reason === "exit" && params.exit.exitCode === 0) {
      await updateCodeRun(params.localRunId, {
        status: "succeeded",
        finishedAt,
        terminationReason: "succeeded",
        exitCode: params.exit.exitCode,
        exitSignal: params.exit.exitSignal,
        threadId: threadId ?? null,
        summary: output.text ?? null,
        stdoutTail: stdoutTail ?? null,
        stderrTail: stderrTail ?? null,
      });
      await updateCodeWorkerSession(params.workerId, {
        status: "awaiting_review",
        activeRunId: null,
        engineId: params.engine.engineId,
        engineModel: params.modelId,
        commandPath: params.preparedBackend.backend.command,
        authHealth: finishedAuthHealth,
        lastAuthCheckedAt: finishedAt,
        threadId: threadId ?? null,
        lastExitedAt: finishedAt,
        lastExitReason: "succeeded",
      });
      await this.ensurePendingReview(params.taskId, params.workerId, params.workerName);
      return;
    }

    const failureReason = params.exit.noOutputTimedOut
      ? "no-output-timeout"
      : params.exit.reason === "overall-timeout"
        ? "overall-timeout"
        : params.exit.reason === "spawn-error"
          ? "spawn-error"
          : "failed";
    await updateCodeRun(params.localRunId, {
      status: "failed",
      finishedAt,
      terminationReason: failureReason,
      exitCode: params.exit.exitCode,
      exitSignal: params.exit.exitSignal,
      threadId: threadId ?? null,
      summary: output.text ?? null,
      stdoutTail: stdoutTail ?? null,
      stderrTail: stderrTail ?? null,
    });
    await updateCodeWorkerSession(params.workerId, {
      status: "failed",
      activeRunId: null,
      engineId: params.engine.engineId,
      engineModel: params.modelId,
      commandPath: params.preparedBackend.backend.command,
      authHealth: finishedAuthHealth,
      lastAuthCheckedAt: finishedAt,
      threadId: threadId ?? null,
      lastExitedAt: finishedAt,
      lastExitReason: failureReason,
    });
  }

  private async launchWorkerTurn(params: StartCodeWorkerInput) {
    await this.ensureInitialized();
    if (this.activeRuns.has(params.workerId)) {
      throw new Error(`Worker "${params.workerId}" already has an active gateway-owned run`);
    }

    const { task, worker } = await this.resolveWorker(params.workerId);
    const repoRoot = worker.repoRoot ?? task.repoRoot;
    if (!repoRoot) {
      throw new Error(`Worker "${worker.id}" must define a repo root before it can run`);
    }
    const engine = resolveWorkerEngineAdapter(worker);
    const backendResolved = this.resolveCliBackendConfig(engine.backendId, this.loadConfig());
    if (!backendResolved) {
      throw new Error(`CLI backend "${engine.backendId}" is not configured`);
    }
    const preparedBackend = await this.prepareCliBundleMcpConfig({
      backendId: backendResolved.id,
      backend: backendResolved.config,
      workspaceDir: repoRoot,
      config: this.loadConfig(),
      warn: () => {},
    });
    const scopeKey = `code-worker:${worker.id}`;
    const ensured = await ensureWorkerWorktree({
      worker,
      task,
      repoRoot,
      runCommand: this.runCommandWithTimeout,
    });
    const prompt =
      normalizeString(params.message) ??
      worker.objective ??
      task.goal ??
      `Continue working on "${task.title}".`;
    if (!prompt) {
      throw new Error(`Worker "${worker.id}" has no objective or task goal to execute`);
    }
    const modelId = normalizeString(worker.engineModel) ?? engine.defaultModel;
    const useResume = Boolean(worker.threadId && preparedBackend.backend.resumeArgs?.length);
    const baseArgs = useResume
      ? (preparedBackend.backend.resumeArgs ?? []).map((entry) =>
          entry.replaceAll("{sessionId}", worker.threadId ?? ""),
        )
      : (preparedBackend.backend.args ?? []);
    const { argsPrompt, stdin } = resolvePromptInput({
      backend: preparedBackend.backend,
      prompt,
    });
    const args = buildCliArgs({
      backend: preparedBackend.backend,
      baseArgs,
      modelId,
      sessionId: worker.threadId,
      systemPrompt: null,
      promptArg: argsPrompt,
      useResume,
    });
    const logsDir = path.join(resolveStateDir(process.env), "code", "logs", worker.id);
    await fs.mkdir(logsDir, { recursive: true });
    const queuedRun = await createCodeRun({
      taskId: task.id,
      workerId: worker.id,
      status: "queued",
      summary: prompt,
      backendId: backendResolved.id,
      scopeKey,
      threadId: worker.threadId,
      stdoutLogPath: path.join(logsDir, `${Date.now()}-stdout.log`),
      stderrLogPath: path.join(logsDir, `${Date.now()}-stderr.log`),
    });

    await updateCodeWorkerSession(worker.id, {
      status: "running",
      repoRoot,
      worktreePath: ensured.worktreePath,
      branch: ensured.branch,
      engineId: engine.engineId,
      engineModel: modelId,
      backendId: backendResolved.id,
      commandPath: preparedBackend.backend.command,
      scopeKey,
      activeRunId: queuedRun.id,
      lastStartedAt: nowIso(this.now),
    });

    const env = { ...process.env, ...preparedBackend.backend.env };
    for (const key of preparedBackend.backend.clearEnv ?? []) {
      delete env[key];
    }

    const active = this.createEmptyActiveRun(
      worker.id,
      queuedRun.id,
      queuedRun.stdoutLogPath ?? path.join(logsDir, `${queuedRun.id}-stdout.log`),
      queuedRun.stderrLogPath ?? path.join(logsDir, `${queuedRun.id}-stderr.log`),
    );

    try {
      const managedRun = await this.getProcessSupervisor().spawn({
        sessionId: worker.threadId ?? worker.id,
        backendId: backendResolved.id,
        scopeKey,
        replaceExistingScope: true,
        mode: "child",
        argv: [preparedBackend.backend.command, ...args],
        cwd: ensured.worktreePath,
        env,
        input: stdin,
        timeoutMs: DEFAULT_WORKER_TIMEOUT_MS,
        noOutputTimeoutMs: resolveCliNoOutputTimeoutMs({
          backend: preparedBackend.backend,
          timeoutMs: DEFAULT_WORKER_TIMEOUT_MS,
          useResume,
        }),
        onStdout: (chunk) => {
          this.appendLogChunk(active, "stdout", chunk);
        },
        onStderr: (chunk) => {
          this.appendLogChunk(active, "stderr", chunk);
        },
      } satisfies SpawnInput);

      active.supervisorRunId = managedRun.runId;
      this.activeRuns.set(worker.id, active);
      await updateCodeRun(queuedRun.id, {
        status: "running",
        backendId: backendResolved.id,
        scopeKey,
        supervisorRunId: managedRun.runId,
        pid: managedRun.pid ?? null,
        startedAt: nowIso(this.now),
        stdoutLogPath: active.stdoutLogPath,
        stderrLogPath: active.stderrLogPath,
      });

      void managedRun
        .wait()
        .then(async (exit) => {
          await this.finalizeWorkerRun({
            workerId: worker.id,
            taskId: task.id,
            workerName: worker.name,
            localRunId: queuedRun.id,
            engine,
            modelId,
            preparedBackend,
            existingThreadId: worker.threadId,
            useResume,
            exit,
          });
        })
        .catch(async (error: unknown) => {
          await this.finalizeWorkerRun({
            workerId: worker.id,
            taskId: task.id,
            workerName: worker.name,
            localRunId: queuedRun.id,
            engine,
            modelId,
            preparedBackend,
            existingThreadId: worker.threadId,
            useResume,
            exit: {
              reason: "spawn-error",
              exitCode: null,
              exitSignal: null,
              durationMs: 0,
              stdout: "",
              stderr: error instanceof Error ? error.message : String(error),
              timedOut: false,
              noOutputTimedOut: false,
            },
          });
        });
    } catch (error) {
      this.activeRuns.delete(worker.id);
      await updateCodeRun(queuedRun.id, {
        status: "failed",
        finishedAt: nowIso(this.now),
        terminationReason: "spawn-error",
        stderrTail: error instanceof Error ? error.message : String(error),
      });
      await updateCodeWorkerSession(worker.id, {
        status: "failed",
        engineId: engine.engineId,
        engineModel: modelId,
        commandPath: preparedBackend.backend.command,
        authHealth: inferAuthHealth({
          stderr: error instanceof Error ? error.message : String(error),
          success: false,
        }),
        lastAuthCheckedAt: nowIso(this.now),
        activeRunId: null,
        lastExitedAt: nowIso(this.now),
        lastExitReason: "spawn-error",
      });
      throw error;
    }

    return {
      worker: await getCodeWorkerSession(worker.id),
      run: await getCodeRun(queuedRun.id),
    };
  }

  async startWorker(params: StartCodeWorkerInput) {
    return await this.launchWorkerTurn(params);
  }

  async sendWorker(params: { workerId: string; message: string }) {
    return await this.launchWorkerTurn(params);
  }

  async resumeWorker(params: StartCodeWorkerInput) {
    return await this.launchWorkerTurn(params);
  }

  async pauseWorker(params: { workerId: string }) {
    await this.ensureInitialized();
    const active = this.activeRuns.get(params.workerId);
    if (!active) {
      throw new Error(`Worker "${params.workerId}" has no active gateway-owned run`);
    }
    active.stopIntent = "paused";
    await updateCodeWorkerSession(params.workerId, {
      status: "paused",
    });
    this.getProcessSupervisor().cancel(active.supervisorRunId, "manual-cancel");
    return {
      worker: await getCodeWorkerSession(params.workerId),
      run: await getCodeRun(active.localRunId),
    };
  }

  async cancelWorker(params: { workerId: string }) {
    await this.ensureInitialized();
    const active = this.activeRuns.get(params.workerId);
    if (!active) {
      throw new Error(`Worker "${params.workerId}" has no active gateway-owned run`);
    }
    active.stopIntent = "cancelled";
    await updateCodeWorkerSession(params.workerId, {
      status: "cancelled",
    });
    this.getProcessSupervisor().cancel(active.supervisorRunId, "manual-cancel");
    return {
      worker: await getCodeWorkerSession(params.workerId),
      run: await getCodeRun(active.localRunId),
    };
  }

  async showWorker(params: { workerId: string }): Promise<ShowCodeWorkerResult> {
    await this.ensureInitialized();
    const store = await loadCodeCockpitStore();
    const worker = store.workers.find((entry) => entry.id === params.workerId);
    if (!worker) {
      throw new Error(`Worker "${params.workerId}" not found`);
    }
    const task = store.tasks.find((entry) => entry.id === worker.taskId);
    if (!task) {
      throw new Error(`Task "${worker.taskId}" not found for worker "${worker.id}"`);
    }
    const runs = [...store.runs]
      .filter((entry) => entry.workerId === worker.id)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const reviews = [...store.reviews]
      .filter((entry) => entry.workerId === worker.id)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      storePath: resolveCodeCockpitStorePath(),
      task,
      worker,
      runs,
      reviews,
    };
  }

  async readWorkerLogs(params: { workerId: string }): Promise<ReadCodeWorkerLogsResult> {
    const shown = await this.showWorker(params);
    const latestRun = shown.runs[0] ?? null;
    const active = this.activeRuns.get(params.workerId);
    const readTail = async (logPath?: string, fallback?: string) => {
      if (!logPath) {
        return fallback ?? "";
      }
      try {
        return (
          trimLogTail(await fs.readFile(logPath, "utf8"), MAX_LOG_TAIL_CHARS) ?? fallback ?? ""
        );
      } catch {
        return fallback ?? "";
      }
    };
    return {
      workerId: shown.worker.id,
      latestRun,
      stdoutTail: await readTail(latestRun?.stdoutLogPath, active?.stdoutTail),
      stderrTail: await readTail(latestRun?.stderrLogPath, active?.stderrTail),
    };
  }

  async supervisorTick(params: CodeSupervisorTickInput = {}): Promise<CodeSupervisorTickResult> {
    await this.ensureInitialized();
    const repoRoot = normalizeString(params.repoRoot);
    const candidate = await this.findSupervisorCandidate({ repoRoot });
    if (!candidate) {
      return { action: "noop", reason: "no-eligible-work" };
    }

    await this.markTaskInProgress(candidate.task.id);

    if (candidate.action === "start") {
      const started = await this.startWorker({ workerId: candidate.worker.id });
      return { action: "started", task: candidate.task, worker: started.worker, run: started.run };
    }

    if (candidate.action === "resume") {
      const resumed = await this.resumeWorker({ workerId: candidate.worker.id });
      return { action: "resumed", task: candidate.task, worker: resumed.worker, run: resumed.run };
    }

    const store = await loadCodeCockpitStore();
    const worker = await createCodeWorkerSession({
      taskId: candidate.task.id,
      name: buildSelfDriveWorkerName(candidate.task, store.workers),
      repoRoot: candidate.task.repoRoot,
      objective: buildSelfDriveObjective(candidate.task),
      engineId: "codex",
      engineModel: DEFAULT_CODEX_WORKER_MODEL,
    });
    const started = await this.startWorker({ workerId: worker.id });
    const refreshedStore = await loadCodeCockpitStore();
    const refreshedTask =
      refreshedStore.tasks.find((entry) => entry.id === candidate.task.id) ?? candidate.task;
    return { action: "started", task: refreshedTask, worker: started.worker, run: started.run };
  }

  async getWorkspaceSummary(): Promise<CodeCockpitWorkspaceSummary> {
    await this.ensureInitialized();
    return await getCodeCockpitWorkspaceSummary();
  }
}

let singleton: CodeCockpitRuntime | null = null;

export function createCodeCockpitRuntime(deps: CodeCockpitRuntimeDeps = {}) {
  return new CodeCockpitRuntime(deps);
}

export function getCodeCockpitRuntime() {
  if (!singleton) {
    singleton = createCodeCockpitRuntime();
  }
  return singleton;
}

export function resetCodeCockpitRuntimeForTests() {
  singleton = null;
}

export { buildDefaultBranchName, buildDefaultWorktreePath, slugifyWorkerName };
