import path from "node:path";
import {
  Container,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  Text,
  TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import { loadConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { theme } from "../tui/theme/theme.js";
import { stopTuiSafely } from "../tui/tui.js";
import { resolveUserPath, shortenHomePath } from "../utils.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import type {
  CodeCockpitWorkspaceSummary,
  CodeReviewRequest,
  CodeTask,
  CodeTaskStatus,
} from "./store.js";
import { isTaskInRetryBackoff } from "./task-reliability.js";

type CodeCockpitTuiOptions = {
  repoRoot?: string;
};

const DASHBOARD_HEALTHCHECK_INTERVAL_MS = 30_000;
const DASHBOARD_GATEWAY_TIMEOUT_MS = 60_000;
const DASHBOARD_REFRESH_INTERVAL_MS = 10_000;

type DashboardPayload = {
  storePath: string;
  repoRoot: string;
  summary: CodeCockpitWorkspaceSummary;
  tasks: CodeTask[];
  reviews: CodeReviewRequest[];
};

type HealthcheckPayload = {
  gateway?: {
    status?: string;
    port?: string;
    health?: unknown;
  };
  engines?: Record<string, { health?: string }>;
  system?: {
    memoryAvailableMiB?: number;
    swapUsedMiB?: number;
    diskFreeGiB?: number;
    gatewayRssMiB?: number;
  };
};

type AttentionItem =
  | { kind: "review"; id: string; review: CodeReviewRequest }
  | { kind: "blocked"; id: string; task: CodeTask };

type DashboardSnapshot = {
  repoRoot: string;
  summary: CodeCockpitWorkspaceSummary;
  tasks: CodeTask[];
  reviews: CodeReviewRequest[];
  activeTasks: CodeTask[];
  recentlyDoneTasks: CodeTask[];
  attentionItems: AttentionItem[];
  health: HealthcheckPayload | null;
};

const operatorColors = {
  pulse: chalk.hex("#9cff93"),
  data: chalk.hex("#81ecff"),
  alert: chalk.hex("#ffb632"),
  muted: chalk.hex("#5c6978"),
  border: chalk.hex("#3f4a56"),
};

export type ArcDashboardRenderInput = {
  width: number;
  repoRoot: string;
  summary: CodeCockpitWorkspaceSummary;
  tasks: CodeTask[];
  reviews: CodeReviewRequest[];
  health: HealthcheckPayload | null;
  statusMessage?: string;
};

type DashboardPane = "tasks" | "attention";

type DashboardActions = {
  onRefresh: () => void;
  onNewTask: () => void;
  onResolveReview: (status: "approved" | "changes_requested" | "dismissed") => void;
  onUnblockTask: () => void;
  onCancelTask: () => void;
  onQuit: () => void;
};

function padAnsi(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  const missing = Math.max(0, width - visibleWidth(truncated));
  return `${truncated}${" ".repeat(missing)}`;
}

function renderColumn(lines: string[], width: number): string[] {
  if (width <= 0) {
    return [];
  }
  return lines.map((line) => padAnsi(line, width));
}

function clampLinesToWidth(lines: string[], width: number): string[] {
  return lines.map((line) => truncateToWidth(line, width));
}

function shortStatusLabel(status: CodeTaskStatus): string {
  return status.replaceAll("_", " ");
}

function taskGoal(task: CodeTask): string | undefined {
  return task.goal?.trim() || task.notes?.trim() || undefined;
}

function renderWrappedBullet(text: string, width: number, indent = "  "): string[] {
  const contentWidth = Math.max(8, width - indent.length);
  const wrapped = wrapTextWithAnsi(text, contentWidth);
  return clampLinesToWidth(
    wrapped.map((line, index) => `${index === 0 ? indent : `${indent} `}${line}`),
    width,
  );
}

function renderPanelTitle(title: string, width: number, tone: "pulse" | "data" | "alert" = "data") {
  const color = operatorColors[tone];
  return truncateToWidth(color.bold(`[${title}]`), width);
}

function renderStatusChip(
  label: string,
  value: string,
  tone: "pulse" | "data" | "alert" | "muted" = "muted",
) {
  const color = operatorColors[tone];
  return color(`${label.toUpperCase()} ${value.toUpperCase()}`);
}

function pickHealthTone(value: string | undefined): "pulse" | "data" | "alert" | "muted" {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "unknown") {
    return "muted";
  }
  if (["healthy", "live", "active", "running", "connected", "ok"].includes(normalized)) {
    return "pulse";
  }
  if (["idle", "pending"].includes(normalized)) {
    return "data";
  }
  return "alert";
}

