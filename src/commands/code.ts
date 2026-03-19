import path from "node:path";
import type {
  CodeCockpitStoreOptions,
  CodeContextSnapshot,
  CodeDecisionLog,
  CodeRun,
  CodeReviewRequest,
  CodeTask,
  CodeTaskPriority,
  CodeTaskStatus,
  CodeWorkerEngineId,
  CodeWorkerLane,
  CodeWorkerSession,
  CodeWorkerStatus,
  CodeReviewStatus,
} from "../code-cockpit/store.js";
import {
  appendCodeContextSnapshot,
  appendCodeDecisionLog,
  CODE_CONTEXT_SNAPSHOT_KINDS,
  CODE_REVIEW_STATUSES,
  CODE_TASK_PRIORITIES,
  CODE_TASK_STATUSES,
  CODE_WORKER_ENGINE_IDS,
  CODE_WORKER_LANES,
  CODE_WORKER_STATUSES,
  createCodeReviewRequest,
  createCodeTask,
  createCodeWorkerSession,
  getCodeCockpitSummary,
  loadCodeCockpitStore,
  resolveCodeCockpitStorePath,
  updateCodeReviewRequestStatus,
  updateCodeTaskStatus,
  updateCodeWorkerSessionStatus,
} from "../code-cockpit/store.js";
import { callGateway } from "../gateway/call.js";
import type { RuntimeEnv } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";
import { resolveUserPath, shortenHomePath } from "../utils.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";

export type CodeSummaryOptions = {
  json?: boolean;
};

export type CodeTaskAddOptions = {
  repo?: string;
  goal?: string;
  notes?: string;
  priority?: string;
  status?: string;
  json?: boolean;
};

export type CodeTaskListOptions = {
  status?: string;
  repo?: string;
  json?: boolean;
};

export type CodeTaskShowOptions = {
  json?: boolean;
};

export type CodeTaskStatusOptions = {
  json?: boolean;
};

export type CodeWorkerAddOptions = {
  task?: string;
  name?: string;
  repo?: string;
  worktree?: string;
  branch?: string;
  objective?: string;
  engine?: string;
  model?: string;
  lane?: string;
  status?: string;
  json?: boolean;
};

export type CodeWorkerListOptions = {
  task?: string;
  status?: string;
  json?: boolean;
};

export type CodeWorkerStatusOptions = {
  json?: boolean;
};

export type CodeWorkerStartOptions = {
  json?: boolean;
};

export type CodeWorkerSendOptions = {
  message?: string;
  json?: boolean;
};

export type CodeWorkerResumeOptions = {
  message?: string;
  json?: boolean;
};

export type CodeWorkerControlOptions = {
  json?: boolean;
};

export type CodeSupervisorTickOptions = {
  repo?: string;
  json?: boolean;
};

export type CodeReviewAddOptions = {
  task?: string;
  worker?: string;
  summary?: string;
  notes?: string;
  status?: string;
  json?: boolean;
};

export type CodeReviewListOptions = {
  task?: string;
  worker?: string;
  status?: string;
  json?: boolean;
};

export type CodeReviewStatusOptions = {
  json?: boolean;
};

export type CodeMemoryAddOptions = {
  task?: string;
  worker?: string;
  kind?: string;
  title?: string;
  body?: string;
  json?: boolean;
};

export type CodeMemoryListOptions = {
  task?: string;
  worker?: string;
  kind?: string;
  json?: boolean;
};

export type CodeDecisionAddOptions = {
  task?: string;
  worker?: string;
  kind?: string;
  summary?: string;
  json?: boolean;
};

export type CodeDecisionListOptions = {
  task?: string;
  worker?: string;
  kind?: string;
  json?: boolean;
};

type CodeListStore = Awaited<ReturnType<typeof loadCodeCockpitStore>>;

function resolveCodePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return path.resolve(resolveUserPath(trimmed));
}

function emitJson<T>(runtime: RuntimeEnv, payload: T): void {
  runtime.log(JSON.stringify(payload, null, 2));
}

function emitEntity<T>(runtime: RuntimeEnv, json: boolean | undefined, entity: T, lines: string[]) {
  if (json) {
    emitJson(runtime, entity);
    return;
  }
  for (const line of lines) {
    runtime.log(line);
  }
}

