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

function requireMessage(value: unknown): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) {
    throw new Error("message is required");
  }
  return message;
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

export const codeCockpitHandlers: GatewayRequestHandlers = {
  "code.cockpit.summary": async ({ respond }) => {
    await withRuntimeResult(
      respond,
      async () => await getCodeCockpitRuntime().getWorkspaceSummary(),
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
};