const HEALTH_THRESHOLDS = {
  memoryLowMiB: 512,
  swapHighMiB: 1024,
  diskLowGiB: 5,
  rssHighMiB: 2048,
};

function renderQueuePipeline(counts: Record<CodeTaskStatus, number>): string {
  const stages: Array<{
    label: string;
    key: CodeTaskStatus;
    tone: "pulse" | "data" | "alert" | "muted";
  }> = [
    { label: "Q", key: "queued", tone: "data" },
    { label: "P", key: "planning", tone: "data" },
    { label: "A", key: "in_progress", tone: "pulse" },
    { label: "R", key: "review", tone: "alert" },
    { label: "B", key: "blocked", tone: "alert" },
    { label: "D", key: "done", tone: "muted" },
  ];
  const arrow = operatorColors.muted(" → ");
  return stages
    .map(({ label, key, tone }) => {
      const count = counts[key] ?? 0;
      const color = count > 0 ? operatorColors[tone] : operatorColors.muted;
      return color(`${label}:${count}`);
    })
    .join(arrow);
}

function renderHealthWarnings(health: HealthcheckPayload | null): string[] {
  if (!health?.system) {
    return [];
  }
  const warnings: string[] = [];
  const { memoryAvailableMiB, swapUsedMiB, diskFreeGiB, gatewayRssMiB } = health.system;
  if (memoryAvailableMiB != null && memoryAvailableMiB < HEALTH_THRESHOLDS.memoryLowMiB) {
    warnings.push(operatorColors.alert(`⚠ LOW MEM ${memoryAvailableMiB}MiB`));
  }
  if (swapUsedMiB != null && swapUsedMiB > HEALTH_THRESHOLDS.swapHighMiB) {
    warnings.push(operatorColors.alert(`⚠ HIGH SWAP ${swapUsedMiB}MiB`));
  }
  if (diskFreeGiB != null && diskFreeGiB < HEALTH_THRESHOLDS.diskLowGiB) {
    warnings.push(operatorColors.alert(`⚠ LOW DISK ${diskFreeGiB}GiB`));
  }
  if (gatewayRssMiB != null && gatewayRssMiB > HEALTH_THRESHOLDS.rssHighMiB) {
    warnings.push(operatorColors.alert(`⚠ HIGH RSS ${gatewayRssMiB}MiB`));
  }
  return warnings;
}

class ArcDashboardView implements Component {
  private snapshot: DashboardSnapshot | null = null;
  private statusMessage = "Loading Arc dashboard…";
  private selectedPane: DashboardPane = "tasks";
  private selectedTaskId: string | null = null;
  private selectedAttentionId: string | null = null;

  constructor(private readonly actions: DashboardActions) {}

  setSnapshot(snapshot: DashboardSnapshot) {
    this.snapshot = snapshot;
    const fallbackTaskId = snapshot.activeTasks[0]?.id ?? null;
    if (!snapshot.activeTasks.some((task) => task.id === this.selectedTaskId)) {
      this.selectedTaskId = fallbackTaskId;
    }
    const fallbackAttentionId = snapshot.attentionItems[0]?.id ?? null;
    if (!snapshot.attentionItems.some((item) => item.id === this.selectedAttentionId)) {
      this.selectedAttentionId = fallbackAttentionId;
    }
    if (this.selectedPane === "tasks" && !this.selectedTaskId && this.selectedAttentionId) {
      this.selectedPane = "attention";
    }
    if (this.selectedPane === "attention" && !this.selectedAttentionId && this.selectedTaskId) {
      this.selectedPane = "tasks";
    }
  }