function describeTask(task: CodeTask): string {
  const priority = task.priority === "normal" ? "" : ` priority=${task.priority}`;
  const repoRoot = task.repoRoot ? ` repo=${shortenHomePath(task.repoRoot)}` : "";
  return `${task.id} [${task.status}] ${task.title}${priority}${repoRoot}`;
}

function describeWorker(worker: CodeWorkerSession): string {
  const branch = worker.branch ? ` branch=${worker.branch}` : "";
  const lane = worker.lane === "worker" ? "" : ` lane=${worker.lane}`;
  const engine =
    worker.engineId || worker.engineModel
      ? ` engine=${[worker.engineId, worker.engineModel].filter(Boolean).join("/")}`
      : "";
  const worktreePath = worker.worktreePath
    ? ` worktree=${shortenHomePath(worker.worktreePath)}`
    : "";
  return `${worker.id} [${worker.status}] ${worker.name} task=${worker.taskId}${engine}${lane}${branch}${worktreePath}`;
}

function describeReview(review: CodeReviewRequest): string {
  const workerId = review.workerId ? ` worker=${review.workerId}` : "";
  return `${review.id} [${review.status}] ${review.title} task=${review.taskId}${workerId}`;
}

function describeRun(run: Partial<CodeRun> & { id?: string; status?: string }): string {
  const pid = typeof run.pid === "number" ? ` pid=${run.pid}` : "";
  const supervisorRunId = run.supervisorRunId ? ` supervisor=${run.supervisorRunId}` : "";
  const termination = run.terminationReason ? ` termination=${run.terminationReason}` : "";
  return `${run.id ?? "run"} [${run.status ?? "unknown"}]${pid}${supervisorRunId}${termination}`;
}

function describeSnapshot(snapshot: CodeContextSnapshot): string {
  const workerId = snapshot.workerId ? ` worker=${snapshot.workerId}` : "";
  const taskId = snapshot.taskId ? ` task=${snapshot.taskId}` : "";
  return `${snapshot.id} [${snapshot.kind}] ${snapshot.title}${taskId}${workerId}`;
}

function describeDecision(decision: CodeDecisionLog): string {
  const workerId = decision.workerId ? ` worker=${decision.workerId}` : "";
  const taskId = decision.taskId ? ` task=${decision.taskId}` : "";
  return `${decision.id} [${decision.kind}]${taskId}${workerId} ${decision.summary}`;
}

function formatCounts<T extends Record<string, number>>(counts: T): string {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function ensureWorkerEngineId(value: string | undefined): CodeWorkerEngineId | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if ((CODE_WORKER_ENGINE_IDS as readonly string[]).includes(normalized)) {
    return normalized as CodeWorkerEngineId;
  }
  throw new Error(
    `Invalid worker engine "${value}". Expected one of: ${CODE_WORKER_ENGINE_IDS.join(", ")}`,
  );
}

function printSection(runtime: RuntimeEnv, heading: string, items: string[]): void {
  runtime.log(isRich() ? theme.heading(heading) : heading);
  if (items.length === 0) {
    runtime.log(theme.muted("  none"));
    return;
  }
  for (const item of items) {
    runtime.log(`  ${item}`);
  }
}

