import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd());
const configureScript = path.join(
  repoRoot,
  "scripts",
  "arc-self-drive",
  "configure-telegram-monitoring.sh",
);
const installScript = path.join(
  repoRoot,
  "scripts",
  "arc-self-drive",
  "install-telegram-monitoring.sh",
);
const watchdogScript = path.join(repoRoot, "scripts", "arc-self-drive", "telegram-watchdog.sh");

async function writeExecutable(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function readLog(logPath: string) {
  try {
    return await fs.readFile(logPath, "utf8");
  } catch {
    return "";
  }
}

async function writeCockpitStore(
  homeDir: string,
  params: {
    tasks?: Array<Record<string, unknown>>;
    workers?: Array<Record<string, unknown>>;
    runs?: Array<Record<string, unknown>>;
    reviews?: Array<Record<string, unknown>>;
  },
) {
  const storePath = path.join(homeDir, ".openclaw", "code", "cockpit.json");
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const now = "2026-03-20T23:00:00.000Z";
  await fs.writeFile(
    storePath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: now,
        tasks: params.tasks ?? [],
        workers: params.workers ?? [],
        reviews: params.reviews ?? [],
        decisions: [],
        contextSnapshots: [],
        runs: params.runs ?? [],
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function installStubCommands(tempHome: string) {
  const binDir = path.join(tempHome, "bin");
  const curlLog = path.join(tempHome, "curl.log");
  const systemctlLog = path.join(tempHome, "systemctl.log");
  const openclawLog = path.join(tempHome, "openclaw.log");

  await writeExecutable(
    path.join(binDir, "systemctl"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"${systemctlLog}"
if [[ "\${1:-}" == "--user" && "\${2:-}" == "is-active" ]]; then
  printf '%s\n' "\${TEST_GATEWAY_STATUS:-active}"
  exit 0
fi
exit 0
`,
  );

  await writeExecutable(
    path.join(binDir, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
url=""
for arg in "$@"; do
  if [[ "$arg" == http://* || "$arg" == https://* ]]; then
    url="$arg"
  fi
done
if [[ "$url" == http://127.0.0.1:*"/health" ]]; then
  if [[ "\${TEST_GATEWAY_HEALTH_MODE:-ok}" == "ok" ]]; then
    printf '%s' '{"ok":true,"status":"live"}'
    exit 0
  fi
  exit 22
fi
printf '%s\\n' "$*" >>"${curlLog}"
printf '%s' '{"ok":true,"result":{"message_id":1}}'
`,
  );

  await writeExecutable(
    path.join(binDir, "claude"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "auth" && "\${2:-}" == "status" ]]; then
  if [[ "\${TEST_CLAUDE_LOGGED_IN:-1}" == "1" ]]; then
    printf '%s\n' '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty"}'
  else
    printf '%s\n' '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'
  fi
  exit 0
fi
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\n' 'claude 1.0.0'
  exit 0
fi
printf '%s\\n' 'unsupported claude invocation' >&2
exit 1
`,
  );

  await writeExecutable(
    path.join(binDir, "codex"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "login" && "\${2:-}" == "status" ]]; then
  printf '%s\n' 'Logged in using ChatGPT'
  exit 0
fi
printf '%s\\n' 'unsupported codex invocation' >&2
exit 1
`,
  );

  await writeExecutable(
    path.join(binDir, "gh"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "auth" && "\${2:-}" == "status" ]]; then
  exit 0
fi
printf '%s\\n' 'unsupported gh invocation' >&2
exit 1
`,
  );

  await writeExecutable(
    path.join(binDir, "openclaw"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"${openclawLog}"
if [[ "\${TEST_OPENCLAW_GATEWAY_RESTART_ONCE:-0}" == "1" ]]; then
  marker="\${HOME}/.openclaw/.gateway-restart-once"
  if [[ ! -f "$marker" && "\${1:-}" == "channels" && "\${2:-}" == "add" ]]; then
    mkdir -p "$(dirname "$marker")"
    : >"$marker"
    printf '%s\\n' 'gateway connect failed: Error: gateway closed (1006): no close reason' >&2
    exit 1
  fi
fi
if [[ "\${1:-}" == "cron" && "\${2:-}" == "list" ]]; then
  printf '%s\\n' '{"jobs":[]}'
  exit 0
fi
printf '%s\\n' '{"ok":true}'
`,
  );

  return { binDir, curlLog, systemctlLog, openclawLog };
}

describe("arc self-drive telegram monitoring", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("writes a secured telegram monitoring env file from non-interactive inputs", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-telegram-config-"));
    tempDirs.push(tempHome);

    const result = spawnSync("bash", [configureScript, "--non-interactive"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: tempHome,
        ARC_TELEGRAM_BOT_TOKEN: "123456:secret-token",
        ARC_TELEGRAM_CHAT_ID: "-1001234567890",
        ARC_TELEGRAM_THREAD_ID: "42",
        ARC_TELEGRAM_SUMMARY_TZ: "America/New_York",
        ARC_TELEGRAM_SUMMARY_CRON: "0 * * * *",
        ARC_TELEGRAM_SKIP_INSTALL: "1",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("123456:secret-token");
    expect(result.stderr).not.toContain("123456:secret-token");

    const envPath = path.join(tempHome, ".config", "arc-self-drive", "telegram-watchdog.env");
    const envContents = await fs.readFile(envPath, "utf8");
    const stat = await fs.stat(envPath);

    expect(envContents).toContain('ARC_TELEGRAM_BOT_TOKEN="123456:secret-token"');
    expect(envContents).toContain('ARC_TELEGRAM_CHAT_ID="-1001234567890"');
    expect(envContents).toContain('ARC_TELEGRAM_THREAD_ID="42"');
    expect(envContents).toContain('ARC_TELEGRAM_SUMMARY_TZ="America/New_York"');
    expect(envContents).toContain('ARC_TELEGRAM_SUMMARY_CRON="0 * * * *"');
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("installs watchdog units and configures an hourly telegram summary job when credentials exist", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-telegram-install-"));
    tempDirs.push(tempHome);

    const { binDir, openclawLog, systemctlLog } = await installStubCommands(tempHome);
    const envDir = path.join(tempHome, ".config", "arc-self-drive");
    await fs.mkdir(envDir, { recursive: true });
    await fs.writeFile(
      path.join(envDir, "telegram-watchdog.env"),
      [
        "# Arc self-drive Telegram monitoring",
        'ARC_TELEGRAM_BOT_TOKEN="123456:secret-token"',
        'ARC_TELEGRAM_CHAT_ID="-1001234567890"',
        'ARC_TELEGRAM_THREAD_ID="42"',
        'ARC_TELEGRAM_SUMMARY_CRON="0 * * * *"',
        'ARC_TELEGRAM_SUMMARY_TZ="America/New_York"',
        'ARC_TELEGRAM_ENABLE_SUMMARY="true"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync("bash", [installScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: tempHome,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        ARC_SELF_DRIVE_OPENCLAW_COMMAND: path.join(binDir, "openclaw"),
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const servicePath = path.join(
      tempHome,
      ".config",
      "systemd",
      "user",
      "arc-telegram-watchdog.service",
    );
    const timerPath = path.join(
      tempHome,
      ".config",
      "systemd",
      "user",
      "arc-telegram-watchdog.timer",
    );
    const serviceContents = await fs.readFile(servicePath, "utf8");
    const timerContents = await fs.readFile(timerPath, "utf8");
    const openclawCalls = await readLog(openclawLog);
    const systemctlCalls = await readLog(systemctlLog);

    expect(serviceContents).toContain("telegram-watchdog.sh");
    expect(serviceContents).toContain(
      "EnvironmentFile=-%h/.config/arc-self-drive/telegram-watchdog.env",
    );
    expect(timerContents).toContain("Unit=arc-telegram-watchdog.service");

    expect(openclawCalls).toContain("channels add --channel telegram --token 123456:secret-token");
    expect(openclawCalls).toContain("cron list --all --json");
    expect(openclawCalls).toContain("cron add --name Arc runtime hourly summary");
    expect(openclawCalls).toContain("--channel telegram --to -1001234567890:topic:42");

    expect(systemctlCalls).toContain("--user daemon-reload");
    expect(systemctlCalls).toContain("--user enable arc-telegram-watchdog.timer");
    expect(systemctlCalls).toContain("--user restart arc-telegram-watchdog.timer");
  });

  it("retries summary setup when openclaw commands race a gateway restart", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-telegram-retry-"));
    tempDirs.push(tempHome);

    const { binDir, openclawLog } = await installStubCommands(tempHome);
    const envDir = path.join(tempHome, ".config", "arc-self-drive");
    await fs.mkdir(envDir, { recursive: true });
    await fs.writeFile(
      path.join(envDir, "telegram-watchdog.env"),
      [
        "# Arc self-drive Telegram monitoring",
        'ARC_TELEGRAM_BOT_TOKEN="123456:secret-token"',
        'ARC_TELEGRAM_CHAT_ID="-1001234567890"',
        'ARC_TELEGRAM_ENABLE_SUMMARY="true"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = spawnSync("bash", [installScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: tempHome,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        ARC_SELF_DRIVE_OPENCLAW_COMMAND: path.join(binDir, "openclaw"),
        TEST_OPENCLAW_GATEWAY_RESTART_ONCE: "1",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const openclawCalls = await readLog(openclawLog);
    expect((openclawCalls.match(/^channels add --channel telegram --token /gm) ?? []).length).toBe(
      2,
    );
    expect(openclawCalls).toContain("cron add --name Arc runtime hourly summary");
  });

  it("alerts only on watchdog state transitions and sends a recovery message after health returns", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-telegram-watchdog-"));
    tempDirs.push(tempHome);

    const { binDir, curlLog } = await installStubCommands(tempHome);
    const envDir = path.join(tempHome, ".config", "arc-self-drive");
    await fs.mkdir(envDir, { recursive: true });
    await fs.writeFile(
      path.join(envDir, "telegram-watchdog.env"),
      [
        "# Arc self-drive Telegram monitoring",
        'ARC_TELEGRAM_BOT_TOKEN="123456:secret-token"',
        'ARC_TELEGRAM_CHAT_ID="-1001234567890"',
        'ARC_TELEGRAM_NOTIFY_ON_HEALTHY="true"',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeCockpitStore(tempHome, {});

    const baseEnv = {
      ...process.env,
      HOME: tempHome,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      TEST_CLAUDE_LOGGED_IN: "1",
    };

    const firstHealthy = spawnSync("bash", [watchdogScript], {
      cwd: repoRoot,
      env: baseEnv,
      encoding: "utf8",
    });
    expect(firstHealthy.status).toBe(0);
    expect(await readLog(curlLog)).toBe("");

    const degraded = spawnSync("bash", [watchdogScript], {
      cwd: repoRoot,
      env: { ...baseEnv, TEST_CLAUDE_LOGGED_IN: "0" },
      encoding: "utf8",
    });
    expect(degraded.status).toBe(0);

    const degradedLog = await readLog(curlLog);
    expect(degradedLog).toContain("api.telegram.org/bot123456:secret-token/sendMessage");
    expect(degradedLog).toContain("Arc runtime alert");
    expect(degradedLog).toContain("claude auth health is missing");

    const repeated = spawnSync("bash", [watchdogScript], {
      cwd: repoRoot,
      env: { ...baseEnv, TEST_CLAUDE_LOGGED_IN: "0" },
      encoding: "utf8",
    });
    expect(repeated.status).toBe(0);
    expect(((await readLog(curlLog)).match(/sendMessage/g) ?? []).length).toBe(1);

    const recovered = spawnSync("bash", [watchdogScript], {
      cwd: repoRoot,
      env: baseEnv,
      encoding: "utf8",
    });
    expect(recovered.status).toBe(0);

    const recoveredLog = await readLog(curlLog);
    expect((recoveredLog.match(/sendMessage/g) ?? []).length).toBe(2);
    expect(recoveredLog).toContain("Arc runtime recovered");
  });

  it("waits for repeated stalled-queue detections before alerting", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-telegram-stall-"));
    tempDirs.push(tempHome);

    const { binDir, curlLog } = await installStubCommands(tempHome);
    const envDir = path.join(tempHome, ".config", "arc-self-drive");
    await fs.mkdir(envDir, { recursive: true });
    await fs.writeFile(
      path.join(envDir, "telegram-watchdog.env"),
      [
        "# Arc self-drive Telegram monitoring",
        'ARC_TELEGRAM_BOT_TOKEN="123456:secret-token"',
        'ARC_TELEGRAM_CHAT_ID="-1001234567890"',
        'ARC_TELEGRAM_STALL_THRESHOLD="2"',
        "",
      ].join("\n"),
      "utf8",
    );
    await writeCockpitStore(tempHome, {
      tasks: [
        {
          id: "task_1",
          title: "Repair blocked runtime",
          status: "queued",
          priority: "high",
          createdAt: "2026-03-20T23:00:00.000Z",
          updatedAt: "2026-03-20T23:00:00.000Z",
          workerIds: [],
          reviewIds: [],
        },
      ],
    });

    const env = {
      ...process.env,
      HOME: tempHome,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      TEST_CLAUDE_LOGGED_IN: "1",
    };

    const first = spawnSync("bash", [watchdogScript], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
    });
    expect(first.status).toBe(0);
    expect(await readLog(curlLog)).toBe("");

    const second = spawnSync("bash", [watchdogScript], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
    });
    expect(second.status).toBe(0);

    const curlCalls = await readLog(curlLog);
    expect(curlCalls).toContain("Arc runtime alert");
    expect(curlCalls).toContain("stalled queue");
  });
});
