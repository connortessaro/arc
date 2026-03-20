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
  "configure-cli-backends.py",
);

describe("arc self-drive cli backend configurator", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("persists a longer Claude watchdog timeout for unattended self-drive runs", async () => {
    const tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-state-"));
    tempDirs.push(tempStateDir);

    const result = spawnSync("python3", [configureScript], {
      cwd: repoRoot,
      env: { ...process.env, OPENCLAW_STATE_DIR: tempStateDir },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const config = JSON.parse(await fs.readFile(path.join(tempStateDir, "openclaw.json"), "utf8"));
    expect(
      config.agents.defaults.cliBackends["claude-cli"].reliability.watchdog.fresh,
    ).toMatchObject({
      noOutputTimeoutMs: 1_740_000,
    });
    expect(
      config.agents.defaults.cliBackends["claude-cli"].reliability.watchdog.resume,
    ).toMatchObject({
      noOutputTimeoutMs: 1_740_000,
    });
  });
});