function filterTasks(store: CodeListStore, opts: CodeTaskListOptions): CodeTask[] {
  return [...store.tasks]
    .filter((task) => (opts.status ? task.status === opts.status : true))
    .filter((task) => (opts.repo ? task.repoRoot === resolveCodePath(opts.repo) : true))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function filterWorkers(store: CodeListStore, opts: CodeWorkerListOptions): CodeWorkerSession[] {
  return [...store.workers]
    .filter((worker) => (opts.task ? worker.taskId === opts.task : true))
    .filter((worker) => (opts.status ? worker.status === opts.status : true))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function filterReviews(store: CodeListStore, opts: CodeReviewListOptions): CodeReviewRequest[] {
  return [...store.reviews]
    .filter((review) => (opts.task ? review.taskId === opts.task : true))
    .filter((review) => (opts.worker ? review.workerId === opts.worker : true))
    .filter((review) => (opts.status ? review.status === opts.status : true))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function filterSnapshots(store: CodeListStore, opts: CodeMemoryListOptions): CodeContextSnapshot[] {
  return [...store.contextSnapshots]
    .filter((snapshot) => (opts.task ? snapshot.taskId === opts.task : true))
    .filter((snapshot) => (opts.worker ? snapshot.workerId === opts.worker : true))
    .filter((snapshot) => (opts.kind ? snapshot.kind === opts.kind : true))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function filterDecisions(store: CodeListStore, opts: CodeDecisionListOptions): CodeDecisionLog[] {
  return [...store.decisions]
    .filter((decision) => (opts.task ? decision.taskId === opts.task : true))
    .filter((decision) => (opts.worker ? decision.workerId === opts.worker : true))
    .filter((decision) => (opts.kind ? decision.kind === opts.kind : true))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function ensureTaskStatus(value: string | undefined): CodeTaskStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if ((CODE_TASK_STATUSES as readonly string[]).includes(value)) {
    return value as CodeTaskStatus;
  }
  throw new Error(
    `Invalid task status "${value}". Expected one of: ${CODE_TASK_STATUSES.join(", ")}`,
  );
}

function ensureTaskPriority(value: string | undefined): CodeTaskPriority | undefined {
  if (value === undefined) {
    return undefined;
  }
  if ((CODE_TASK_PRIORITIES as readonly string[]).includes(value)) {
    return value as CodeTaskPriority;
  }
  throw new Error(
    `Invalid task priority "${value}". Expected one of: ${CODE_TASK_PRIORITIES.join(", ")}`,
  );
}

function ensureWorkerStatus(value: string | undefined): CodeWorkerStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if ((CODE_WORKER_STATUSES as readonly string[]).includes(value)) {
    return value as CodeWorkerStatus;
  }
  throw new Error(
    `Invalid worker status "${value}". Expected one of: ${CODE_WORKER_STATUSES.join(", ")}`,
  );
}

function ensureWorkerLane(value: string | undefined): CodeWorkerLane | undefined {
  if (value === undefined) {
    return undefined;
  }
  if ((CODE_WORKER_LANES as readonly string[]).includes(value)) {
    return value as CodeWorkerLane;
  }
  throw new Error(
    `Invalid worker lane "${value}". Expected one of: ${CODE_WORKER_LANES.join(", ")}`,
  );
}

function ensureReviewStatus(value: string | undefined): CodeReviewStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if ((CODE_REVIEW_STATUSES as readonly string[]).includes(value)) {
    return value as CodeReviewStatus;
  }
  throw new Error(
    `Invalid review status "${value}". Expected one of: ${CODE_REVIEW_STATUSES.join(", ")}`,
  );
}

function buildStoreOptions(): CodeCockpitStoreOptions {
  return {};
}

async function callCodeGateway<T>(method: string, params: Record<string, unknown>): Promise<T> {
  return await callGateway<T>({
    method,
    params,
    clientName: GATEWAY_CLIENT_NAMES.CLI,
    mode: GATEWAY_CLIENT_MODES.CLI,
  });
}

export async function codeSummaryCommand(
  opts: CodeSummaryOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const summary = await getCodeCockpitSummary(buildStoreOptions());
  if (opts.json) {
    emitJson(runtime, summary);
    return;
  }

  runtime.log(isRich() ? theme.heading("Coding Cockpit") : "Coding Cockpit");
  runtime.log(`Store: ${shortenHomePath(summary.storePath)}`);
  runtime.log(
    `Tasks: ${summary.totals.tasks} (${formatCounts(summary.taskStatusCounts) || "none"})`,
  );
  runtime.log(
    `Workers: ${summary.totals.workers} (${formatCounts(summary.workerStatusCounts) || "none"})`,
  );
  runtime.log(
    `Reviews: ${summary.totals.reviews} (${formatCounts(summary.reviewStatusCounts) || "none"})`,
  );
  runtime.log(
    `Memory: ${summary.totals.contextSnapshots} snapshots, ${summary.totals.decisions} decisions, ${summary.totals.runs} runs`,
  );
  printSection(runtime, "Recent Tasks", summary.recentTasks.map(describeTask));
  printSection(runtime, "Recent Workers", summary.recentWorkers.map(describeWorker));
  printSection(runtime, "Pending Reviews", summary.pendingReviews.map(describeReview));
}

export async function codeTaskAddCommand(
  title: string,
  opts: CodeTaskAddOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const task = await createCodeTask(
    {
      title,
      repoRoot: resolveCodePath(opts.repo),
      goal: opts.goal,
      notes: opts.notes,
      priority: ensureTaskPriority(opts.priority),
      status: ensureTaskStatus(opts.status),
    },
    buildStoreOptions(),
  );
  emitEntity(runtime, opts.json, task, [`Created task ${describeTask(task)}`]);
}

export async function codeTaskListCommand(
  opts: CodeTaskListOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  ensureTaskStatus(opts.status);
  const store = await loadCodeCockpitStore(buildStoreOptions());
  const tasks = filterTasks(store, opts);
  const storePath = resolveCodeCockpitStorePath(buildStoreOptions());
  if (opts.json) {
    emitJson(runtime, { storePath, tasks });
    return;
  }
  runtime.log(`Store: ${shortenHomePath(storePath)}`);
  printSection(runtime, "Tasks", tasks.map(describeTask));
}

export async function codeTaskShowCommand(
  taskId: string,
  opts: CodeTaskShowOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const store = await loadCodeCockpitStore(buildStoreOptions());
  const task = store.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`Task "${taskId}" not found`);
  }
  const workers = store.workers.filter((entry) => entry.taskId === taskId);
  const reviews = store.reviews.filter((entry) => entry.taskId === taskId);
  const payload = {
    storePath: resolveCodeCockpitStorePath(buildStoreOptions()),
    task,
    workers,
    reviews,
  };
  if (opts.json) {
    emitJson(runtime, payload);
    return;
  }
  runtime.log(describeTask(task));
  if (task.goal) {
    runtime.log(`  goal: ${task.goal}`);
  }
  if (task.notes) {
    runtime.log(`  notes: ${task.notes}`);
  }
  printSection(runtime, "Workers", workers.map(describeWorker));
  printSection(runtime, "Reviews", reviews.map(describeReview));
}

