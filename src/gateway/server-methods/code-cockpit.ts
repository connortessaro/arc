import { getCodeCockpitRuntime } from "../../code-cockpit/runtime.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function requireWorkerId(value: unknown): string {
  const workerId = typeof value === "string" ? value.trim() : "";
  if (!workerId) {
    throw new Error("workerId is required");
  }
  return workerId;
}

function requireTaskId(value: unknown): string {
  const taskId = typeof value === "string" ? value.trim() : "";
  if (!taskId) {
    throw new Error("taskId is required");
  }
  return taskId;
}

function requireReviewId(value: unknown): string {
  const reviewId = typeof value === "string" ? value.trim() : "";
  if (!reviewId) {
    throw new Error("reviewId is required");
  }
  return reviewId;
}

function requireTitle(value: unknown, field = "title"): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title) {
    throw new Error(`${field} is required`);
  }
  return title;
}

function requireMessage(value: unknown): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) {
    throw new Error("message is required");
  }
  return message;
}

function optionalRepoRoot(value: unknown): string | undefined {
  const repoRoot = typeof value === "string" ? value.trim() : "";
  return repoRoot || undefined;
}

function optionalString(value: unknown): string | undefined {
  const nextValue = typeof value === "string" ? value.trim() : "";
  return nextValue || undefined;
}

async function withRuntimeResult(
  respond: Parameters<GatewayRequestHandlers[string]>[0]["respond"],
  run: () => Promise<unknown>,
) {
  try {
    respond(true, await run(), undefined);
  } catch (error) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

function requireSubscriptionId(value: unknown): string {
  const subId = typeof value === "string" ? value.trim() : "";
  if (!subId) {
    throw new Error("subscriptionId is required");
  }
  return subId;
}

export const codeCockpitHandlers: GatewayRequestHandlers = {
  "code.cockpit.summary": async ({ respond }) => {
    await withRuntimeResult(
      respond,
      async () => await getCodeCockpitRuntime().getWorkspaceSummary(),
    );
  },
  "code.cockpit.dashboard": async ({ params, respond }) => {
    await withRuntimeResult(respond, async () => {
      const runtime = getCodeCockpitRuntime();
      const repoRoot = optionalRepoRoot(params.repoRoot);
      const [summary, taskPayload, reviewPayload] = await Promise.all([
        runtime.getWorkspaceSummary(),
        runtime.listTasks({ repoRoot }),
        runtime.listReviews({}),
      ]);
      const tasks =
        repoRoot === undefined
          ? taskPayload.tasks
          : taskPayload.tasks.filter((task) => task.repoRoot === repoRoot);
      const taskIds = new Set(tasks.map((task) => task.id));
      const reviews = reviewPayload.reviews.filter((review) => taskIds.has(review.taskId));
      return {
        storePath: summary.storePath,
        repoRoot: repoRoot ?? "",
        summary,
        tasks,
        reviews,
      };
    });
  },
  "code.task.add": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().addTask({
          title: requireTitle(params.title),
          repoRoot: optionalRepoRoot(params.repoRoot),
          goal: optionalString(params.goal),
          notes: optionalString(params.notes),
          priority: optionalString(params.priority) as never,
          status: optionalString(params.status) as never,
        }),
    );
  },
  "code.task.list": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().listTasks({
          repoRoot: optionalRepoRoot(params.repoRoot),
          status: optionalString(params.status) as never,
        }),
    );
  },
  "code.task.show": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().showTask({
          taskId: requireTaskId(params.taskId),
        }),
    );
  },
  "code.task.status": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().updateTaskStatus({
          taskId: requireTaskId(params.taskId),
          status: requireTitle(params.status, "status") as never,
        }),
    );
  },
  "code.review.add": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().addReview({
          taskId: requireTaskId(params.taskId),
          workerId: optionalString(params.workerId),
          title: requireTitle(params.title),
          summary: optionalString(params.summary),
          notes: optionalString(params.notes),
          status: optionalString(params.status) as never,
        }),
    );
  },
  "code.review.list": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().listReviews({
          taskId: optionalString(params.taskId),
          workerId: optionalString(params.workerId),
          status: optionalString(params.status) as never,
        }),
    );
  },
  "code.review.status": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().resolveReviewStatus({
          reviewId: requireReviewId(params.reviewId),
          status: requireTitle(params.status, "status") as never,
        }),
    );
  },
  "code.worker.start": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().startWorker({
          workerId: requireWorkerId(params.workerId),
        }),
    );
  },
  "code.worker.send": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().sendWorker({
          workerId: requireWorkerId(params.workerId),
          message: requireMessage(params.message),
        }),
    );
  },
  "code.worker.pause": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().pauseWorker({
          workerId: requireWorkerId(params.workerId),
        }),
    );
  },
  "code.worker.resume": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().resumeWorker({
          workerId: requireWorkerId(params.workerId),
          ...(typeof params.message === "string" ? { message: params.message } : {}),
        }),
    );
  },
  "code.worker.cancel": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().cancelWorker({
          workerId: requireWorkerId(params.workerId),
        }),
    );
  },
  "code.worker.show": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().showWorker({
          workerId: requireWorkerId(params.workerId),
        }),
    );
  },
  "code.worker.logs": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().readWorkerLogs({
          workerId: requireWorkerId(params.workerId),
        }),
    );
  },
  "code.supervisor.tick": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().supervisorTick({
          repoRoot: optionalRepoRoot(params.repoRoot),
        }),
    );
  },
  "code.worker.pty.snapshot": async ({ params, respond }) => {
    await withRuntimeResult(
      respond,
      async () =>
        await getCodeCockpitRuntime().readWorkerPtySnapshot({
          workerId: requireWorkerId(params.workerId),
        }),
    );
  },
  "code.worker.pty.subscribe": async ({ params, respond }) => {
    try {
      const workerId = requireWorkerId(params.workerId);
      const runtime = getCodeCockpitRuntime();
      const subscriptionId = runtime.subscribePtyLogs(workerId, () => {
        // The subscriber callback is used internally; the client polls via
        // pty.snapshot or receives push events when those are wired up.
      });
      respond(true, { subscriptionId, workerId }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "code.worker.pty.unsubscribe": async ({ params, respond }) => {
    try {
      const subscriptionId = requireSubscriptionId(params.subscriptionId);
      getCodeCockpitRuntime().unsubscribePtyLogs(subscriptionId);
      respond(true, { ok: true }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
};
