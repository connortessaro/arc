import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempStateDir: string;

async function importCliModule() {
  vi.resetModules();
  return await import("./code-cli.js");
}

beforeEach(async () => {
  tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-code-cli-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", tempStateDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tempStateDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe("code cli", () => {
  async function createProgram() {
    const [{ registerCodeCli }, { defaultRuntime }] = await Promise.all([
      importCliModule(),
      import("../runtime.js"),
    ]);
    const program = new Command();
    program.name("openclaw");
    registerCodeCli(program);
    return { program, defaultRuntime };
  }

  function firstLoggedJson(log: ReturnType<typeof vi.spyOn>) {
    return JSON.parse(String(log.mock.calls.at(0)?.[0] ?? "null")) as Record<string, unknown>;
  }

  it("creates orchestration entities and reports them in the summary", async () => {
    const { program, defaultRuntime } = await createProgram();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await program.parseAsync(
      ["code", "task", "add", "Build coding cockpit", "--repo", "/tmp/openclaw", "--json"],
      { from: "user" },
    );
    const task = firstLoggedJson(log);
    log.mockClear();

    await program.parseAsync(
      [
        "code",
        "worker",
        "add",
        "--task",
        String(task.id),
        "--name",
        "planner",
        "--status",
        "running",
        "--worktree",
        "/tmp/openclaw/.worktrees/planner",
        "--branch",
        "feature/planner",
        "--json",
      ],
      { from: "user" },
    );
    const worker = firstLoggedJson(log);
    log.mockClear();

    await program.parseAsync(
      [
        "code",
        "review",
        "add",
        "Initial review",
        "--task",
        String(task.id),
        "--worker",
        String(worker.id),
        "--json",
      ],
      { from: "user" },
    );
    log.mockClear();

    await program.parseAsync(
      [
        "code",
        "memory",
        "add",
        "--task",
        String(task.id),
        "--worker",
        String(worker.id),
        "--kind",
        "repo",
        "--title",
        "CLI notes",
        "--body",
        "Lazy subcommands are already in place.",
        "--json",
      ],
      { from: "user" },
    );
    log.mockClear();

    await program.parseAsync(
      [
        "code",
        "decision",
        "add",
        "--task",
        String(task.id),
        "--worker",
        String(worker.id),
        "--kind",
        "approval",
        "--summary",
        "Require review before merge",
        "--json",
      ],
      { from: "user" },
    );
    log.mockClear();

    await program.parseAsync(["code", "summary", "--json"], { from: "user" });
    const summary = firstLoggedJson(log);

    expect(summary.totals).toMatchObject({
      tasks: 1,
      workers: 1,
      reviews: 1,
      decisions: 1,
      contextSnapshots: 1,
    });
    expect(summary.taskStatusCounts).toMatchObject({ queued: 1 });
    expect(summary.workerStatusCounts).toMatchObject({ running: 1 });
    expect(summary.reviewStatusCounts).toMatchObject({ pending: 1 });
  });

  it("updates task status transitions through the CLI", async () => {
    const { program, defaultRuntime } = await createProgram();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await program.parseAsync(["code", "task", "add", "Wire review lane", "--json"], {
      from: "user",
    });
    const task = firstLoggedJson(log);
    log.mockClear();

    await program.parseAsync(["code", "task", "status", String(task.id), "in_progress", "--json"], {
      from: "user",
    });
    const updated = firstLoggedJson(log);

    expect(updated).toMatchObject({
      id: task.id,
      status: "in_progress",
    });
  });

  it("accepts worker engine and model options through the CLI", async () => {
    const { program, defaultRuntime } = await createProgram();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await program.parseAsync(["code", "task", "add", "Wire Claude worker", "--json"], {
      from: "user",
    });
    const task = firstLoggedJson(log);
    log.mockClear();

    await program.parseAsync(
      [
        "code",
        "worker",
        "add",
        "--task",
        String(task.id),
        "--name",
        "reviewer",
        "--engine",
        "claude",
        "--model",
        "claude-sonnet-4-6",
        "--json",
      ],
      { from: "user" },
    );
    const worker = firstLoggedJson(log);

    expect(worker).toMatchObject({
      taskId: task.id,
      name: "reviewer",
      engineId: "claude",
      engineModel: "claude-sonnet-4-6",
    });
  });

  it("updates review status and applies task/worker progression through the CLI", async () => {
    const { program, defaultRuntime } = await createProgram();
    const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});

    await program.parseAsync(
      ["code", "task", "add", "Review this change", "--status", "review", "--json"],
      { from: "user" },
    );
    const task = firstLoggedJson(log);
    log.mockClear();

    await program.parseAsync(
      [
        "code",
        "worker",
        "add",
        "--task",
        String(task.id),
        "--name",
        "reviewer",
        "--status",
        "awaiting_review",
        "--json",
      ],
      { from: "user" },
    );
    const worker = firstLoggedJson(log);
    log.mockClear();

    await program.parseAsync(
      [
        "code",
        "review",
        "add",
        "Ready for approval",
        "--task",
        String(task.id),
        "--worker",
        String(worker.id),
        "--json",
      ],
      { from: "user" },
    );
    const review = firstLoggedJson(log);
    log.mockClear();

    await program.parseAsync(
      ["code", "review", "status", String(review.id), "approved", "--json"],
      { from: "user" },
    );
    const resolved = firstLoggedJson(log);

    expect(resolved.review).toMatchObject({
      id: review.id,
      status: "approved",
    });
    expect(resolved.task).toMatchObject({
      id: task.id,
      status: "done",
    });
    expect(resolved.worker).toMatchObject({
      id: worker.id,
      status: "completed",
    });
  });
});