export async function codeTaskStatusCommand(
  taskId: string,
  status: string,
  opts: CodeTaskStatusOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const updated = await updateCodeTaskStatus(
    taskId,
    ensureTaskStatus(status) ?? "queued",
    buildStoreOptions(),
  );
  emitEntity(runtime, opts.json, updated, [`Updated task ${describeTask(updated)}`]);
}

export async function codeWorkerAddCommand(
  opts: CodeWorkerAddOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  if (!opts.task) {
    throw new Error("--task is required");
  }
  if (!opts.name) {
    throw new Error("--name is required");
  }
  const worker = await createCodeWorkerSession(
    {
      taskId: opts.task,
      name: opts.name,
      status: ensureWorkerStatus(opts.status),
      lane: ensureWorkerLane(opts.lane),
      repoRoot: resolveCodePath(opts.repo),
      worktreePath: resolveCodePath(opts.worktree),
      branch: opts.branch,
      objective: opts.objective,
      engineId: ensureWorkerEngineId(opts.engine),
      engineModel: opts.model?.trim() || undefined,
    },
    buildStoreOptions(),
  );
  emitEntity(runtime, opts.json, worker, [`Created worker ${describeWorker(worker)}`]);
}

export async function codeWorkerListCommand(
  opts: CodeWorkerListOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  ensureWorkerStatus(opts.status);
  const store = await loadCodeCockpitStore(buildStoreOptions());
  const workers = filterWorkers(store, opts);
  const storePath = resolveCodeCockpitStorePath(buildStoreOptions());
  if (opts.json) {
    emitJson(runtime, { storePath, workers });
    return;
  }
  runtime.log(`Store: ${shortenHomePath(storePath)}`);
  printSection(runtime, "Workers", workers.map(describeWorker));
}

export async function codeWorkerStatusCommand(
  workerId: string,
  status: string,
  opts: CodeWorkerStatusOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const worker = await updateCodeWorkerSessionStatus(
    workerId,
    ensureWorkerStatus(status) ?? "queued",
    buildStoreOptions(),
  );
  emitEntity(runtime, opts.json, worker, [`Updated worker ${describeWorker(worker)}`]);
}

export async function codeWorkerStartCommand(
  workerId: string,
  opts: CodeWorkerStartOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const payload = await callCodeGateway<{
    worker: CodeWorkerSession;
    run: CodeRun;
  }>("code.worker.start", { workerId });
  emitEntity(runtime, opts.json, payload, [
    `Started worker ${describeWorker(payload.worker)}`,
    `Run ${describeRun(payload.run)}`,
  ]);
}