  setStatusMessage(message: string) {
    this.statusMessage = message.trim() || "Ready.";
  }

  invalidate() {}

  handleInput(data: string) {
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right) || matchesKey(data, Key.left)) {
      this.togglePane();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.moveSelection(-1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.moveSelection(1);
      return;
    }
    const lowered = data.toLowerCase();
    if (lowered === "r") {
      this.actions.onRefresh();
      return;
    }
    if (lowered === "n") {
      this.actions.onNewTask();
      return;
    }
    if (lowered === "a") {
      this.actions.onResolveReview("approved");
      return;
    }
    if (lowered === "c") {
      this.actions.onResolveReview("changes_requested");
      return;
    }
    if (lowered === "x") {
      this.actions.onResolveReview("dismissed");
      return;
    }
    if (lowered === "u") {
      this.actions.onUnblockTask();
      return;
    }
    if (lowered === "d") {
      this.actions.onCancelTask();
      return;
    }
    if (lowered === "q" || matchesKey(data, Key.ctrl("c"))) {
      this.actions.onQuit();
    }
  }

  render(width: number): string[] {
    if (!this.snapshot) {
      return [theme.dim("Loading Arc dashboard…")];
    }

    const lines: string[] = [];
    lines.push(...this.renderHeader(width), "");

    const columnGap = 3;
    const leftWidth = Math.max(34, Math.floor((width - columnGap) * 0.58));
    const rightWidth = Math.max(24, width - leftWidth - columnGap);
    const leftLines = renderColumn(this.renderTasksPane(leftWidth), leftWidth);
    const rightLines = renderColumn(this.renderAttentionPane(rightWidth), rightWidth);
    const rowCount = Math.max(leftLines.length, rightLines.length);
    for (let index = 0; index < rowCount; index += 1) {
      const left = leftLines[index] ?? " ".repeat(leftWidth);
      const right = rightLines[index] ?? " ".repeat(rightWidth);
      lines.push(`${left}${" ".repeat(columnGap)}${right}`);
    }

    lines.push("", ...this.renderDetails(width), "", theme.dim(this.statusMessage));
    return clampLinesToWidth(lines, width);
  }

  getSelectedReviewId(): string | null {
    const item =
      this.selectedPane === "attention"
        ? this.snapshot?.attentionItems.find((entry) => entry.id === this.selectedAttentionId)
        : null;
    if (!item || item.kind !== "review") {
      return null;
    }
    return item.review.id;
  }

  getSelectedTaskId(): string | null {
    if (this.selectedPane === "tasks") {
      return this.selectedTaskId;
    }
    const item = this.snapshot?.attentionItems.find(
      (entry) => entry.id === this.selectedAttentionId,
    );
    if (item?.kind === "blocked") {
      return item.task.id;
    }
    return null;
  }

  getSelectedBlockedTaskId(): string | null {
    if (this.selectedPane !== "attention") {
      return null;
    }
    const item = this.snapshot?.attentionItems.find(
      (entry) => entry.id === this.selectedAttentionId,
    );
    if (item?.kind === "blocked") {
      return item.task.id;
    }
    return null;
  }

  private renderHeader(width: number): string[] {
    const { summary, health, repoRoot, activeTasks, attentionItems } = this.snapshot!;
    const gatewayStatus = health?.gateway?.status ?? "unknown";
    const claudeHealth = health?.engines?.claude?.health ?? "unknown";
    const codexHealth = health?.engines?.codex?.health ?? "unknown";
    const retryBackoffCount = summary.retryBackoffCount;
    const activeWorker = summary.activeLanes.find((lane) => lane.status === "running");
    const topLine = operatorColors.pulse.bold(
      `ARC OPERATOR CONSOLE · ${shortenHomePath(repoRoot)}`,
    );
    const stats = [
      renderStatusChip("gw", gatewayStatus, pickHealthTone(gatewayStatus)),
      renderStatusChip("claude", claudeHealth, pickHealthTone(claudeHealth)),
      renderStatusChip("codex", codexHealth, pickHealthTone(codexHealth)),
      renderStatusChip(
        "active",
        String(activeTasks.length),
        activeTasks.length > 0 ? "data" : "muted",
      ),
      renderStatusChip(
        "attention",
        String(attentionItems.length),
        attentionItems.length > 0 ? "alert" : "muted",
      ),
      renderStatusChip(
        "retry",
        String(retryBackoffCount),
        retryBackoffCount > 0 ? "data" : "muted",
      ),
      renderStatusChip("runs", String(summary.totals.runs), "data"),
      activeWorker
        ? renderStatusChip("worker", activeWorker.workerName, "pulse")
        : renderStatusChip("worker", "idle", "muted"),
    ].join("  ");

    const pipeline = renderQueuePipeline(summary.taskStatusCounts);
    const warnings = renderHealthWarnings(health);

    const lines = [
      truncateToWidth(topLine, width),
      truncateToWidth(operatorColors.border("-".repeat(Math.max(0, width))), width),
      truncateToWidth(stats, width),
      truncateToWidth(pipeline, width),
    ];
    if (warnings.length > 0) {
      lines.push(truncateToWidth(warnings.join("  "), width));
    }
    return lines;
  }

  private renderTasksPane(width: number): string[] {
    const title = renderPanelTitle(
      "OPERATIONS",
      width,
      this.selectedPane === "tasks" ? "pulse" : "data",
    );
    const lines = [title];
    const { activeTasks } = this.snapshot!;
    if (activeTasks.length === 0) {
      lines.push(theme.dim("  No active tasks."));
      return lines;
    }
    for (const task of activeTasks.slice(0, 8)) {
      const selected = task.id === this.selectedTaskId && this.selectedPane === "tasks";
      const prefix = selected ? theme.accent("›") : theme.dim("·");
      const label = `${prefix} [${shortStatusLabel(task.status)}] ${task.title}`;
      lines.push(truncateToWidth(selected ? theme.bold(label) : label, width));
      const secondary = taskGoal(task);
      if (secondary) {
        lines.push(...renderWrappedBullet(theme.dim(secondary), width));
      }
    }
    return lines;
  }

  private renderAttentionPane(width: number): string[] {
    const title = renderPanelTitle(
      "ATTENTION",
      width,
      this.selectedPane === "attention" ? "alert" : "data",
    );
    const lines = [title];
    const { attentionItems } = this.snapshot!;
    if (attentionItems.length === 0) {
      lines.push(theme.dim("  No pending reviews or blocked tasks."));
      return lines;
    }
    for (const item of attentionItems.slice(0, 8)) {
      const selected = item.id === this.selectedAttentionId && this.selectedPane === "attention";
      const prefix = selected ? theme.accent("›") : theme.dim("·");
      if (item.kind === "review") {
        const label = `${prefix} [review] ${item.review.title}`;
        lines.push(truncateToWidth(selected ? theme.bold(label) : label, width));
        lines.push(
          ...renderWrappedBullet(
            theme.dim(
              `task ${item.review.taskId} · ${item.review.summary ?? "waiting on human input"}`,
            ),
            width,
          ),
        );
        continue;
      }
      const label = `${prefix} [blocked] ${item.task.title}`;
      lines.push(truncateToWidth(selected ? theme.bold(label) : label, width));
      lines.push(
        ...renderWrappedBullet(theme.dim(taskGoal(item.task) ?? "needs intervention"), width),
      );
    }
    return lines;
  }

  private renderDetails(width: number): string[] {
    const lines = [renderPanelTitle("SYSTEM PULSE", width, "pulse")];
    const { summary, health, attentionItems, activeTasks } = this.snapshot!;
    const gatewayStatus = health?.gateway?.status ?? "unknown";
    const claudeHealth = health?.engines?.claude?.health ?? "unknown";
    const codexHealth = health?.engines?.codex?.health ?? "unknown";
    const activeWorker = summary.activeLanes.find((lane) => lane.status === "running");
    const memoryAvailable = health?.system?.memoryAvailableMiB;
    const swapUsed = health?.system?.swapUsedMiB;
    const diskFree = health?.system?.diskFreeGiB;
    const gatewayRss = health?.system?.gatewayRssMiB;
    lines.push(
      truncateToWidth(
        [
          `gateway ${gatewayStatus}`,
          `claude ${claudeHealth}`,
          `codex ${codexHealth}`,
          `retry ${summary.retryBackoffCount}`,
          `active ${activeTasks.length}`,
          `attention ${attentionItems.length}`,
          `worker ${activeWorker?.workerName ?? "idle"}`,
        ].join(" | "),
        width,
      ),
      truncateToWidth(
        [
          memoryAvailable != null ? `mem ${memoryAvailable}MiB` : null,
          swapUsed != null ? `swap ${swapUsed}MiB` : null,
          diskFree != null ? `disk ${diskFree}GiB` : null,
          gatewayRss != null ? `rss ${gatewayRss}MiB` : null,
        ]
          .filter(Boolean)
          .join(" | "),
        width,
      ),
      truncateToWidth(
        "blocked " +
          Object.entries(summary.blockedTaskFailureCounts)
            .filter(([, count]) => count > 0)
            .map(([failureClass, count]) => `${failureClass}=${count}`)
            .join(" "),
        width,
      ),
      "",
      renderPanelTitle("DETAIL", width, "data"),
    );
    const selectedTask =
      this.selectedPane === "tasks"
        ? (this.snapshot!.activeTasks.find((task) => task.id === this.selectedTaskId) ?? null)
        : null;
    const selectedAttention =
      this.selectedPane === "attention"
        ? (this.snapshot!.attentionItems.find((item) => item.id === this.selectedAttentionId) ??
          null)
        : null;

    if (selectedTask) {
      lines.push(
        truncateToWidth(
          `${selectedTask.title} · ${shortStatusLabel(selectedTask.status)} · ${selectedTask.priority}`,
          width,
        ),
      );
      lines.push(
        ...renderWrappedBullet(taskGoal(selectedTask) ?? "No goal or notes attached.", width),
      );
    } else if (selectedAttention?.kind === "review") {
      lines.push(
        truncateToWidth(
          `${selectedAttention.review.title} · pending review · task ${selectedAttention.review.taskId}`,
          width,
        ),
      );
      lines.push(
        ...renderWrappedBullet(
          selectedAttention.review.summary ??
            selectedAttention.review.notes ??
            "Resolve this review to unblock follow-up work.",
          width,
        ),
      );
    } else if (selectedAttention?.kind === "blocked") {
      lines.push(truncateToWidth(`${selectedAttention.task.title} · blocked`, width));
      lines.push(
        ...renderWrappedBullet(
          taskGoal(selectedAttention.task) ?? "This task is blocked and needs operator input.",
          width,
        ),
      );
    } else {
      lines.push(theme.dim("Select a task or attention item."));
    }

    lines.push("", renderPanelTitle("RECENTLY COMPLETED", width, "pulse"));
    const { recentlyDoneTasks } = this.snapshot!;
    if (recentlyDoneTasks.length === 0) {
      lines.push(theme.dim("  No completed tasks yet."));
    } else {
      for (const task of recentlyDoneTasks) {
        lines.push(...renderWrappedBullet(operatorColors.pulse(`✓ ${task.title}`), width));
      }
    }

    lines.push("", renderPanelTitle("RECENT RUNS", width, "data"));
    const recentRuns = this.snapshot!.summary.recentRuns.slice(0, 3);
    if (recentRuns.length === 0) {
      lines.push(theme.dim("  No runs recorded yet."));
    } else {
      for (const run of recentRuns) {
        const summary = run.summary?.trim() || run.terminationReason || run.status;
        lines.push(
          ...renderWrappedBullet(
            `${run.status} · ${run.workerId ?? "unknown worker"} · ${summary}`,
            width,
          ),
        );
      }
    }
    lines.push(
      "",
      theme.dim(
        "n new | u unblock | d cancel | a approve | c changes | x dismiss | Tab pane | ↑↓ move | r refresh | q quit",
      ),
    );
    return lines;
  }

  private togglePane() {
    const nextPane: DashboardPane = this.selectedPane === "tasks" ? "attention" : "tasks";
    if (nextPane === "attention" && !this.snapshot?.attentionItems.length) {
      this.selectedPane = "tasks";
      return;
    }
    if (nextPane === "tasks" && !this.snapshot?.activeTasks.length) {
      this.selectedPane = "attention";
      return;
    }
    this.selectedPane = nextPane;
  }

  private moveSelection(delta: number) {
    if (!this.snapshot) {
      return;
    }
    if (this.selectedPane === "tasks") {
      const items = this.snapshot.activeTasks;
      if (items.length === 0) {
        return;
      }
      const currentIndex = Math.max(
        0,
        items.findIndex((task) => task.id === this.selectedTaskId),
      );
      const nextIndex = (currentIndex + delta + items.length) % items.length;
      this.selectedTaskId = items[nextIndex]?.id ?? this.selectedTaskId;
      return;
    }
    const items = this.snapshot.attentionItems;
    if (items.length === 0) {
      return;
    }
    const currentIndex = Math.max(
      0,
      items.findIndex((item) => item.id === this.selectedAttentionId),
    );
    const nextIndex = (currentIndex + delta + items.length) % items.length;
    this.selectedAttentionId = items[nextIndex]?.id ?? this.selectedAttentionId;
  }
}

