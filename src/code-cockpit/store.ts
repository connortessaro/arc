import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../infra/json-files.js";

export const CODE_COCKPIT_STORE_VERSION = 1;

export const CODE_TASK_STATUSES = [
  "queued",
  "planning",
  "in_progress",
  "review",
  "blocked",
  "done",
  "cancelled",
] as const;

export const CODE_TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export const CODE_WORKER_STATUSES = [
  "queued",
  "running",
  "awaiting_review",
  "awaiting_approval",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export const CODE_WORKER_LANES = ["worker", "review"] as const;
export const CODE_WORKER_ENGINE_IDS = ["codex", "claude"] as const;
export const CODE_WORKER_AUTH_HEALTHS = ["unknown", "healthy", "expired", "missing"] as const;
export const CODE_PULL_REQUEST_STATES = ["draft", "open", "merged", "closed"] as const;

export const CODE_REVIEW_STATUSES = [
  "pending",
  "approved",
  "changes_requested",
  "dismissed",
] as const;

export const CODE_CONTEXT_SNAPSHOT_KINDS = ["repo", "obsidian", "brief", "handoff"] as const;

export const CODE_RUN_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

export type CodeTaskStatus = (typeof CODE_TASK_STATUSES)[number];
export type CodeTaskPriority = (typeof CODE_TASK_PRIORITIES)[number];
export type CodeWorkerStatus = (typeof CODE_WORKER_STATUSES)[number];
export type CodeWorkerLane = (typeof CODE_WORKER_LANES)[number];
export type CodeWorkerEngineId = (typeof CODE_WORKER_ENGINE_IDS)[number];
export type CodeWorkerAuthHealth = (typeof CODE_WORKER_AUTH_HEALTHS)[number];
export type CodePullRequestState = (typeof CODE_PULL_REQUEST_STATES)[number];
export type CodeReviewStatus = (typeof CODE_REVIEW_STATUSES)[number];
export type CodeContextSnapshotKind = (typeof CODE_CONTEXT_SNAPSHOT_KINDS)[number];
export type CodeRunStatus = (typeof CODE_RUN_STATUSES)[number];

export type CodeTask = {
  id: string;
  title: string;
  status: CodeTaskStatus;
  priority: CodeTaskPriority;
  repoRoot?: string;
  goal?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  workerIds: string[];
  reviewIds: string[];
};

export type CodeWorkerSession = {
  id: string;
  taskId: string;
  name: string;
  status: CodeWorkerStatus;
  lane: CodeWorkerLane;
  repoRoot?: string;
  worktreePath?: string;
  branch?: string;
  objective?: string;
  engineId?: CodeWorkerEngineId;
  engineModel?: string;
  backendId?: string;
  commandPath?: string;
  authHealth?: CodeWorkerAuthHealth;
  lastAuthCheckedAt?: string;
  lastCommitHash?: string;
  pushedBranch?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  pullRequestState?: CodePullRequestState;
  pullRequestError?: string;
  scopeKey?: string;
  activeRunId?: string;
  threadId?: string;
  lastStartedAt?: string;
  lastExitedAt?: string;
  lastExitReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type CodeReviewRequest = {
  id: string;
  taskId: string;
  workerId?: string;
  title: string;
  status: CodeReviewStatus;
  summary?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type CodeDecisionLog = {
  id: string;
  taskId?: string;
  workerId?: string;
  kind: string;
  summary: string;
  createdAt: string;
};

export type CodeContextSnapshot = {
  id: string;
  taskId?: string;
  workerId?: string;
  kind: CodeContextSnapshotKind;
  title: string;
  body: string;
  createdAt: string;
};

export type CodeRun = {
  id: string;
  taskId?: string;
  workerId?: string;
  status: CodeRunStatus;
  summary?: string;
  backendId?: string;
  scopeKey?: string;
  supervisorRunId?: string;
  threadId?: string;
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  terminationReason?: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  stdoutTail?: string;
  stderrTail?: string;
  stdoutLogPath?: string;
  stderrLogPath?: string;
  createdAt: string;
  updatedAt: string;
};

export type CodeCockpitStore = {
  version: number;
  updatedAt: string;
  tasks: CodeTask[];
  workers: CodeWorkerSession[];
  reviews: CodeReviewRequest[];
  decisions: CodeDecisionLog[];
  contextSnapshots: CodeContextSnapshot[];
  runs: CodeRun[];
};

export type CodeCockpitSummary = {
  storePath: string;
  totals: {
    tasks: number;
    workers: number;
    reviews: number;
    decisions: number;
    contextSnapshots: number;
    runs: number;
  };
  taskStatusCounts: Record<CodeTaskStatus, number>;
  workerStatusCounts: Record<CodeWorkerStatus, number>;
  reviewStatusCounts: Record<CodeReviewStatus, number>;
  recentTasks: CodeTask[];
  recentWorkers: CodeWorkerSession[];
  pendingReviews: CodeReviewRequest[];
};

export type CodeCockpitLaneSummary = {
  taskId: string;
  taskTitle: string;
  workerId: string;
  workerName: string;
  lane: CodeWorkerLane;
  status: CodeWorkerStatus;
  repoRoot?: string;
  worktreePath?: string;
  branch?: string;
  objective?: string;
  engineId?: CodeWorkerEngineId;
  engineModel?: string;
  backendId?: string;
  commandPath?: string;
  authHealth?: CodeWorkerAuthHealth;
  activeRunId?: string;
  updatedAt: string;
  latestRun: CodeRun | null;
  pendingReview: CodeReviewRequest | null;
};

export type CodeCockpitWorkspaceSummary = CodeCockpitSummary & {
  generatedAt: string;
  recentRuns: CodeRun[];
  activeLanes: CodeCockpitLaneSummary[];
  completedLanes: CodeCockpitLaneSummary[];
  blockedLanes: CodeCockpitLaneSummary[];
  needsInputLanes: CodeCockpitLaneSummary[];
};

export type CodeResolvedReviewResult = {
  review: CodeReviewRequest;
  task: CodeTask;
  worker: CodeWorkerSession | null;
};

export type CodeCockpitStoreOptions = {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  now?: () => Date;
};

export type CreateCodeTaskInput = {
  title: string;
  status?: CodeTaskStatus;
  priority?: CodeTaskPriority;
  repoRoot?: string;
  goal?: string;
  notes?: string;
};

export type CreateCodeWorkerSessionInput = {
  taskId: string;
  name: string;
  status?: CodeWorkerStatus;
  lane?: CodeWorkerLane;
  repoRoot?: string;
  worktreePath?: string;
  branch?: string;
  objective?: string;
  engineId?: CodeWorkerEngineId;
  engineModel?: string;
  commandPath?: string;
  authHealth?: CodeWorkerAuthHealth;
};

export type CreateCodeReviewRequestInput = {
  taskId: string;
  workerId?: string;
  title: string;
  summary?: string;
  notes?: string;
  status?: CodeReviewStatus;
};

export type AppendCodeDecisionLogInput = {
  taskId?: string;
  workerId?: string;
  kind: string;
  summary: string;
};

export type AppendCodeContextSnapshotInput = {
  taskId?: string;
  workerId?: string;
  kind?: CodeContextSnapshotKind;
  title: string;
  body: string;
};

export type CreateCodeRunInput = {
  taskId?: string;
  workerId?: string;
  status?: CodeRunStatus;
  summary?: string;
  backendId?: string;
  scopeKey?: string;
  supervisorRunId?: string;
  threadId?: string;
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  terminationReason?: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  stdoutTail?: string;
  stderrTail?: string;
  stdoutLogPath?: string;
  stderrLogPath?: string;
};

export type UpdateCodeWorkerSessionInput = {
  status?: CodeWorkerStatus;
  lane?: CodeWorkerLane;
  repoRoot?: string | null;
  worktreePath?: string | null;
  branch?: string | null;
  objective?: string | null;
  engineId?: CodeWorkerEngineId | null;
  engineModel?: string | null;
  backendId?: string | null;
  commandPath?: string | null;
  authHealth?: CodeWorkerAuthHealth | null;
  lastAuthCheckedAt?: string | null;
  lastCommitHash?: string | null;
  pushedBranch?: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  pullRequestState?: CodePullRequestState | null;
  pullRequestError?: string | null;
  scopeKey?: string | null;
  activeRunId?: string | null;
  threadId?: string | null;
  lastStartedAt?: string | null;
  lastExitedAt?: string | null;
  lastExitReason?: string | null;
};

export type UpdateCodeRunInput = {
  status?: CodeRunStatus;
  summary?: string | null;
  backendId?: string | null;
  scopeKey?: string | null;
  supervisorRunId?: string | null;
  threadId?: string | null;
  pid?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  terminationReason?: string | null;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  stdoutTail?: string | null;
  stderrTail?: string | null;
  stdoutLogPath?: string | null;
  stderrLogPath?: string | null;
};

const TASK_TRANSITIONS: Record<CodeTaskStatus, readonly CodeTaskStatus[]> = {
  queued: ["planning", "in_progress", "blocked", "cancelled"],
  planning: ["queued", "in_progress", "blocked", "cancelled"],
  in_progress: ["review", "blocked", "done", "cancelled"],
  review: ["in_progress", "blocked", "done", "cancelled"],
  blocked: ["planning", "in_progress", "review", "cancelled"],
  done: [],
  cancelled: [],
};

const WORKER_TRANSITIONS: Record<CodeWorkerStatus, readonly CodeWorkerStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["awaiting_review", "awaiting_approval", "paused", "completed", "failed", "cancelled"],
  awaiting_review: ["running", "completed", "failed", "cancelled"],
  awaiting_approval: ["running", "paused", "cancelled"],
  paused: ["running", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

const REVIEW_TRANSITIONS: Record<CodeReviewStatus, readonly CodeReviewStatus[]> = {
  pending: ["approved", "changes_requested", "dismissed"],
  approved: [],
  changes_requested: ["pending", "dismissed"],
  dismissed: [],
};

const RUN_TRANSITIONS: Record<CodeRunStatus, readonly CodeRunStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

const withStoreLock = createAsyncLock();

function createEmptyStore(updatedAt: string): CodeCockpitStore {
  return {
    version: CODE_COCKPIT_STORE_VERSION,
    updatedAt,
    tasks: [],
    workers: [],
    reviews: [],
    decisions: [],
    contextSnapshots: [],
    runs: [],
  };
}

function nowIso(options?: CodeCockpitStoreOptions): string {
  return (options?.now?.() ?? new Date()).toISOString();
}

function normalizeString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizePatchString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return normalizeString(value) ?? null;
}

function normalizeStore(
  candidate: Partial<CodeCockpitStore> | null,
  updatedAt: string,
): CodeCockpitStore {
  if (!candidate || typeof candidate !== "object") {
    return createEmptyStore(updatedAt);
  }
  return {
    version: CODE_COCKPIT_STORE_VERSION,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.length > 0
        ? candidate.updatedAt
        : updatedAt,
    tasks: Array.isArray(candidate.tasks) ? candidate.tasks : [],
    workers: Array.isArray(candidate.workers) ? candidate.workers : [],
    reviews: Array.isArray(candidate.reviews) ? candidate.reviews : [],
    decisions: Array.isArray(candidate.decisions) ? candidate.decisions : [],
    contextSnapshots: Array.isArray(candidate.contextSnapshots) ? candidate.contextSnapshots : [],
    runs: Array.isArray(candidate.runs) ? candidate.runs : [],
  };
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

function findTask(store: CodeCockpitStore, taskId: string): CodeTask {
  const task = store.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Task "${taskId}" not found`);
  }
  return task;
}

function findWorker(store: CodeCockpitStore, workerId: string): CodeWorkerSession {
  const worker = store.workers.find((entry) => entry.id === workerId);
  if (!worker) {
    throw new Error(`Worker "${workerId}" not found`);
  }
  return worker;
}

function findReview(store: CodeCockpitStore, reviewId: string): CodeReviewRequest {
  const review = store.reviews.find((entry) => entry.id === reviewId);
  if (!review) {
    throw new Error(`Review "${reviewId}" not found`);
  }
  return review;
}

function findRun(store: CodeCockpitStore, runId: string): CodeRun {
  const run = store.runs.find((entry) => entry.id === runId);
  if (!run) {
    throw new Error(`Run "${runId}" not found`);
  }
  return run;
}

function assertTaskStatus(value: string): CodeTaskStatus {
  if ((CODE_TASK_STATUSES as readonly string[]).includes(value)) {
    return value as CodeTaskStatus;
  }
  throw new Error(
    `Invalid task status "${value}". Expected one of: ${CODE_TASK_STATUSES.join(", ")}`,
  );
}

function assertTaskPriority(value: string): CodeTaskPriority {
  if ((CODE_TASK_PRIORITIES as readonly string[]).includes(value)) {
    return value as CodeTaskPriority;
  }
  throw new Error(
    `Invalid task priority "${value}". Expected one of: ${CODE_TASK_PRIORITIES.join(", ")}`,
  );
}

function assertWorkerStatus(value: string): CodeWorkerStatus {
  if ((CODE_WORKER_STATUSES as readonly string[]).includes(value)) {
    return value as CodeWorkerStatus;
  }
  throw new Error(
    `Invalid worker status "${value}". Expected one of: ${CODE_WORKER_STATUSES.join(", ")}`,
  );
}

function assertWorkerLane(value: string): CodeWorkerLane {
  if ((CODE_WORKER_LANES as readonly string[]).includes(value)) {
    return value as CodeWorkerLane;
  }
  throw new Error(
    `Invalid worker lane "${value}". Expected one of: ${CODE_WORKER_LANES.join(", ")}`,
  );
}

function assertWorkerEngineId(value: string): CodeWorkerEngineId {
  if ((CODE_WORKER_ENGINE_IDS as readonly string[]).includes(value)) {
    return value as CodeWorkerEngineId;
  }
  throw new Error(
    `Invalid worker engine "${value}". Expected one of: ${CODE_WORKER_ENGINE_IDS.join(", ")}`,
  );
}

function assertWorkerAuthHealth(value: string): CodeWorkerAuthHealth {
  if ((CODE_WORKER_AUTH_HEALTHS as readonly string[]).includes(value)) {
    return value as CodeWorkerAuthHealth;
  }
  throw new Error(
    `Invalid worker auth health "${value}". Expected one of: ${CODE_WORKER_AUTH_HEALTHS.join(", ")}`,
  );
}

function assertPullRequestState(value: string): CodePullRequestState {
  if ((CODE_PULL_REQUEST_STATES as readonly string[]).includes(value)) {
    return value as CodePullRequestState;
  }
  throw new Error(
    `Invalid pull request state "${value}". Expected one of: ${CODE_PULL_REQUEST_STATES.join(", ")}`,
  );
}

function assertReviewStatus(value: string): CodeReviewStatus {
  if ((CODE_REVIEW_STATUSES as readonly string[]).includes(value)) {
    return value as CodeReviewStatus;
  }
  throw new Error(
    `Invalid review status "${value}". Expected one of: ${CODE_REVIEW_STATUSES.join(", ")}`,
  );
}

function assertContextSnapshotKind(value: string): CodeContextSnapshotKind {
  if ((CODE_CONTEXT_SNAPSHOT_KINDS as readonly string[]).includes(value)) {
    return value as CodeContextSnapshotKind;
  }
  throw new Error(
    `Invalid memory kind "${value}". Expected one of: ${CODE_CONTEXT_SNAPSHOT_KINDS.join(", ")}`,
  );
}

function assertRunStatus(value: string): CodeRunStatus {
  if ((CODE_RUN_STATUSES as readonly string[]).includes(value)) {
    return value as CodeRunStatus;
  }
  throw new Error(
    `Invalid run status "${value}". Expected one of: ${CODE_RUN_STATUSES.join(", ")}`,
  );
}

function assertTransition<T extends string>(
  entityName: string,
  transitions: Record<T, readonly T[]>,
  current: T,
  next: T,
): void {
  if (current === next) {
    return;
  }
  const allowed = transitions[current] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`Invalid ${entityName} transition from "${current}" to "${next}"`);
  }
}

function buildCounts<T extends readonly string[]>(
  values: T,
  entries: string[],
): Record<T[number], number> {
  const counts = Object.fromEntries(values.map((value) => [value, 0])) as Record<T[number], number>;
  for (const entry of entries) {
    if (entry in counts) {
      counts[entry as T[number]] += 1;
    }
  }
  return counts;
}

function sortByUpdatedAt<T extends { updatedAt?: string; createdAt?: string }>(entries: T[]) {
  return [...entries].toSorted((left, right) => {
    const leftStamp = left.updatedAt ?? left.createdAt ?? "";
    const rightStamp = right.updatedAt ?? right.createdAt ?? "";
    return rightStamp.localeCompare(leftStamp);
  });
}

async function mutateStore<T>(
  options: CodeCockpitStoreOptions | undefined,
  mutator: (store: CodeCockpitStore, updatedAt: string) => T | Promise<T>,
): Promise<T> {
  return await withStoreLock(async () => {
    const updatedAt = nowIso(options);
    const storePath = resolveCodeCockpitStorePath(options);
    const current = normalizeStore(
      await readJsonFile<Partial<CodeCockpitStore>>(storePath),
      updatedAt,
    );
    const result = await mutator(current, updatedAt);
    current.updatedAt = updatedAt;
    await writeJsonAtomic(storePath, current, {
      mode: 0o600,
      trailingNewline: true,
      ensureDirMode: 0o700,
    });
    return result;
  });
}

export function resolveCodeCockpitStorePath(options: CodeCockpitStoreOptions = {}): string {
  return path.join(
    resolveStateDir(options.env, options.homedir ?? os.homedir),
    "code",
    "cockpit.json",
  );
}

export async function loadCodeCockpitStore(
  options: CodeCockpitStoreOptions = {},
): Promise<CodeCockpitStore> {
  const updatedAt = nowIso(options);
  const storePath = resolveCodeCockpitStorePath(options);
  return normalizeStore(await readJsonFile<Partial<CodeCockpitStore>>(storePath), updatedAt);
}

export async function createCodeTask(
  input: CreateCodeTaskInput,
  options?: CodeCockpitStoreOptions,
): Promise<CodeTask> {
  if (!normalizeString(input.title)) {
    throw new Error("Task title is required");
  }
  const status = assertTaskStatus(input.status ?? "queued");
  const priority = assertTaskPriority(input.priority ?? "normal");
  return await mutateStore(options, (store, updatedAt) => {
    const task: CodeTask = {
      id: createId("task"),
      title: normalizeString(input.title) ?? "Untitled task",
      status,
      priority,
      repoRoot: normalizeString(input.repoRoot),
      goal: normalizeString(input.goal),
      notes: normalizeString(input.notes),
      createdAt: updatedAt,
      updatedAt,
      workerIds: [],
      reviewIds: [],
    };
    store.tasks.push(task);
    return task;
  });
}

export async function updateCodeTaskStatus(
  taskId: string,
  nextStatus: CodeTaskStatus,
  options?: CodeCockpitStoreOptions,
): Promise<CodeTask> {
  const status = assertTaskStatus(nextStatus);
  return await mutateStore(options, (store, updatedAt) => {
    const task = findTask(store, taskId);
    assertTransition("task", TASK_TRANSITIONS, task.status, status);
    task.status = status;
    task.updatedAt = updatedAt;
    return task;
  });
}

export async function createCodeWorkerSession(
  input: CreateCodeWorkerSessionInput,
  options?: CodeCockpitStoreOptions,
): Promise<CodeWorkerSession> {
  if (!normalizeString(input.name)) {
    throw new Error("Worker name is required");
  }
  const status = assertWorkerStatus(input.status ?? "queued");
  const lane = assertWorkerLane(input.lane ?? "worker");
  const engineId = input.engineId ? assertWorkerEngineId(input.engineId) : "codex";
  const authHealth = input.authHealth
    ? assertWorkerAuthHealth(input.authHealth)
    : ("unknown" as const);
  return await mutateStore(options, (store, updatedAt) => {
    const task = findTask(store, input.taskId);
    const worker: CodeWorkerSession = {
      id: createId("worker"),
      taskId: task.id,
      name: normalizeString(input.name) ?? "worker",
      status,
      lane,
      repoRoot: normalizeString(input.repoRoot) ?? task.repoRoot,
      worktreePath: normalizeString(input.worktreePath),
      branch: normalizeString(input.branch),
      objective: normalizeString(input.objective),
      engineId,
      engineModel: normalizeString(input.engineModel),
      commandPath: normalizeString(input.commandPath),
      authHealth,
      createdAt: updatedAt,
      updatedAt,
    };
    store.workers.push(worker);
    if (!task.workerIds.includes(worker.id)) {
      task.workerIds.push(worker.id);
      task.updatedAt = updatedAt;
    }
    return worker;
  });
}

export async function updateCodeWorkerSessionStatus(
  workerId: string,
  nextStatus: CodeWorkerStatus,
  options?: CodeCockpitStoreOptions,
): Promise<CodeWorkerSession> {
  const status = assertWorkerStatus(nextStatus);
  return await mutateStore(options, (store, updatedAt) => {
    const worker = findWorker(store, workerId);
    assertTransition("worker", WORKER_TRANSITIONS, worker.status, status);
    worker.status = status;
    worker.updatedAt = updatedAt;
    return worker;
  });
}

export async function updateCodeWorkerSession(
  workerId: string,
  patch: UpdateCodeWorkerSessionInput,
  options?: CodeCockpitStoreOptions,
): Promise<CodeWorkerSession> {
  return await mutateStore(options, (store, updatedAt) => {
    const worker = findWorker(store, workerId);

    if (patch.status !== undefined) {
      const status = assertWorkerStatus(patch.status);
      assertTransition("worker", WORKER_TRANSITIONS, worker.status, status);
      worker.status = status;
    }
    if (patch.lane !== undefined) {
      worker.lane = assertWorkerLane(patch.lane);
    }
    const repoRoot = normalizePatchString(patch.repoRoot);
    if (repoRoot !== undefined) {
      worker.repoRoot = repoRoot ?? undefined;
    }
    const worktreePath = normalizePatchString(patch.worktreePath);
    if (worktreePath !== undefined) {
      worker.worktreePath = worktreePath ?? undefined;
    }
    const branch = normalizePatchString(patch.branch);
    if (branch !== undefined) {
      worker.branch = branch ?? undefined;
    }
    const objective = normalizePatchString(patch.objective);
    if (objective !== undefined) {
      worker.objective = objective ?? undefined;
    }
    if (patch.engineId !== undefined) {
      worker.engineId = patch.engineId ? assertWorkerEngineId(patch.engineId) : undefined;
    }
    const engineModel = normalizePatchString(patch.engineModel);
    if (engineModel !== undefined) {
      worker.engineModel = engineModel ?? undefined;
    }
    const backendId = normalizePatchString(patch.backendId);
    if (backendId !== undefined) {
      worker.backendId = backendId ?? undefined;
    }
    const commandPath = normalizePatchString(patch.commandPath);
    if (commandPath !== undefined) {
      worker.commandPath = commandPath ?? undefined;
    }
    if (patch.authHealth !== undefined) {
      worker.authHealth = patch.authHealth ? assertWorkerAuthHealth(patch.authHealth) : undefined;
    }
    const lastAuthCheckedAt = normalizePatchString(patch.lastAuthCheckedAt);
    if (lastAuthCheckedAt !== undefined) {
      worker.lastAuthCheckedAt = lastAuthCheckedAt ?? undefined;
    }
    const lastCommitHash = normalizePatchString(patch.lastCommitHash);
    if (lastCommitHash !== undefined) {
      worker.lastCommitHash = lastCommitHash ?? undefined;
    }
    const pushedBranch = normalizePatchString(patch.pushedBranch);
    if (pushedBranch !== undefined) {
      worker.pushedBranch = pushedBranch ?? undefined;
    }
    if (patch.pullRequestNumber !== undefined) {
      worker.pullRequestNumber =
        patch.pullRequestNumber === null ? undefined : patch.pullRequestNumber;
    }
    const pullRequestUrl = normalizePatchString(patch.pullRequestUrl);
    if (pullRequestUrl !== undefined) {
      worker.pullRequestUrl = pullRequestUrl ?? undefined;
    }
    if (patch.pullRequestState !== undefined) {
      worker.pullRequestState = patch.pullRequestState
        ? assertPullRequestState(patch.pullRequestState)
        : undefined;
    }
    const pullRequestError = normalizePatchString(patch.pullRequestError);
    if (pullRequestError !== undefined) {
      worker.pullRequestError = pullRequestError ?? undefined;
    }
    const scopeKey = normalizePatchString(patch.scopeKey);
    if (scopeKey !== undefined) {
      worker.scopeKey = scopeKey ?? undefined;
    }
    const activeRunId = normalizePatchString(patch.activeRunId);
    if (activeRunId !== undefined) {
      if (activeRunId) {
        findRun(store, activeRunId);
      }
      worker.activeRunId = activeRunId ?? undefined;
    }
    const threadId = normalizePatchString(patch.threadId);
    if (threadId !== undefined) {
      worker.threadId = threadId ?? undefined;
    }
    const lastStartedAt = normalizePatchString(patch.lastStartedAt);
    if (lastStartedAt !== undefined) {
      worker.lastStartedAt = lastStartedAt ?? undefined;
    }
    const lastExitedAt = normalizePatchString(patch.lastExitedAt);
    if (lastExitedAt !== undefined) {
      worker.lastExitedAt = lastExitedAt ?? undefined;
    }
    const lastExitReason = normalizePatchString(patch.lastExitReason);
    if (lastExitReason !== undefined) {
      worker.lastExitReason = lastExitReason ?? undefined;
    }
    worker.updatedAt = updatedAt;
    return worker;
  });
}

export async function createCodeReviewRequest(
  input: CreateCodeReviewRequestInput,
  options?: CodeCockpitStoreOptions,
): Promise<CodeReviewRequest> {
  if (!normalizeString(input.title)) {
    throw new Error("Review title is required");
  }
  const status = assertReviewStatus(input.status ?? "pending");
  return await mutateStore(options, (store, updatedAt) => {
    const task = findTask(store, input.taskId);
    if (input.workerId) {
      const worker = findWorker(store, input.workerId);
      if (worker.taskId !== task.id) {
        throw new Error(`Worker "${worker.id}" does not belong to task "${task.id}"`);
      }
    }
    const review: CodeReviewRequest = {
      id: createId("review"),
      taskId: task.id,
      workerId: normalizeString(input.workerId),
      title: normalizeString(input.title) ?? "Review request",
      status,
      summary: normalizeString(input.summary),
      notes: normalizeString(input.notes),
      createdAt: updatedAt,
      updatedAt,
    };
    store.reviews.push(review);
    if (!task.reviewIds.includes(review.id)) {
      task.reviewIds.push(review.id);
      task.updatedAt = updatedAt;
    }
    return review;
  });
}

export async function updateCodeReviewRequestStatus(
  reviewId: string,
  nextStatus: CodeReviewStatus,
  options?: CodeCockpitStoreOptions,
): Promise<CodeReviewRequest> {
  const status = assertReviewStatus(nextStatus);
  return await mutateStore(options, (store, updatedAt) => {
    const review = findReview(store, reviewId);
    assertTransition("review", REVIEW_TRANSITIONS, review.status, status);
    review.status = status;
    review.updatedAt = updatedAt;
    return review;
  });
}

export async function resolveCodeReviewRequestStatus(
  reviewId: string,
  nextStatus: CodeReviewStatus,
  options?: CodeCockpitStoreOptions,
): Promise<CodeResolvedReviewResult> {
  const status = assertReviewStatus(nextStatus);
  return await mutateStore(options, (store, updatedAt) => {
    const review = findReview(store, reviewId);
    assertTransition("review", REVIEW_TRANSITIONS, review.status, status);
    review.status = status;
    review.updatedAt = updatedAt;

    const task = findTask(store, review.taskId);
    const worker = review.workerId ? findWorker(store, review.workerId) : null;

    if (status === "approved") {
      assertTransition("task", TASK_TRANSITIONS, task.status, "done");
      task.status = "done";
      task.updatedAt = updatedAt;
      if (worker) {
        assertTransition("worker", WORKER_TRANSITIONS, worker.status, "completed");
        worker.status = "completed";
        worker.updatedAt = updatedAt;
      }
    } else if (status === "changes_requested") {
      if (task.status === "review") {
        assertTransition("task", TASK_TRANSITIONS, task.status, "in_progress");
        task.status = "in_progress";
        task.updatedAt = updatedAt;
      }
      if (worker) {
        assertTransition("worker", WORKER_TRANSITIONS, worker.status, "failed");
        worker.status = "failed";
        worker.updatedAt = updatedAt;
      }
    } else if (status === "dismissed") {
      assertTransition("task", TASK_TRANSITIONS, task.status, "cancelled");
      task.status = "cancelled";
      task.updatedAt = updatedAt;
    }

    return { review, task, worker };
  });
}

export async function appendCodeDecisionLog(
  input: AppendCodeDecisionLogInput,
  options?: CodeCockpitStoreOptions,
): Promise<CodeDecisionLog> {
  if (!normalizeString(input.kind)) {
    throw new Error("Decision kind is required");
  }
  if (!normalizeString(input.summary)) {
    throw new Error("Decision summary is required");
  }
  return await mutateStore(options, (store, updatedAt) => {
    if (input.taskId) {
      findTask(store, input.taskId);
    }
    if (input.workerId) {
      findWorker(store, input.workerId);
    }
    const decision: CodeDecisionLog = {
      id: createId("decision"),
      taskId: normalizeString(input.taskId),
      workerId: normalizeString(input.workerId),
      kind: normalizeString(input.kind) ?? "decision",
      summary: normalizeString(input.summary) ?? "",
      createdAt: updatedAt,
    };
    store.decisions.push(decision);
    return decision;
  });
}

export async function appendCodeContextSnapshot(
  input: AppendCodeContextSnapshotInput,
  options?: CodeCockpitStoreOptions,
): Promise<CodeContextSnapshot> {
  if (!normalizeString(input.title)) {
    throw new Error("Memory title is required");
  }
  if (!normalizeString(input.body)) {
    throw new Error("Memory body is required");
  }
  const kind = assertContextSnapshotKind(input.kind ?? "brief");
  return await mutateStore(options, (store, updatedAt) => {
    if (input.taskId) {
      findTask(store, input.taskId);
    }
    if (input.workerId) {
      findWorker(store, input.workerId);
    }
    const snapshot: CodeContextSnapshot = {
      id: createId("memory"),
      taskId: normalizeString(input.taskId),
      workerId: normalizeString(input.workerId),
      kind,
      title: normalizeString(input.title) ?? "Snapshot",
      body: input.body.trim(),
      createdAt: updatedAt,
    };
    store.contextSnapshots.push(snapshot);
    return snapshot;
  });
}

export async function createCodeRun(
  input: CreateCodeRunInput,
  options?: CodeCockpitStoreOptions,
): Promise<CodeRun> {
  const status = assertRunStatus(input.status ?? "queued");
  return await mutateStore(options, (store, updatedAt) => {
    if (input.taskId) {
      findTask(store, input.taskId);
    }
    if (input.workerId) {
      findWorker(store, input.workerId);
    }
    const run: CodeRun = {
      id: createId("run"),
      taskId: normalizeString(input.taskId),
      workerId: normalizeString(input.workerId),
      status,
      summary: normalizeString(input.summary),
      backendId: normalizeString(input.backendId),
      scopeKey: normalizeString(input.scopeKey),
      supervisorRunId: normalizeString(input.supervisorRunId),
      threadId: normalizeString(input.threadId),
      pid: typeof input.pid === "number" && Number.isFinite(input.pid) ? input.pid : undefined,
      startedAt: normalizeString(input.startedAt),
      finishedAt: normalizeString(input.finishedAt),
      terminationReason: normalizeString(input.terminationReason),
      exitCode: input.exitCode ?? undefined,
      exitSignal: input.exitSignal ?? undefined,
      stdoutTail: normalizeString(input.stdoutTail),
      stderrTail: normalizeString(input.stderrTail),
      stdoutLogPath: normalizeString(input.stdoutLogPath),
      stderrLogPath: normalizeString(input.stderrLogPath),
      createdAt: updatedAt,
      updatedAt,
    };
    store.runs.push(run);
    return run;
  });
}

export async function updateCodeRunStatus(
  runId: string,
  nextStatus: CodeRunStatus,
  options?: CodeCockpitStoreOptions,
): Promise<CodeRun> {
  const status = assertRunStatus(nextStatus);
  return await mutateStore(options, (store, updatedAt) => {
    const run = findRun(store, runId);
    assertTransition("run", RUN_TRANSITIONS, run.status, status);
    run.status = status;
    run.updatedAt = updatedAt;
    return run;
  });
}

export async function updateCodeRun(
  runId: string,
  patch: UpdateCodeRunInput,
  options?: CodeCockpitStoreOptions,
): Promise<CodeRun> {
  return await mutateStore(options, (store, updatedAt) => {
    const run = findRun(store, runId);
    if (patch.status !== undefined) {
      const status = assertRunStatus(patch.status);
      assertTransition("run", RUN_TRANSITIONS, run.status, status);
      run.status = status;
    }
    const summary = normalizePatchString(patch.summary);
    if (summary !== undefined) {
      run.summary = summary ?? undefined;
    }
    const backendId = normalizePatchString(patch.backendId);
    if (backendId !== undefined) {
      run.backendId = backendId ?? undefined;
    }
    const scopeKey = normalizePatchString(patch.scopeKey);
    if (scopeKey !== undefined) {
      run.scopeKey = scopeKey ?? undefined;
    }
    const supervisorRunId = normalizePatchString(patch.supervisorRunId);
    if (supervisorRunId !== undefined) {
      run.supervisorRunId = supervisorRunId ?? undefined;
    }
    const threadId = normalizePatchString(patch.threadId);
    if (threadId !== undefined) {
      run.threadId = threadId ?? undefined;
    }
    if (patch.pid !== undefined) {
      run.pid = patch.pid ?? undefined;
    }
    const startedAt = normalizePatchString(patch.startedAt);
    if (startedAt !== undefined) {
      run.startedAt = startedAt ?? undefined;
    }
    const finishedAt = normalizePatchString(patch.finishedAt);
    if (finishedAt !== undefined) {
      run.finishedAt = finishedAt ?? undefined;
    }
    const terminationReason = normalizePatchString(patch.terminationReason);
    if (terminationReason !== undefined) {
      run.terminationReason = terminationReason ?? undefined;
    }
    if (patch.exitCode !== undefined) {
      run.exitCode = patch.exitCode;
    }
    if (patch.exitSignal !== undefined) {
      run.exitSignal = patch.exitSignal;
    }
    const stdoutTail = normalizePatchString(patch.stdoutTail);
    if (stdoutTail !== undefined) {
      run.stdoutTail = stdoutTail ?? undefined;
    }
    const stderrTail = normalizePatchString(patch.stderrTail);
    if (stderrTail !== undefined) {
      run.stderrTail = stderrTail ?? undefined;
    }
    const stdoutLogPath = normalizePatchString(patch.stdoutLogPath);
    if (stdoutLogPath !== undefined) {
      run.stdoutLogPath = stdoutLogPath ?? undefined;
    }
    const stderrLogPath = normalizePatchString(patch.stderrLogPath);
    if (stderrLogPath !== undefined) {
      run.stderrLogPath = stderrLogPath ?? undefined;
    }
    run.updatedAt = updatedAt;
    return run;
  });
}

export async function getCodeTask(
  taskId: string,
  options?: CodeCockpitStoreOptions,
): Promise<CodeTask> {
  const store = await loadCodeCockpitStore(options);
  return findTask(store, taskId);
}

export async function getCodeWorkerSession(
  workerId: string,
  options?: CodeCockpitStoreOptions,
): Promise<CodeWorkerSession> {
  const store = await loadCodeCockpitStore(options);
  return findWorker(store, workerId);
}

export async function getCodeRun(
  runId: string,
  options?: CodeCockpitStoreOptions,
): Promise<CodeRun> {
  const store = await loadCodeCockpitStore(options);
  return findRun(store, runId);
}

export async function getCodeCockpitSummary(
  options?: CodeCockpitStoreOptions,
): Promise<CodeCockpitSummary> {
  const store = await loadCodeCockpitStore(options);

  return {
    storePath: resolveCodeCockpitStorePath(options),
    totals: {
      tasks: store.tasks.length,
      workers: store.workers.length,
      reviews: store.reviews.length,
      decisions: store.decisions.length,
      contextSnapshots: store.contextSnapshots.length,
      runs: store.runs.length,
    },
    taskStatusCounts: buildCounts(
      CODE_TASK_STATUSES,
      store.tasks.map((entry) => entry.status),
    ),
    workerStatusCounts: buildCounts(
      CODE_WORKER_STATUSES,
      store.workers.map((entry) => entry.status),
    ),
    reviewStatusCounts: buildCounts(
      CODE_REVIEW_STATUSES,
      store.reviews.map((entry) => entry.status),
    ),
    recentTasks: sortByUpdatedAt(store.tasks).slice(0, 5),
    recentWorkers: sortByUpdatedAt(store.workers).slice(0, 5),
    pendingReviews: sortByUpdatedAt(store.reviews)
      .filter((entry) => entry.status === "pending")
      .slice(0, 5),
  };
}

export async function getCodeCockpitWorkspaceSummary(
  options?: CodeCockpitStoreOptions,
): Promise<CodeCockpitWorkspaceSummary> {
  const store = await loadCodeCockpitStore(options);
  const baseSummary = await getCodeCockpitSummary(options);
  const taskById = new Map(store.tasks.map((task) => [task.id, task]));
  const latestRunByWorker = new Map<string, CodeRun>();
  for (const run of sortByUpdatedAt(store.runs)) {
    if (run.workerId && !latestRunByWorker.has(run.workerId)) {
      latestRunByWorker.set(run.workerId, run);
    }
  }
  const pendingReviewByWorker = new Map<string, CodeReviewRequest>();
  for (const review of sortByUpdatedAt(store.reviews)) {
    if (
      review.workerId &&
      review.status === "pending" &&
      !pendingReviewByWorker.has(review.workerId)
    ) {
      pendingReviewByWorker.set(review.workerId, review);
    }
  }

  function toLaneSummary(worker: CodeWorkerSession): CodeCockpitLaneSummary | null {
    const task = taskById.get(worker.taskId);
    if (!task) {
      return null;
    }
    return {
      taskId: task.id,
      taskTitle: task.title,
      workerId: worker.id,
      workerName: worker.name,
      lane: worker.lane,
      status: worker.status,
      repoRoot: worker.repoRoot ?? task.repoRoot,
      worktreePath: worker.worktreePath,
      branch: worker.branch,
      objective: worker.objective,
      backendId: worker.backendId,
      activeRunId: worker.activeRunId,
      updatedAt: worker.updatedAt,
      latestRun: latestRunByWorker.get(worker.id) ?? null,
      pendingReview: pendingReviewByWorker.get(worker.id) ?? null,
    };
  }

  const ACTIVE_STATUSES: ReadonlySet<CodeWorkerStatus> = new Set(["queued", "running"]);
  const NEEDS_INPUT_STATUSES: ReadonlySet<CodeWorkerStatus> = new Set([
    "awaiting_review",
    "awaiting_approval",
    "paused",
  ]);
  const COMPLETED_STATUSES: ReadonlySet<CodeWorkerStatus> = new Set([
    "completed",
    "failed",
    "cancelled",
  ]);

  const sortedWorkers = sortByUpdatedAt(store.workers);

  const activeLanes = sortedWorkers
    .filter((w) => ACTIVE_STATUSES.has(w.status))
    .slice(0, 6)
    .flatMap((w) => {
      const lane = toLaneSummary(w);
      return lane ? [lane] : [];
    });

  const needsInputLanes = sortedWorkers
    .filter(
      (w) =>
        NEEDS_INPUT_STATUSES.has(w.status) ||
        (ACTIVE_STATUSES.has(w.status) && taskById.get(w.taskId)?.status === "blocked"),
    )
    .slice(0, 6)
    .flatMap((w) => {
      const lane = toLaneSummary(w);
      return lane ? [lane] : [];
    });

  const blockedLanes = sortedWorkers
    .filter((w) => {
      const task = taskById.get(w.taskId);
      return task?.status === "blocked" && !COMPLETED_STATUSES.has(w.status);
    })
    .slice(0, 6)
    .flatMap((w) => {
      const lane = toLaneSummary(w);
      return lane ? [lane] : [];
    });

  const completedLanes = sortedWorkers
    .filter((w) => COMPLETED_STATUSES.has(w.status))
    .slice(0, 6)
    .flatMap((w) => {
      const lane = toLaneSummary(w);
      return lane ? [lane] : [];
    });

  return {
    ...baseSummary,
    generatedAt: nowIso(options),
    recentRuns: sortByUpdatedAt(store.runs).slice(0, 8),
    activeLanes,
    completedLanes,
    blockedLanes,
    needsInputLanes,
  };
}
