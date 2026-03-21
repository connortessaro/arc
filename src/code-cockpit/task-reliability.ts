export const CODE_TASK_FAILURE_CLASSES = [
  "transient-runtime",
  "engine-auth",
  "engine-capacity",
  "task-error",
  "operator-needed",
] as const;

export type CodeTaskFailureClass = (typeof CODE_TASK_FAILURE_CLASSES)[number];

export const TASK_AUTO_RETRY_BUDGET = 1;
export const TASK_AUTO_RETRY_BACKOFF_MS = 15 * 60_000;

type TaskReliabilityState = {
  status?: string | null;
  lastFailureClass?: string | null;
  autoRetryCount?: number | null;
  retryAfter?: string | null;
};

type ResolveTaskFailureParams = {
  terminationReason?: string | null;
  authHealth?: string | null;
  summary?: string | null;
  stderr?: string | null;
  engineSelectionReason?: string | null;
  priorAutoRetryCount?: number | null;
  now?: Date;
};

export type ResolvedTaskFailure = {
  failureClass: CodeTaskFailureClass;
  shouldAutoRetry: boolean;
  autoRetryCount: number;
  retryAfter?: string;
  operatorHint: string;
};

const TRANSIENT_FAILURE_REASONS = new Set(["no-output-timeout", "overall-timeout", "spawn-error"]);

export function normalizeTaskFailureClass(
  value: string | null | undefined,
): CodeTaskFailureClass | undefined {
  if (!value) {
    return undefined;
  }
  return (CODE_TASK_FAILURE_CLASSES as readonly string[]).includes(value)
    ? (value as CodeTaskFailureClass)
    : undefined;
}

function clampAutoRetryCount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function hasRetryBackoffSignal(task: TaskReliabilityState): boolean {
  return clampAutoRetryCount(task.autoRetryCount) > 0 && Boolean(task.retryAfter);
}

export function isTaskInRetryBackoff(task: TaskReliabilityState, now: Date = new Date()): boolean {
  if (task.status === "done" || task.status === "cancelled") {
    return false;
  }
  if (!hasRetryBackoffSignal(task)) {
    return false;
  }
  const retryAfterMs = Date.parse(task.retryAfter ?? "");
  if (!Number.isFinite(retryAfterMs)) {
    return false;
  }
  return retryAfterMs > now.getTime();
}

export function summarizeBlockedTaskFailureCounts(
  tasks: readonly TaskReliabilityState[],
): Record<CodeTaskFailureClass, number> {
  const counts = Object.fromEntries(CODE_TASK_FAILURE_CLASSES.map((value) => [value, 0])) as Record<
    CodeTaskFailureClass,
    number
  >;
  for (const task of tasks) {
    if (task.status !== "blocked") {
      continue;
    }
    const failureClass = normalizeTaskFailureClass(task.lastFailureClass) ?? "operator-needed";
    counts[failureClass] += 1;
  }
  return counts;
}

function detectEngineCapacity(text: string): boolean {
  return /rate limit|usage limit|too many requests|quota|credit balance.*low|try again later/.test(
    text,
  );
}

function detectEngineAuth(text: string): boolean {
  return /log in|login|reauth|oauth|session expired|missing.*api key|missing.*token|unauthorized|credential/.test(
    text,
  );
}

function resolveTransientFailure(
  priorAutoRetryCount: number,
  now: Date,
  operatorHintWhenBlocked: string,
): ResolvedTaskFailure {
  if (priorAutoRetryCount < TASK_AUTO_RETRY_BUDGET) {
    return {
      failureClass: "transient-runtime",
      shouldAutoRetry: true,
      autoRetryCount: priorAutoRetryCount + 1,
      retryAfter: new Date(now.getTime() + TASK_AUTO_RETRY_BACKOFF_MS).toISOString(),
      operatorHint: "Auto-retry scheduled after a transient runtime failure.",
    };
  }
  return {
    failureClass: "transient-runtime",
    shouldAutoRetry: false,
    autoRetryCount: priorAutoRetryCount,
    operatorHint: operatorHintWhenBlocked,
  };
}

export function resolveTaskFailure(params: ResolveTaskFailureParams): ResolvedTaskFailure {
  const reason = params.terminationReason?.trim() ?? "";
  const authHealth = params.authHealth?.trim() ?? "unknown";
  const text = `${params.summary ?? ""}\n${params.stderr ?? ""}\n${
    params.engineSelectionReason ?? ""
  }`.toLowerCase();
  const now = params.now ?? new Date();
  const priorAutoRetryCount = clampAutoRetryCount(params.priorAutoRetryCount);

  if (
    TRANSIENT_FAILURE_REASONS.has(reason) ||
    /engine-cooling-down|engine-unhealthy|no-healthy-engine/.test(
      params.engineSelectionReason ?? "",
    )
  ) {
    return resolveTransientFailure(
      priorAutoRetryCount,
      now,
      "Automatic recovery already ran once for this failure burst. Inspect the runtime before retrying again.",
    );
  }

  if (detectEngineCapacity(text)) {
    return {
      failureClass: "engine-capacity",
      shouldAutoRetry: false,
      autoRetryCount: priorAutoRetryCount,
      operatorHint:
        "Engine capacity is exhausted. Wait for quota or cooldown recovery before retrying.",
    };
  }

  if (authHealth === "missing" || authHealth === "expired" || detectEngineAuth(text)) {
    return {
      failureClass: "engine-auth",
      shouldAutoRetry: false,
      autoRetryCount: priorAutoRetryCount,
      operatorHint: "Restore CLI auth for the selected engine before retrying this task.",
    };
  }

  if (reason === "failed") {
    return {
      failureClass: "task-error",
      shouldAutoRetry: false,
      autoRetryCount: priorAutoRetryCount,
      operatorHint: "Inspect the latest worker output before retrying this task.",
    };
  }

  return {
    failureClass: "operator-needed",
    shouldAutoRetry: false,
    autoRetryCount: priorAutoRetryCount,
    operatorHint: "Operator intervention is required before this task can continue.",
  };
}