function buildDashboardSnapshot(
  repoRoot: string,
  summary: CodeCockpitWorkspaceSummary,
  tasks: CodeTask[],
  reviews: CodeReviewRequest[],
  health: HealthcheckPayload | null,
): DashboardSnapshot {
  const scopedReviews = reviews.filter((review) => tasks.some((task) => task.id === review.taskId));
  const activeTasks = tasks.filter(
    (task) =>
      ["queued", "planning", "in_progress"].includes(task.status) && !isTaskInRetryBackoff(task),
  );
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const recentlyDoneTasks = tasks
    .filter((task) => task.status === "done")
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);
  const attentionItems: AttentionItem[] = [
    ...scopedReviews
      .filter((review) => review.status === "pending")
      .map((review) => ({ kind: "review" as const, id: review.id, review })),
    ...blockedTasks.map((task) => ({ kind: "blocked" as const, id: task.id, task })),
  ];
  return {
    repoRoot,
    summary,
    tasks,
    reviews: scopedReviews,
    activeTasks,
    recentlyDoneTasks,
    attentionItems,
    health,
  };
}

export function renderArcDashboardForTest(input: ArcDashboardRenderInput): string[] {
  const view = new ArcDashboardView({
    onRefresh: () => undefined,
    onNewTask: () => undefined,
    onResolveReview: () => undefined,
    onUnblockTask: () => undefined,
    onCancelTask: () => undefined,
    onQuit: () => undefined,
  });
  view.setSnapshot(
    buildDashboardSnapshot(input.repoRoot, input.summary, input.tasks, input.reviews, input.health),
  );
  view.setStatusMessage(input.statusMessage ?? "Ready.");
  return view.render(input.width);
}

