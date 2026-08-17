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
  type CreateCodeReviewRequestInput,
  type CreateCodeTaskInput,
  type CreateCodeTerminalLaneInput,
  type UpdateCodeTerminalLaneInput,
  createCodeTask,
  createCodeReviewRequest,
  createCodeRun,
  createCodeTerminalLane,
  createCodeWorkerSession,
  getCodeTask,
  getCodeCockpitWorkspaceSummary,
  getCodeRun,
  getCodeTerminalLane,
  getCodeWorkerSession,
  listCodeTerminalLanes,
  loadCodeCockpitStore,
  removeCodeTerminalLane,
  updateCodeTerminalLane,
  type CodeTerminalLane,
  type CodeWorkerAuthHealth,
  type CodeWorkerEngineId,
  type CodePullRequestState,
  type CodeReviewStatus,
  type CodeReviewRequest,
  type CodeResolvedReviewResult,
  type CodeRun,
  type CodeCockpitWorkspaceSummary,
  type CodeTask,
  type CodeTaskStatus,
  type CodeWorkerSession,
  resolveCodeCockpitStorePath,
  resolveCodeReviewRequestStatus,
  updateCodeRun,
  updateCodeTask,
  updateCodeTaskStatus,
  updateCodeWorkerSession,
} from "./store.js";
import { isTaskInRetryBackoff, resolveTaskFailure } from "./task-reliability.js";

const DEFAULT_CODEX_WORKER_MODEL = "gpt-5.4";
const DEFAULT_CLAUDE_WORKER_MODEL = "claude-opus-4-6";
const DEFAULT_WORKER_TIMEOUT_MS = 30 * 60_000;
const MAX_LOG_TAIL_CHARS = 8_000;
const ENGINE_FAILURE_COOLDOWN_MS = 6 * 60 * 60_000;
const FAST_TODO_RELATIVE_PATH = path.join("docs", "cockpit", "FAST-TODO.md");
const ARC_SELF_DRIVE_COMMITTER_NAME = "Arc Self Drive";
const ARC_SELF_DRIVE_COMMITTER_EMAIL = "arc-self-drive@local.invalid";
const SELF_DRIVE_POLICY =
  "You may edit files, run verification, and create local commits on your worker branch. Do not push, merge, or touch the main checkout.";
const DEFAULT_GITHUB_REMOTE = "origin";
const DEFAULT_GITHUB_BASE_BRANCH = "main";

type WorkerEngineAdapter = {
  engineId: CodeWorkerEngineId;
  backendId: string;
  defaultModel: string;
};

type WorkerEngineHealth = {
  engine: WorkerEngineAdapter;
  commandPath?: string;
  authHealth: CodeWorkerAuthHealth;
  healthy: boolean;
};

type GitHubDraftPrConfig = {
  token: string;
  remote: string;
  baseBranch: string;
};

