import type { Command } from "commander";
import {
  codeDecisionAddCommand,
  codeDecisionListCommand,
  codeMemoryAddCommand,
  codeMemoryListCommand,
  codeReviewAddCommand,
  codeReviewListCommand,
  codeReviewStatusCommand,
  codeSummaryCommand,
  codeTaskAddCommand,
  codeTaskListCommand,
  codeTaskShowCommand,
  codeTaskStatusCommand,
  codeWorkerAddCommand,
  codeWorkerCancelCommand,
  codeWorkerListCommand,
  codeWorkerLogsCommand,
  codeWorkerPauseCommand,
  codeWorkerResumeCommand,
  codeWorkerSendCommand,
  codeWorkerShowCommand,
  codeWorkerStartCommand,
  codeWorkerStatusCommand,
} from "../commands/code.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runCommandWithRuntime } from "./cli-utils.js";
import { formatHelpExamples } from "./help-format.js";

function runCodeCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

export function registerCodeCli(program: Command) {
  const code = program
    .command("code")
    .description("Run the coding cockpit for orchestrated local agent work")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["openclaw code", "Show the current coding cockpit summary."],
          [
            'openclaw code task add "Build coding cockpit" --repo ~/openclaw',
            "Create a task in the local orchestration queue.",
          ],
          [
            "openclaw code worker add --task task_1234 --name planner --worktree ~/openclaw/.worktrees/planner",
            "Attach a worker lane to a task.",
          ],
          ["openclaw code worker start worker_5678", "Start a gateway-owned Codex worker run."],
          [
            'openclaw code review add "Ready for diff review" --task task_1234 --worker worker_5678',
            "Create a review request for the review lane.",
          ],
        ])}\n\n${theme.muted("Docs:")} ${formatDocsLink("/cli/code", "docs.openclaw.ai/cli/code")}\n`,
    )
    .action(async () => {
      await runCodeCommand(async () => {
        await codeSummaryCommand({ json: false }, defaultRuntime);
      });
    });

  code
    .command("summary")
    .description("Show the coding cockpit summary")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCodeCommand(async () => {
        await codeSummaryCommand({ json: Boolean(opts.json) }, defaultRuntime);
      });
    });

  const task = code.command("task").description("Manage coding cockpit tasks");
  task
    .command("add")
    .description("Create a task in the coding cockpit queue")
    .argument("<title>", "Task title")
    .option("--repo <path>", "Repository root for the task")
    .option("--goal <text>", "Goal or acceptance target")
    .option("--notes <text>", "Operator notes")
    .option("--priority <priority>", "Task priority (low|normal|high|urgent)")
    .option("--status <status>", "Initial task status")
    .option("--json", "Output JSON", false)
    .action(async (title, opts) => {
      await runCodeCommand(async () => {
        await codeTaskAddCommand(title, opts, defaultRuntime);
      });
    });

  task
    .command("list")
    .description("List tasks in the coding cockpit")
    .option("--status <status>", "Filter by task status")
    .option("--repo <path>", "Filter by repository root")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCodeCommand(async () => {
        await codeTaskListCommand(opts, defaultRuntime);
      });
    });

  task
    .command("show")
    .description("Show a task with its workers and reviews")
    .argument("<taskId>", "Task identifier")
    .option("--json", "Output JSON", false)
    .action(async (taskId, opts) => {
      await runCodeCommand(async () => {
        await codeTaskShowCommand(taskId, opts, defaultRuntime);
      });
    });

  task
    .command("status")
    .description("Update a task status")
    .argument("<taskId>", "Task identifier")
    .argument("<status>", "Next task status")
    .option("--json", "Output JSON", false)
    .action(async (taskId, status, opts) => {
      await runCodeCommand(async () => {
        await codeTaskStatusCommand(taskId, status, opts, defaultRuntime);
      });
    });

  const worker = code.command("worker").description("Manage worker sessions");
  worker
    .command("add")
    .description("Create a worker session for a task")
    .requiredOption("--task <taskId>", "Parent task identifier")
    .requiredOption("--name <name>", "Worker session name")
    .option("--repo <path>", "Repository root")
    .option("--worktree <path>", "Worktree path")
    .option("--branch <name>", "Branch name")
    .option("--objective <text>", "Worker objective")
    .option("--lane <lane>", "Worker lane (worker|review)")
    .option("--status <status>", "Initial worker status")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCodeCommand(async () => {
        await codeWorkerAddCommand(opts, defaultRuntime);
      });
    });

  worker
    .command("list")
    .description("List worker sessions")
    .option("--task <taskId>", "Filter by parent task")
    .option("--status <status>", "Filter by worker status")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCodeCommand(async () => {
        await codeWorkerListCommand(opts, defaultRuntime);
      });
    });

  worker
    .command("status")
    .description("Update a worker session status")
    .argument("<workerId>", "Worker identifier")
    .argument("<status>", "Next worker status")
    .option("--json", "Output JSON", false)
    .action(async (workerId, status, opts) => {
      await runCodeCommand(async () => {
        await codeWorkerStatusCommand(workerId, status, opts, defaultRuntime);
      });
    });

  worker
    .command("start")
    .description("Start a gateway-owned worker run")
    .argument("<workerId>", "Worker identifier")
    .option("--json", "Output JSON", false)
    .action(async (workerId, opts) => {
      await runCodeCommand(async () => {
        await codeWorkerStartCommand(workerId, opts, defaultRuntime);
      });
    });

  worker
    .command("send")
    .description("Send a follow-up instruction to a gateway-owned worker run")
    .argument("<workerId>", "Worker identifier")
    .requiredOption("--message <text>", "Follow-up worker instruction")
    .option("--json", "Output JSON", false)
    .action(async (workerId, opts) => {
      await runCodeCommand(async () => {
        await codeWorkerSendCommand(workerId, opts, defaultRuntime);
      });
    });

  worker
    .command("pause")
    .description("Pause a gateway-owned worker run")
    .argument("<workerId>", "Worker identifier")
    .option("--json", "Output JSON", false)
    .action(async (workerId, opts) => {
      await runCodeCommand(async () => {
        await codeWorkerPauseCommand(workerId, opts, defaultRuntime);
      });
    });

  worker
    .command("resume")
    .description("Resume a paused gateway-owned worker run")
    .argument("<workerId>", "Worker identifier")
    .option("--message <text>", "Optional resume instruction")
    .option("--json", "Output JSON", false)
    .action(async (workerId, opts) => {
      await runCodeCommand(async () => {
        await codeWorkerResumeCommand(workerId, opts, defaultRuntime);
      });
    });

  worker
    .command("cancel")
    .description("Cancel a gateway-owned worker run")
    .argument("<workerId>", "Worker identifier")
    .option("--json", "Output JSON", false)
    .action(async (workerId, opts) => {
      await runCodeCommand(async () => {
        await codeWorkerCancelCommand(workerId, opts, defaultRuntime);
      });
    });

  worker
    .command("show")
    .description("Show a worker with gateway-owned runtime details")
    .argument("<workerId>", "Worker identifier")
    .option("--json", "Output JSON", false)
    .action(async (workerId, opts) => {
      await runCodeCommand(async () => {
        await codeWorkerShowCommand(workerId, opts, defaultRuntime);
      });
    });

  worker
    .command("logs")
    .description("Show the latest worker log tails")
    .argument("<workerId>", "Worker identifier")
    .option("--json", "Output JSON", false)
    .action(async (workerId, opts) => {
      await runCodeCommand(async () => {
        await codeWorkerLogsCommand(workerId, opts, defaultRuntime);
      });
    });

  const review = code.command("review").description("Manage review-lane requests");
  review
    .command("add")
    .description("Create a review request")
    .argument("<title>", "Review title")
    .requiredOption("--task <taskId>", "Parent task identifier")
    .option("--worker <workerId>", "Worker session identifier")
    .option("--summary <text>", "Review summary")
    .option("--notes <text>", "Review notes")
    .option("--status <status>", "Initial review status")
    .option("--json", "Output JSON", false)
    .action(async (title, opts) => {
      await runCodeCommand(async () => {
        await codeReviewAddCommand(title, opts, defaultRuntime);
      });
    });

  review
    .command("list")
    .description("List review requests")
    .option("--task <taskId>", "Filter by parent task")
    .option("--worker <workerId>", "Filter by worker")
    .option("--status <status>", "Filter by review status")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCodeCommand(async () => {
        await codeReviewListCommand(opts, defaultRuntime);
      });
    });

  review
    .command("status")
    .description("Update a review request status")
    .argument("<reviewId>", "Review identifier")
    .argument("<status>", "Next review status")
    .option("--json", "Output JSON", false)
    .action(async (reviewId, status, opts) => {
      await runCodeCommand(async () => {
        await codeReviewStatusCommand(reviewId, status, opts, defaultRuntime);
      });
    });

  const memory = code.command("memory").description("Capture and list operational memory");
  memory
    .command("add")
    .description("Capture a context snapshot for a task or worker")
    .option("--task <taskId>", "Parent task identifier")
    .option("--worker <workerId>", "Worker session identifier")
    .option("--kind <kind>", "Snapshot kind (repo|obsidian|brief|handoff)")
    .requiredOption("--title <title>", "Snapshot title")
    .requiredOption("--body <text>", "Snapshot body")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCodeCommand(async () => {
        await codeMemoryAddCommand(opts, defaultRuntime);
      });
    });

  memory
    .command("list")
    .description("List captured context snapshots")
    .option("--task <taskId>", "Filter by parent task")
    .option("--worker <workerId>", "Filter by worker")
    .option("--kind <kind>", "Filter by snapshot kind")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCodeCommand(async () => {
        await codeMemoryListCommand(opts, defaultRuntime);
      });
    });

  const decision = code.command("decision").description("Track operator and system decisions");
  decision
    .command("add")
    .description("Append a decision log entry")
    .option("--task <taskId>", "Parent task identifier")
    .option("--worker <workerId>", "Worker session identifier")
    .requiredOption("--kind <kind>", "Decision kind")
    .requiredOption("--summary <text>", "Decision summary")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCodeCommand(async () => {
        await codeDecisionAddCommand(opts, defaultRuntime);
      });
    });

  decision
    .command("list")
    .description("List decision log entries")
    .option("--task <taskId>", "Filter by parent task")
    .option("--worker <workerId>", "Filter by worker")
    .option("--kind <kind>", "Filter by decision kind")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runCodeCommand(async () => {
        await codeDecisionListCommand(opts, defaultRuntime);
      });
    });
}
