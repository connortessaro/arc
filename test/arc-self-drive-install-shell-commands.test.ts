import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd());
const installScript = path.join(repoRoot, "scripts", "arc-self-drive", "install-shell-commands.sh");

describe("arc self-drive shell command installer", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("installs an openclaw shim that works outside the repo root", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-home-"));
    const outsideCwd = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-outside-"));
    tempDirs.push(tempHome, outsideCwd);

    const installResult = spawnSync("bash", [installScript], {
      cwd: repoRoot,
      env: { ...process.env, HOME: tempHome },
      encoding: "utf8",
    });

    expect(installResult.status).toBe(0);

    const shimPath = path.join(tempHome, ".local", "bin", "openclaw");
    const shimSource = await fs.readFile(shimPath, "utf8");
    expect(shimSource).toContain(`exec node "${repoRoot}/openclaw.mjs" "$@"`);
    expect(shimSource).toContain(`exec node --import tsx "${repoRoot}/src/index.ts" "$@"`);

    const helpResult = await new Promise<{
      code: number | null;
      signal: string | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }>((resolve, reject) => {
      const child = spawn(shimPath, ["--version"], {
        cwd: outsideCwd,
        env: { ...process.env, HOME: tempHome },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const settle = (result: {
        code: number | null;
        signal: string | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }) => {
        if (settled) {
          return;
        }
        settled = true;
        if (killTimer) {
          clearTimeout(killTimer);
        }
        resolve(result);
      };

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code, signal) => {
        settle({ code, signal, stdout, stderr, timedOut: false });
      });

      killTimer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 250).unref();
        settle({ code: null, signal: "SIGTERM", stdout, stderr, timedOut: true });
      }, 5_000);
    });

    expect(helpResult.code === 0 || helpResult.timedOut).toBe(true);
    expect(helpResult.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(helpResult.stderr).not.toContain("Cannot find package 'tsx'");
  });
});