async function callDashboardGateway<T>(method: string, params: Record<string, unknown> = {}) {
  return await callGateway<T>({
    method,
    params,
    timeoutMs: DASHBOARD_GATEWAY_TIMEOUT_MS,
    clientName: GATEWAY_CLIENT_NAMES.CLI,
    mode: GATEWAY_CLIENT_MODES.CLI,
  });
}

async function readHealthcheck(repoRoot: string): Promise<HealthcheckPayload | null> {
  const remoteTarget = process.env.ARC_REMOTE_SSH_TARGET?.trim();
  const remoteRepoRoot = process.env.ARC_REMOTE_REPO_ROOT?.trim();
  const remoteIdentity = process.env.ARC_REMOTE_SSH_IDENTITY?.trim();
  const command =
    remoteTarget && remoteRepoRoot
      ? [
          "ssh",
          ...(remoteIdentity ? ["-i", remoteIdentity] : []),
          remoteTarget,
          "bash",
          path.join(remoteRepoRoot, "scripts", "arc-self-drive", "healthcheck.sh"),
        ]
      : ["bash", path.join(repoRoot, "scripts", "arc-self-drive", "healthcheck.sh")];
  const result = await runCommandWithTimeout(command, {
    timeoutMs: 15_000,
    cwd: repoRoot,
    env: process.env,
  }).catch(() => null);
  if (!result || result.code !== 0) {
    return null;
  }
  try {
    return JSON.parse(result.stdout) as HealthcheckPayload;
  } catch {
    return null;
  }
}