type DraftPullRequestMetadata = {
  pushedBranch: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  pullRequestState: CodePullRequestState;
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
const TASK_ENGINE_HINT_PATTERN = /\[engine:(codex|claude)\]/i;

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

export type ListCodeTasksResult = {
  storePath: string;
  tasks: CodeTask[];
};

export type ShowCodeTaskResult = {
  storePath: string;
  task: CodeTask;
  workers: CodeWorkerSession[];
  reviews: CodeReviewRequest[];
};

export type ListCodeReviewsResult = {
  storePath: string;
  reviews: CodeReviewRequest[];
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
    /rate limit|usage limit|too many requests|quota|credit balance.*low|try again later/.test(
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

function resolveTaskPreferredEngine(task: CodeTask): CodeWorkerEngineId | null {
  const haystacks = [task.title, task.goal, task.notes];
  for (const value of haystacks) {
    const match = value?.match(TASK_ENGINE_HINT_PATTERN);
    if (match?.[1] === "claude" || match?.[1] === "codex") {
      return match[1];
    }
  }
  return null;
}

function resolveStrictSelfDriveEngine(): CodeWorkerEngineId | null {
  const configured = normalizeString(process.env.ARC_SELF_DRIVE_STRICT_ENGINE)?.toLowerCase();
  if (configured === "claude" || configured === "codex") {
    return configured;
  }
  return null;
}

function parseTimestampMs(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  // Allow the runtime host to pin a stable target branch instead of inheriting
  // whatever branch happens to be checked out in the deployment checkout.
  const configuredBaseBranch =
    normalizeString(process.env.ARC_SELF_DRIVE_BASE_BRANCH) ??
    (await readGitValue(runCommand, repoRoot, ["config", "--get", "arc.selfDriveBaseBranch"]));
  if (configuredBaseBranch) {
    return configuredBaseBranch;
  }
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

async function resolveWorkerHeadCommit(params: {
  runCommand: typeof runCommandWithTimeout;
  repoRoot: string;
  worktreePath: string;
}): Promise<string | null> {
  const head = await readGitValue(params.runCommand, params.worktreePath, ["rev-parse", "HEAD"]);
  if (!head) {
    return null;
  }
  const baseBranch = await resolveBaseBranch(params.runCommand, params.repoRoot);
  const baseHead = await readGitValue(params.runCommand, params.repoRoot, [
    "rev-parse",
    baseBranch,
  ]);
  if (baseHead && baseHead === head) {
    return null;
  }
  return head;
}

async function commitWorkerChanges(params: {
  runCommand: typeof runCommandWithTimeout;
  repoRoot: string;
  worktreePath: string;
  taskTitle: string;
}): Promise<string | null> {
  const status = await params
    .runCommand(["git", "-C", params.worktreePath, "status", "--porcelain"], {
      timeoutMs: 10_000,
    })
    .catch(() => null);
  if (!status || status.code !== 0) {
    return null;
  }
  if (!status.stdout.trim()) {
    return await resolveWorkerHeadCommit(params);
  }

  const add = await params
    .runCommand(["git", "-C", params.worktreePath, "add", "-A"], {
      timeoutMs: 10_000,
    })
    .catch(() => null);
  if (!add || add.code !== 0) {
    return null;
  }

  const commit = await params
    .runCommand(
      [
        "git",
        "-C",
        params.worktreePath,
        "-c",
        `user.name=${ARC_SELF_DRIVE_COMMITTER_NAME}`,
        "-c",
        `user.email=${ARC_SELF_DRIVE_COMMITTER_EMAIL}`,
        "commit",
        "-m",
        `arc: ${params.taskTitle.trim() || "complete task"}`,
      ],
      { timeoutMs: 20_000 },
    )
    .catch(() => null);
  if (!commit || commit.code !== 0) {
    return await resolveWorkerHeadCommit(params);
  }

  return await readGitValue(params.runCommand, params.worktreePath, ["rev-parse", "HEAD"]);
}

function resolveGitHubDraftPrConfig(): GitHubDraftPrConfig | null {
  const token = normalizeString(process.env.ARC_SELF_DRIVE_GITHUB_TOKEN);
  if (!token) {
    return null;
  }
  return {
    token,
    remote: normalizeString(process.env.ARC_SELF_DRIVE_GITHUB_REMOTE) ?? DEFAULT_GITHUB_REMOTE,
    baseBranch:
      normalizeString(process.env.ARC_SELF_DRIVE_BASE_BRANCH) ?? DEFAULT_GITHUB_BASE_BRANCH,
  };
}

function buildGitHubCommandEnv(config: GitHubDraftPrConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GH_TOKEN: config.token,
    GITHUB_TOKEN: config.token,
  };
}

function parsePullRequestState(
  rawState: string | undefined,
  isDraft: boolean,
): CodePullRequestState {
  if (isDraft) {
    return "draft";
  }
  switch ((rawState ?? "").trim().toUpperCase()) {
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "closed";
    default:
      return "open";
  }
}

async function readExistingDraftPullRequest(params: {
  runCommand: typeof runCommandWithTimeout;
  config: GitHubDraftPrConfig;
  worktreePath: string;
  branch: string;
}): Promise<DraftPullRequestMetadata | null> {
  const existing = await params
    .runCommand(["gh", "pr", "view", params.branch, "--json", "number,url,state,isDraft"], {
      timeoutMs: 30_000,
      cwd: params.worktreePath,
      env: buildGitHubCommandEnv(params.config),
    })
    .catch(() => null);
  if (!existing || existing.code !== 0) {
    return null;
  }
  try {
    const payload = JSON.parse(existing.stdout) as {
      number?: number;
      url?: string;
      state?: string;
      isDraft?: boolean;
    };
    if (!payload.number || !normalizeString(payload.url)) {
      return null;
    }
    return {
      pushedBranch: params.branch,
      pullRequestNumber: payload.number,
      pullRequestUrl: payload.url!.trim(),
      pullRequestState: parsePullRequestState(payload.state, Boolean(payload.isDraft)),
    };
  } catch {
    return null;
  }
}

async function publishDraftPullRequest(params: {
  runCommand: typeof runCommandWithTimeout;
  worktreePath: string;
  branch: string;
  taskTitle: string;
}): Promise<{ metadata: DraftPullRequestMetadata | null; error?: string }> {
  const config = resolveGitHubDraftPrConfig();
  if (!config) {
    return { metadata: null };
  }

  // Query first so a resumed worker or repeated finalization does not open
  // another draft PR for the same branch.
  const existing = await readExistingDraftPullRequest({
    runCommand: params.runCommand,
    config,
    worktreePath: params.worktreePath,
    branch: params.branch,
  });
  if (existing) {
    return { metadata: existing };
  }

  const gitPush = await params
    .runCommand(
      ["git", "-C", params.worktreePath, "push", config.remote, `HEAD:${params.branch}`],
      {
        timeoutMs: 60_000,
        cwd: params.worktreePath,
        env: buildGitHubCommandEnv(config),
      },
    )
    .catch(() => null);
  if (!gitPush || gitPush.code !== 0) {
    return {
      metadata: null,
      error:
        normalizeString(gitPush?.stderr) ?? normalizeString(gitPush?.stdout) ?? "git push failed",
    };
  }

  const prTitle = `Arc: ${params.taskTitle.trim() || "complete task"}`;
  const prBody =
    "Automated draft PR created by Arc self-drive.\n\n" +
    "This branch was pushed from an isolated worker worktree after the task completed successfully.";
  const created = await params
    .runCommand(
      [
        "gh",
        "pr",
        "create",
        "--draft",
        "--base",
        config.baseBranch,
        "--head",
        params.branch,
        "--title",
        prTitle,
        "--body",
        prBody,
      ],
      {
        timeoutMs: 60_000,
        cwd: params.worktreePath,
        env: buildGitHubCommandEnv(config),
      },
    )
    .catch(() => null);
  if (!created || created.code !== 0) {
    return {
      metadata: null,
      error:
        normalizeString(created?.stderr) ??
        normalizeString(created?.stdout) ??
        "draft PR creation failed",
    };
  }

  const createdMetadata = await readExistingDraftPullRequest({
    runCommand: params.runCommand,
    config,
    worktreePath: params.worktreePath,
    branch: params.branch,
  });
  if (!createdMetadata) {
    return {
      metadata: null,
      error: "draft PR created but metadata lookup failed",
    };
  }
  return { metadata: createdMetadata };
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
    for (const task of store.tasks) {
      if (this.taskShouldBeInReview(store, task.id) && task.status === "in_progress") {
        await updateCodeTaskStatus(task.id, "review").catch(() => undefined);
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
        (entry) => entry.title === title && entry.repoRoot === repoRoot,
      );
      if (existing) {
        if (existing.status === "done" || existing.status === "cancelled") {
          continue;
        }
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
        .filter((task) => !["done", "cancelled", "review", "blocked"].includes(task.status))
        .filter((task) => !isTaskInRetryBackoff(task, this.now()))
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
      const isRunnableTask = (task: CodeTask | undefined) =>
        Boolean(
          task &&
          taskMatchesRepo(task, params.repoRoot) &&
          !["done", "cancelled", "review", "blocked"].includes(task.status) &&
          !isTaskInRetryBackoff(task, this.now()),
        );
      const queuedWorker = [...store.workers]
        .filter((worker) => worker.status === "queued")
        .find((worker) => {
          const task = store.tasks.find((entry) => entry.id === worker.taskId);
          return isRunnableTask(task);
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
          return isRunnableTask(task);
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

  private taskShouldBeInReview(
    store: Awaited<ReturnType<typeof loadCodeCockpitStore>>,
    taskId: string,
  ): boolean {
    return store.reviews.some((review) => review.taskId === taskId && review.status === "pending");
  }

  private async markTaskInProgress(taskId: string) {
    await updateCodeTaskStatus(taskId, "in_progress").catch(() => undefined);
    await updateCodeTask(taskId, {
      retryAfter: null,
    }).catch(() => undefined);
  }

  private buildBackendEnv(preparedBackend: PreparedBackend) {
    const env = { ...process.env, ...preparedBackend.backend.env };
    for (const key of preparedBackend.backend.clearEnv ?? []) {
      delete env[key];
    }
    return env;
  }

  private async checkWorkerEngineHealth(
    engine: WorkerEngineAdapter,
    repoRoot: string,
  ): Promise<WorkerEngineHealth> {
    const backendResolved = this.resolveCliBackendConfig(engine.backendId, this.loadConfig());
    if (!backendResolved) {
      return { engine, authHealth: "missing", healthy: false };
    }

    const preparedBackend = await this.prepareCliBundleMcpConfig({
      backendId: backendResolved.id,
      backend: backendResolved.config,
      workspaceDir: repoRoot,
      config: this.loadConfig(),
      warn: () => {},
    });
    const env = this.buildBackendEnv(preparedBackend);
    const commandPath = preparedBackend.backend.command;

    const healthResult = await this.runCommandWithTimeout(
      engine.engineId === "claude"
        ? [commandPath, "auth", "status"]
        : [commandPath, "login", "status"],
      { timeoutMs: 10_000, cwd: repoRoot, env },
    ).catch((error) => ({
      code: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      pid: undefined,
      signal: null,
      killed: false,
      termination: "exit" as const,
    }));

    const output = `${healthResult.stdout}\n${healthResult.stderr}`;
    if (engine.engineId === "claude") {
      if (/"loggedIn"\s*:\s*true/.test(output)) {
        return { engine, commandPath, authHealth: "healthy", healthy: true };
      }
      if (/"loggedIn"\s*:\s*false/.test(output)) {
        return { engine, commandPath, authHealth: "missing", healthy: false };
      }
      const authHealth = inferAuthHealth({
        stdout: healthResult.stdout,
        stderr: healthResult.stderr,
        success: healthResult.code === 0,
      });
      return {
        engine,
        commandPath,
        authHealth: authHealth === "unknown" ? "missing" : authHealth,
        healthy: false,
      };
    }

    if (healthResult.code === 0) {
      return { engine, commandPath, authHealth: "healthy", healthy: true };
    }
    return {
      engine,
      commandPath,
      authHealth: inferAuthHealth({
        stdout: healthResult.stdout,
        stderr: healthResult.stderr,
        success: false,
      }),
      healthy: false,
    };
  }

  private async resolveSupervisorEngine(task: CodeTask, repoRoot: string) {
    const store = await loadCodeCockpitStore();
    const healthEntries = await Promise.all(
      Object.values(WORKER_ENGINE_ADAPTERS).map(
        async (engine) => await this.checkWorkerEngineHealth(engine, repoRoot),
      ),
    );
    const healthByEngine = Object.fromEntries(
      healthEntries.map((entry) => [entry.engine.engineId, entry]),
    ) as Record<CodeWorkerEngineId, WorkerEngineHealth>;
    const coolingDownEngines = new Set(
      Object.values(WORKER_ENGINE_ADAPTERS)
        .map((engine) => engine.engineId)
        .filter((engineId) => this.isEngineCoolingDown(store, engineId)),
    );
    const strictEngine = resolveStrictSelfDriveEngine();
    if (strictEngine) {
      const strictHealth = healthByEngine[strictEngine];
      if (strictHealth?.healthy && !coolingDownEngines.has(strictEngine)) {
        return { selected: strictHealth, reason: null as string | null };
      }
      if (coolingDownEngines.has(strictEngine)) {
        return {
          selected: null,
          reason: `strict-engine-cooling-down:${strictEngine}`,
        };
      }
      return {
        selected: null,
        reason: `strict-engine-unhealthy:${strictEngine}`,
      };
    }
    const preferredEngine = resolveTaskPreferredEngine(task);
    if (preferredEngine) {
      const preferred = healthByEngine[preferredEngine];
      if (preferred?.healthy && !coolingDownEngines.has(preferredEngine)) {
        return { selected: preferred, reason: null as string | null };
      }
      if (coolingDownEngines.has(preferredEngine)) {
        return {
          selected: null,
          reason: `preferred-engine-cooling-down:${preferredEngine}`,
        };
      }
      return {
        selected: null,
        reason: `preferred-engine-unhealthy:${preferredEngine}`,
      };
    }
    for (const engineId of ["claude", "codex"] as const) {
      const health = healthByEngine[engineId];
      if (health?.healthy && !coolingDownEngines.has(engineId)) {
        return { selected: health, reason: null as string | null };
      }
    }
    if (healthByEngine.claude?.healthy && coolingDownEngines.has("claude")) {
      return { selected: null, reason: "engine-cooling-down:claude" };
    }
    return { selected: null, reason: "no-healthy-engine" };
  }

  private isEngineCoolingDown(
    store: Awaited<ReturnType<typeof loadCodeCockpitStore>>,
    engineId: CodeWorkerEngineId,
  ): boolean {
    const latestExpiredWorker = [...store.workers]
      .filter((worker) => resolveWorkerEngineId(worker) === engineId)
      .filter((worker) => worker.authHealth === "expired")
      .filter(
        (worker) => worker.lastExitReason === "failed" || worker.lastExitReason === "spawn-error",
      )
      .toSorted((left, right) => {
        const leftMs = parseTimestampMs(left.lastExitedAt ?? left.updatedAt) ?? 0;
        const rightMs = parseTimestampMs(right.lastExitedAt ?? right.updatedAt) ?? 0;
        return rightMs - leftMs;
      })[0];
    if (!latestExpiredWorker) {
      return false;
    }
    const exitedAtMs = parseTimestampMs(
      latestExpiredWorker.lastExitedAt ?? latestExpiredWorker.updatedAt,
    );
    if (exitedAtMs === null) {
      return false;
    }
    return this.now().getTime() - exitedAtMs < ENGINE_FAILURE_COOLDOWN_MS;
  }

  private async finalizeWorkerRun(params: {
    workerId: string;
    taskId: string;
    taskTitle: string;
    localRunId: string;
    engine: WorkerEngineAdapter;
    modelId: string;
    preparedBackend: PreparedBackend;
    repoRoot: string;
    worktreePath: string;
    branch: string;
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
      const lastCommitHash = await commitWorkerChanges({
        runCommand: this.runCommandWithTimeout,
        repoRoot: params.repoRoot,
        worktreePath: params.worktreePath,
        taskTitle: params.taskTitle,
      });
      const publishedPr =
        lastCommitHash === null
          ? { metadata: null as DraftPullRequestMetadata | null }
          : await publishDraftPullRequest({
              runCommand: this.runCommandWithTimeout,
              worktreePath: params.worktreePath,
              branch: params.branch,
              taskTitle: params.taskTitle,
            });
      // Publishing the draft PR is outside the worker process itself, so a
      // publish failure should surface as operator attention instead of
      // pretending the entire task completed cleanly.
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
        status: publishedPr.error ? "failed" : "completed",
        activeRunId: null,
        engineId: params.engine.engineId,
        engineModel: params.modelId,
        commandPath: params.preparedBackend.backend.command,
        authHealth: finishedAuthHealth,
        lastAuthCheckedAt: finishedAt,
        threadId: threadId ?? null,
        lastCommitHash: lastCommitHash ?? null,
        pushedBranch:
          lastCommitHash === null ? null : (publishedPr.metadata?.pushedBranch ?? params.branch),
        pullRequestNumber: publishedPr.metadata?.pullRequestNumber ?? null,
        pullRequestUrl: publishedPr.metadata?.pullRequestUrl ?? null,
        pullRequestState: publishedPr.metadata?.pullRequestState ?? null,
        pullRequestError: publishedPr.error ?? null,
        lastExitedAt: finishedAt,
        lastExitReason: publishedPr.error ? "draft-pr-failed" : "succeeded",
      });
      await updateCodeTaskStatus(params.taskId, publishedPr.error ? "blocked" : "done").catch(
        () => undefined,
      );
      await updateCodeTask(params.taskId, {
        lastFailureClass: publishedPr.error ? "operator-needed" : null,
        autoRetryCount: 0,
        retryAfter: null,
        lastOperatorHint: publishedPr.error
          ? "Draft PR publishing failed. Inspect GitHub state before retrying."
          : null,
      }).catch(() => undefined);
      return;
    }

    const failureReason = params.exit.noOutputTimedOut
      ? "no-output-timeout"
      : params.exit.reason === "overall-timeout"
        ? "overall-timeout"
        : params.exit.reason === "spawn-error"
          ? "spawn-error"
          : "failed";
    const currentTask = await getCodeTask(params.taskId).catch(() => null);
    const resolvedFailure = resolveTaskFailure({
      terminationReason: failureReason,
      authHealth: finishedAuthHealth,
      summary: output.text,
      stderr: params.exit.stderr,
      priorAutoRetryCount: currentTask?.autoRetryCount,
      now: this.now(),
    });
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
    await updateCodeTaskStatus(
      params.taskId,
      resolvedFailure.shouldAutoRetry ? "queued" : "blocked",
    ).catch(() => undefined);
    await updateCodeTask(params.taskId, {
      lastFailureClass: resolvedFailure.failureClass,
      autoRetryCount: resolvedFailure.autoRetryCount,
      retryAfter: resolvedFailure.retryAfter ?? null,
      lastOperatorHint: resolvedFailure.operatorHint,
    }).catch(() => undefined);
  }

  private async launchWorkerTurn(params: StartCodeWorkerInput) {
    await this.ensureInitialized();
    if (this.activeRuns.has(params.workerId)) {
      throw new Error(`Worker "${params.workerId}" already has an active gateway-owned run`);
    }

    const { task, worker } = await this.resolveWorker(params.workerId);
    await this.markTaskInProgress(task.id);
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

    const env = this.buildBackendEnv(preparedBackend);

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
            taskTitle: task.title,
            localRunId: queuedRun.id,
            engine,
            modelId,
            preparedBackend,
            repoRoot,
            worktreePath: ensured.worktreePath,
            branch: ensured.branch,
            existingThreadId: worker.threadId,
            useResume,
            exit,
          });
        })
        .catch(async (error: unknown) => {
          await this.finalizeWorkerRun({
            workerId: worker.id,
            taskId: task.id,
            taskTitle: task.title,
            localRunId: queuedRun.id,
            engine,
            modelId,
            preparedBackend,
            repoRoot,
            worktreePath: ensured.worktreePath,
            branch: ensured.branch,
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
      const failureAt = nowIso(this.now);
      const currentTask = await getCodeTask(task.id).catch(() => null);
      const resolvedFailure = resolveTaskFailure({
        terminationReason: "spawn-error",
        stderr: error instanceof Error ? error.message : String(error),
        priorAutoRetryCount: currentTask?.autoRetryCount,
        now: this.now(),
      });
      await updateCodeRun(queuedRun.id, {
        status: "failed",
        finishedAt: failureAt,
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
        lastAuthCheckedAt: failureAt,
        activeRunId: null,
        lastExitedAt: failureAt,
        lastExitReason: "spawn-error",
      });
      await updateCodeTaskStatus(
        task.id,
        resolvedFailure.shouldAutoRetry ? "queued" : "blocked",
      ).catch(() => undefined);
      await updateCodeTask(task.id, {
        lastFailureClass: resolvedFailure.failureClass,
        autoRetryCount: resolvedFailure.autoRetryCount,
        retryAfter: resolvedFailure.retryAfter ?? null,
        lastOperatorHint: resolvedFailure.operatorHint,
      }).catch(() => undefined);
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

  async addTask(params: CreateCodeTaskInput): Promise<CodeTask> {
    await this.ensureInitialized();
    return await createCodeTask(params);
  }

  async listTasks(
    params: {
      repoRoot?: string;
      status?: CodeTaskStatus;
    } = {},
  ): Promise<ListCodeTasksResult> {
    await this.ensureInitialized();
    const store = await loadCodeCockpitStore();
    const repoRoot = normalizeString(params.repoRoot);
    const tasks = [...store.tasks]
      .filter((task) => (params.status ? task.status === params.status : true))
      .filter((task) => (repoRoot ? task.repoRoot === repoRoot : true))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      storePath: resolveCodeCockpitStorePath(),
      tasks,
    };
  }

  async showTask(params: { taskId: string }): Promise<ShowCodeTaskResult> {
    await this.ensureInitialized();
    const store = await loadCodeCockpitStore();
    const task = store.tasks.find((entry) => entry.id === params.taskId);
    if (!task) {
      throw new Error(`Task "${params.taskId}" not found`);
    }
    const workers = [...store.workers]
      .filter((entry) => entry.taskId === task.id)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const reviews = [...store.reviews]
      .filter((entry) => entry.taskId === task.id)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      storePath: resolveCodeCockpitStorePath(),
      task,
      workers,
      reviews,
    };
  }

  async updateTaskStatus(params: { taskId: string; status: CodeTaskStatus }): Promise<CodeTask> {
    await this.ensureInitialized();
    return await updateCodeTaskStatus(params.taskId, params.status);
  }

  async addReview(params: CreateCodeReviewRequestInput): Promise<CodeReviewRequest> {
    await this.ensureInitialized();
    return await createCodeReviewRequest(params);
  }

  async listReviews(
    params: {
      taskId?: string;
      workerId?: string;
      status?: CodeReviewStatus;
    } = {},
  ): Promise<ListCodeReviewsResult> {
    await this.ensureInitialized();
    const store = await loadCodeCockpitStore();
    const reviews = [...store.reviews]
      .filter((review) => (params.taskId ? review.taskId === params.taskId : true))
      .filter((review) => (params.workerId ? review.workerId === params.workerId : true))
      .filter((review) => (params.status ? review.status === params.status : true))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      storePath: resolveCodeCockpitStorePath(),
      reviews,
    };
  }

  async resolveReviewStatus(params: {
    reviewId: string;
    status: CodeReviewStatus;
  }): Promise<CodeResolvedReviewResult> {
    await this.ensureInitialized();
    return await resolveCodeReviewRequestStatus(params.reviewId, params.status);
  }

  async supervisorTick(params: CodeSupervisorTickInput = {}): Promise<CodeSupervisorTickResult> {
    await this.ensureInitialized();
    const repoRoot = normalizeString(params.repoRoot);
    const candidate = await this.findSupervisorCandidate({ repoRoot });
    if (!candidate) {
      return { action: "noop", reason: "no-eligible-work" };
    }

    if (candidate.action === "start") {
      await this.markTaskInProgress(candidate.task.id);
      const started = await this.startWorker({ workerId: candidate.worker.id });
      return { action: "started", task: candidate.task, worker: started.worker, run: started.run };
    }

    if (candidate.action === "resume") {
      await this.markTaskInProgress(candidate.task.id);
      const resumed = await this.resumeWorker({ workerId: candidate.worker.id });
      return { action: "resumed", task: candidate.task, worker: resumed.worker, run: resumed.run };
    }

    const selectedRepoRoot = candidate.task.repoRoot ?? repoRoot;
    if (!selectedRepoRoot) {
      throw new Error(
        `Task "${candidate.task.id}" must define a repo root before self-drive can run`,
      );
    }
    const engineSelection = await this.resolveSupervisorEngine(candidate.task, selectedRepoRoot);
    if (!engineSelection.selected) {
      const resolvedFailure = resolveTaskFailure({
        engineSelectionReason: engineSelection.reason,
        priorAutoRetryCount: candidate.task.autoRetryCount,
        now: this.now(),
      });
      await updateCodeTaskStatus(
        candidate.task.id,
        resolvedFailure.shouldAutoRetry ? "queued" : "blocked",
      ).catch(() => undefined);
      await updateCodeTask(candidate.task.id, {
        lastFailureClass: resolvedFailure.failureClass,
        autoRetryCount: resolvedFailure.autoRetryCount,
        retryAfter: resolvedFailure.retryAfter ?? null,
        lastOperatorHint: resolvedFailure.operatorHint,
      }).catch(() => undefined);
      const refreshedStore = await loadCodeCockpitStore();
      const blockedTask =
        refreshedStore.tasks.find((entry) => entry.id === candidate.task.id) ?? candidate.task;
      return {
        action: "noop",
        reason: engineSelection.reason ?? "no-healthy-engine",
        task: blockedTask,
      };
    }

    const refreshedStoreForWorker = await loadCodeCockpitStore();
    await this.markTaskInProgress(candidate.task.id);
    const worker = await createCodeWorkerSession({
      taskId: candidate.task.id,
      name: buildSelfDriveWorkerName(candidate.task, refreshedStoreForWorker.workers),
      repoRoot: candidate.task.repoRoot,
      objective: buildSelfDriveObjective(candidate.task),
      engineId: engineSelection.selected.engine.engineId,
      engineModel: engineSelection.selected.engine.defaultModel,
      commandPath: engineSelection.selected.commandPath,
      authHealth: engineSelection.selected.authHealth,
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

  async addTerminalLane(input: CreateCodeTerminalLaneInput): Promise<CodeTerminalLane> {
    await this.ensureInitialized();
    return await createCodeTerminalLane(input);
  }

  async updateTerminalLane(params: {
    laneId: string;
    patch: UpdateCodeTerminalLaneInput;
  }): Promise<CodeTerminalLane> {
    await this.ensureInitialized();
    return await updateCodeTerminalLane(params.laneId, params.patch);
  }

  async listTerminalLanes(): Promise<{ terminalLanes: CodeTerminalLane[] }> {
    await this.ensureInitialized();
    return { terminalLanes: await listCodeTerminalLanes() };
  }

  async showTerminalLane(params: { laneId: string }): Promise<CodeTerminalLane> {
    await this.ensureInitialized();
    return await getCodeTerminalLane(params.laneId);
  }

  async removeTerminalLane(params: { laneId: string }): Promise<{ removed: true }> {
    await this.ensureInitialized();
    await removeCodeTerminalLane(params.laneId);
    return { removed: true };
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