export async function codeWorkerSendCommand(
  workerId: string,
  opts: CodeWorkerSendOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const message = opts.message?.trim();
  if (!message) {
    throw new Error("--message is required");
  }
  const payload = await callCodeGateway<{
    worker: CodeWorkerSession;
    run: CodeRun;
  }>("code.worker.send", { workerId, message });
  emitEntity(runtime, opts.json, payload, [
    `Sent worker turn ${describeWorker(payload.worker)}`,
    `Run ${describeRun(payload.run)}`,
  ]);
}

export async function codeWorkerPauseCommand(
  workerId: string,
  opts: CodeWorkerControlOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const payload = await callCodeGateway<{
    worker: CodeWorkerSession;
    run: CodeRun;
  }>("code.worker.pause", { workerId });
  emitEntity(runtime, opts.json, payload, [
    `Paused worker ${describeWorker(payload.worker)}`,
    `Run ${describeRun(payload.run)}`,
  ]);
}

export async function codeWorkerResumeCommand(
  workerId: string,
  opts: CodeWorkerResumeOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const payload = await callCodeGateway<{
    worker: CodeWorkerSession;
    run: CodeRun;
  }>("code.worker.resume", {
    workerId,
    ...(opts.message?.trim() ? { message: opts.message.trim() } : {}),
  });
  emitEntity(runtime, opts.json, payload, [
    `Resumed worker ${describeWorker(payload.worker)}`,
    `Run ${describeRun(payload.run)}`,
  ]);
}

export async function codeWorkerCancelCommand(
  workerId: string,
  opts: CodeWorkerControlOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const payload = await callCodeGateway<{
    worker: CodeWorkerSession;
    run: CodeRun;
  }>("code.worker.cancel", { workerId });
  emitEntity(runtime, opts.json, payload, [
    `Cancelled worker ${describeWorker(payload.worker)}`,
    `Run ${describeRun(payload.run)}`,
  ]);
}

export async function codeWorkerShowCommand(
  workerId: string,
  opts: CodeWorkerControlOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const payload = await callCodeGateway<{
    storePath: string;
    task: CodeTask;
    worker: CodeWorkerSession;
    runs: CodeRun[];
    reviews: CodeReviewRequest[];
  }>("code.worker.show", { workerId });
  if (opts.json) {
    emitJson(runtime, payload);
    return;
  }
  runtime.log(`Store: ${shortenHomePath(payload.storePath)}`);
  runtime.log(describeWorker(payload.worker));
  runtime.log(`  task: ${describeTask(payload.task)}`);
  printSection(runtime, "Runs", payload.runs.map(describeRun));
  printSection(runtime, "Reviews", payload.reviews.map(describeReview));
}

export async function codeWorkerLogsCommand(
  workerId: string,
  opts: CodeWorkerControlOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const payload = await callCodeGateway<{
    workerId: string;
    latestRun: CodeRun | null;
    stdoutTail: string;
    stderrTail: string;
  }>("code.worker.logs", { workerId });
  if (opts.json) {
    emitJson(runtime, payload);
    return;
  }
  runtime.log(`Worker: ${payload.workerId}`);
  if (payload.latestRun) {
    runtime.log(`Latest run: ${describeRun(payload.latestRun)}`);
  }
  runtime.log("stdout:");
  runtime.log(payload.stdoutTail || "  <empty>");
  runtime.log("stderr:");
  runtime.log(payload.stderrTail || "  <empty>");
}

export async function codeSupervisorTickCommand(
  opts: CodeSupervisorTickOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const repoRoot = resolveCodePath(opts.repo);
  const payload = await callCodeGateway<{
    action: "noop" | "started" | "resumed";
    reason?: string;
    task?: CodeTask;
    worker?: CodeWorkerSession;
    run?: CodeRun;
  }>("code.supervisor.tick", repoRoot ? { repoRoot } : {});
  if (opts.json) {
    emitJson(runtime, payload);
    return;
  }
  runtime.log(`Supervisor action: ${payload.action}`);
  if (payload.reason) {
    runtime.log(`Reason: ${payload.reason}`);
  }
  if (payload.task) {
    runtime.log(`Task: ${describeTask(payload.task)}`);
  }
  if (payload.worker) {
    runtime.log(`Worker: ${describeWorker(payload.worker)}`);
  }
  if (payload.run) {
    runtime.log(`Run: ${describeRun(payload.run)}`);
  }
}