async function loadDashboardSnapshot(
  repoRoot: string,
  health: HealthcheckPayload | null,
): Promise<DashboardSnapshot> {
  const payload = await callDashboardGateway<DashboardPayload>("code.cockpit.dashboard", {
    repoRoot,
  });
  return buildDashboardSnapshot(repoRoot, payload.summary, payload.tasks, payload.reviews, health);
}

async function nudgeSupervisor(repoRoot: string) {
  await callDashboardGateway("code.supervisor.tick", { repoRoot }).catch(() => undefined);
}

export async function runCodeCockpitTui(opts: CodeCockpitTuiOptions = {}) {
  void loadConfig();
  const repoRoot = path.resolve(resolveUserPath(opts.repoRoot?.trim() || process.cwd()));
  const tui = new TUI(new ProcessTerminal());
  const root = new Container();
  const header = new Text("");
  const dashboard = new ArcDashboardView({
    onRefresh: () => {
      void refresh("Refreshing Arc dashboard…");
    },
    onNewTask: () => {
      openTaskPrompt();
    },
    onResolveReview: (status) => {
      void resolveSelectedReview(status);
    },
    onUnblockTask: () => {
      void unblockSelectedTask();
    },
    onCancelTask: () => {
      void cancelSelectedTask();
    },
    onQuit: () => {
      requestExit();
    },
  });
  const footer = new Text("");
  const promptLabel = new Text(theme.bold("Queue a new Arc task"));
  const promptInput = new Input();
  const promptHint = new Text(theme.dim("Enter queues the task. Esc cancels."));
  let promptVisible = false;
  let refreshTimer: NodeJS.Timeout | null = null;
  let inFlightRefresh: Promise<void> | null = null;
  let cachedHealth: HealthcheckPayload | null = null;
  let lastHealthcheckAt = 0;
  let exiting = false;
  let resolveExit: (() => void) | null = null;

  root.addChild(header);
  root.addChild(dashboard);
  root.addChild(footer);
  tui.addChild(root);
  tui.setFocus(dashboard);
  header.setText(theme.dim("Local dashboard · remote Arc runtime"));
  footer.setText(theme.dim("Arc stays live on the VPS after you quit this dashboard."));

  const setFooter = (message: string) => {
    footer.setText(theme.dim(message));
    tui.requestRender();
  };

  const hideTaskPrompt = () => {
    if (!promptVisible) {
      return;
    }
    root.removeChild(promptLabel);
    root.removeChild(promptInput);
    root.removeChild(promptHint);
    promptVisible = false;
    tui.setFocus(dashboard);
    tui.requestRender();
  };

  const openTaskPrompt = () => {
    if (promptVisible) {
      tui.setFocus(promptInput);
      return;
    }
    promptInput.setValue("");
    root.addChild(promptLabel);
    root.addChild(promptInput);
    root.addChild(promptHint);
    promptVisible = true;
    tui.setFocus(promptInput);
    tui.requestRender();
  };

  const requestExit = () => {
    if (exiting) {
      return;
    }
    exiting = true;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    stopTuiSafely(() => tui.stop());
    resolveExit?.();
  };

  const refresh = async (message = "Refreshing Arc dashboard…") => {
    if (inFlightRefresh) {
      return await inFlightRefresh;
    }
    dashboard.setStatusMessage(message);
    setFooter("Arc stays live on the VPS after you quit this dashboard.");
    inFlightRefresh = (async () => {
      try {
        const nowMs = Date.now();
        const shouldRefreshHealth =
          cachedHealth === null || nowMs - lastHealthcheckAt >= DASHBOARD_HEALTHCHECK_INTERVAL_MS;
        if (shouldRefreshHealth) {
          cachedHealth = await readHealthcheck(repoRoot);
          lastHealthcheckAt = nowMs;
        }
        const snapshot = await loadDashboardSnapshot(repoRoot, cachedHealth);
        header.setText(theme.dim("Local dashboard · remote Arc runtime"));
        dashboard.setSnapshot(snapshot);
        dashboard.setStatusMessage(
          `Ready. ${snapshot.activeTasks.length} active tasks · ${snapshot.attentionItems.length} items need attention.`,
        );
      } catch (error) {
        dashboard.setStatusMessage(
          `Refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        inFlightRefresh = null;
        tui.requestRender();
      }
    })();
    return await inFlightRefresh;
  };

  const resolveSelectedReview = async (status: "approved" | "changes_requested" | "dismissed") => {
    const reviewId = dashboard.getSelectedReviewId();
    if (!reviewId) {
      dashboard.setStatusMessage("Select a pending review in the attention pane first.");
      tui.requestRender();
      return;
    }
    dashboard.setStatusMessage(`Updating review ${reviewId}…`);
    tui.requestRender();
    try {
      await callDashboardGateway("code.review.status", { reviewId, status });
      await nudgeSupervisor(repoRoot);
      await refresh(`Review ${reviewId} marked ${status}.`);
    } catch (error) {
      dashboard.setStatusMessage(
        `Failed to update review ${reviewId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      tui.requestRender();
    }
  };

  const unblockSelectedTask = async () => {
    const taskId = dashboard.getSelectedBlockedTaskId();
    if (!taskId) {
      dashboard.setStatusMessage("Select a blocked task in the attention pane to unblock.");
      tui.requestRender();
      return;
    }
    dashboard.setStatusMessage(`Requeuing blocked task ${taskId}…`);
    tui.requestRender();
    try {
      await callDashboardGateway("code.task.status", { taskId, status: "queued" });
      await nudgeSupervisor(repoRoot);
      await refresh(`Unblocked task ${taskId}. It will be retried.`);
    } catch (error) {
      dashboard.setStatusMessage(
        `Failed to unblock task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      tui.requestRender();
    }
  };

  const cancelSelectedTask = async () => {
    const taskId = dashboard.getSelectedTaskId();
    if (!taskId) {
      dashboard.setStatusMessage("Select a task to cancel.");
      tui.requestRender();
      return;
    }
    dashboard.setStatusMessage(`Cancelling task ${taskId}…`);
    tui.requestRender();
    try {
      await callDashboardGateway("code.task.status", { taskId, status: "cancelled" });
      await refresh(`Cancelled task ${taskId}.`);
    } catch (error) {
      dashboard.setStatusMessage(
        `Failed to cancel task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      tui.requestRender();
    }
  };

  promptInput.onSubmit = (value) => {
    const title = value.trim();
    hideTaskPrompt();
    if (!title) {
      dashboard.setStatusMessage("Cancelled empty task.");
      tui.requestRender();
      return;
    }
    void (async () => {
      dashboard.setStatusMessage(`Queueing task "${title}"…`);
      tui.requestRender();
      try {
        await callDashboardGateway("code.task.add", { title, repoRoot });
        await nudgeSupervisor(repoRoot);
        await refresh(`Queued "${title}". Arc will pick it up on the VPS.`);
      } catch (error) {
        dashboard.setStatusMessage(
          `Failed to queue task: ${error instanceof Error ? error.message : String(error)}`,
        );
        tui.requestRender();
      }
    })();
  };
  promptInput.onEscape = () => {
    hideTaskPrompt();
    dashboard.setStatusMessage("Cancelled new task prompt.");
    tui.requestRender();
  };

  tui.addInputListener((data) => {
    if (matchesKey(data, Key.ctrl("c"))) {
      if (promptVisible) {
        hideTaskPrompt();
        dashboard.setStatusMessage("Cancelled new task prompt.");
        tui.requestRender();
      } else {
        requestExit();
      }
      return { consume: true };
    }
    return undefined;
  });

  tui.start();
  tui.requestRender();

  await refresh();
  refreshTimer = setInterval(() => {
    void refresh();
  }, DASHBOARD_REFRESH_INTERVAL_MS);

  await new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
}