export async function codeReviewAddCommand(
  title: string,
  opts: CodeReviewAddOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  if (!opts.task) {
    throw new Error("--task is required");
  }
  const review = await createCodeReviewRequest(
    {
      taskId: opts.task,
      workerId: opts.worker,
      title,
      summary: opts.summary,
      notes: opts.notes,
      status: ensureReviewStatus(opts.status),
    },
    buildStoreOptions(),
  );
  emitEntity(runtime, opts.json, review, [`Created review ${describeReview(review)}`]);
}

export async function codeReviewListCommand(
  opts: CodeReviewListOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  ensureReviewStatus(opts.status);
  const store = await loadCodeCockpitStore(buildStoreOptions());
  const reviews = filterReviews(store, opts);
  const storePath = resolveCodeCockpitStorePath(buildStoreOptions());
  if (opts.json) {
    emitJson(runtime, { storePath, reviews });
    return;
  }
  runtime.log(`Store: ${shortenHomePath(storePath)}`);
  printSection(runtime, "Reviews", reviews.map(describeReview));
}

export async function codeReviewStatusCommand(
  reviewId: string,
  status: string,
  opts: CodeReviewStatusOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const review = await updateCodeReviewRequestStatus(
    reviewId,
    ensureReviewStatus(status) ?? "pending",
    buildStoreOptions(),
  );
  emitEntity(runtime, opts.json, review, [`Updated review ${describeReview(review)}`]);
}

export async function codeMemoryAddCommand(
  opts: CodeMemoryAddOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  if (!opts.title) {
    throw new Error("--title is required");
  }
  if (!opts.body) {
    throw new Error("--body is required");
  }
  if (opts.kind && !(CODE_CONTEXT_SNAPSHOT_KINDS as readonly string[]).includes(opts.kind)) {
    throw new Error(
      `Invalid memory kind "${opts.kind}". Expected one of: ${CODE_CONTEXT_SNAPSHOT_KINDS.join(", ")}`,
    );
  }
  const snapshot = await appendCodeContextSnapshot(
    {
      taskId: opts.task,
      workerId: opts.worker,
      kind: opts.kind as (typeof CODE_CONTEXT_SNAPSHOT_KINDS)[number] | undefined,
      title: opts.title,
      body: opts.body,
    },
    buildStoreOptions(),
  );
  emitEntity(runtime, opts.json, snapshot, [`Captured memory ${describeSnapshot(snapshot)}`]);
}

export async function codeMemoryListCommand(
  opts: CodeMemoryListOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  if (opts.kind && !(CODE_CONTEXT_SNAPSHOT_KINDS as readonly string[]).includes(opts.kind)) {
    throw new Error(
      `Invalid memory kind "${opts.kind}". Expected one of: ${CODE_CONTEXT_SNAPSHOT_KINDS.join(", ")}`,
    );
  }
  const store = await loadCodeCockpitStore(buildStoreOptions());
  const snapshots = filterSnapshots(store, opts);
  const storePath = resolveCodeCockpitStorePath(buildStoreOptions());
  if (opts.json) {
    emitJson(runtime, { storePath, snapshots });
    return;
  }
  runtime.log(`Store: ${shortenHomePath(storePath)}`);
  printSection(runtime, "Memory", snapshots.map(describeSnapshot));
}

export async function codeDecisionAddCommand(
  opts: CodeDecisionAddOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  if (!opts.kind) {
    throw new Error("--kind is required");
  }
  if (!opts.summary) {
    throw new Error("--summary is required");
  }
  const decision = await appendCodeDecisionLog(
    {
      taskId: opts.task,
      workerId: opts.worker,
      kind: opts.kind,
      summary: opts.summary,
    },
    buildStoreOptions(),
  );
  emitEntity(runtime, opts.json, decision, [`Logged decision ${describeDecision(decision)}`]);
}

export async function codeDecisionListCommand(
  opts: CodeDecisionListOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const store = await loadCodeCockpitStore(buildStoreOptions());
  const decisions = filterDecisions(store, opts);
  const storePath = resolveCodeCockpitStorePath(buildStoreOptions());
  if (opts.json) {
    emitJson(runtime, { storePath, decisions });
    return;
  }
  runtime.log(`Store: ${shortenHomePath(storePath)}`);
  printSection(runtime, "Decisions", decisions.map(describeDecision));
}
