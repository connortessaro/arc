import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const arcScriptPath = path.resolve(process.cwd(), "scripts", "arc-self-drive", "arc.sh");

type RemoteFixture = {
  root: string;
  binDir: string;
  sshLogPath: string;
};

async function makeExecutable(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function makeRemoteFixture(tempRoots: string[]): Promise<RemoteFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-operator-remote-"));
  tempRoots.push(root);
  const binDir = path.join(root, "bin");
  await fs.mkdir(binDir, { recursive: true });

  const sshLogPath = path.join(root, "ssh.log");
  await makeExecutable(
    path.join(binDir, "ssh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\t' "$@" >> "${sshLogPath}"
printf '\\n' >> "${sshLogPath}"
printf 'REMOTE OK\\n'
`,
  );
  await makeExecutable(
    path.join(binDir, "node"),
    `#!/usr/bin/env bash
echo "local node should not run for remote arc commands" >&2
exit 97
`,
  );
  await makeExecutable(
    path.join(binDir, "curl"),
    `#!/usr/bin/env bash
echo "local curl should not run for remote arc commands" >&2
exit 98
`,
  );
  await makeExecutable(
    path.join(binDir, "jq"),
    `#!/usr/bin/env bash
echo "local jq should not run for remote arc commands" >&2
exit 99
`,
  );

  return { root, binDir, sshLogPath };
}

async function readSshCalls(logPath: string): Promise<string[][]> {
  const raw = await fs.readFile(logPath, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t").filter(Boolean));
}

function runArcScript(args: string[], env: Record<string, string>): ReturnType<typeof spawnSync> {
  return spawnSync("/bin/bash", [arcScriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

async function makeLocalFixture(tempRoots: string[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "arc-operator-local-"));
  tempRoots.push(root);
  const scriptsDir = path.join(root, "scripts", "arc-self-drive");
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.copyFile(arcScriptPath, path.join(scriptsDir, "arc.sh"));
  await fs.chmod(path.join(scriptsDir, "arc.sh"), 0o755);
  await makeExecutable(
    path.join(scriptsDir, "healthcheck.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'HEALTH\\n'
`,
  );
  await makeExecutable(
    path.join(scriptsDir, "status.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'HEALTH\\n---\\nSUMMARY\\n'
`,
  );
  return path.join(scriptsDir, "arc.sh");
}

describe("arc operator wrapper", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async (root) => {
        await fs.rm(root, { recursive: true, force: true });
      }),
    );
  });

  it("proxies dashboard mode to the VPS over ssh without using the local tsx path", async () => {
    const fixture = await makeRemoteFixture(tempRoots);
    const result = runArcScript(["dashboard"], {
      ARC_OPERATOR_MODE: "remote",
      PATH: `${fixture.binDir}:/usr/bin:/bin`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("REMOTE OK");

    const calls = await readSshCalls(fixture.sshLogPath);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("-tt");
    expect(calls[0]).toContain("arc-droplet");
    expect(calls[0]?.join(" ")).toContain("ARC_OPERATOR_MODE=local");
    expect(calls[0]?.join(" ")).toContain("bash scripts/arc-self-drive/arc.sh dashboard");
  });

  it("queues work by delegating arc do directly to the VPS wrapper", async () => {
    const fixture = await makeRemoteFixture(tempRoots);
    const result = runArcScript(["do", "Build new arc feature"], {
      ARC_OPERATOR_MODE: "remote",
      PATH: `${fixture.binDir}:/usr/bin:/bin`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("REMOTE OK");

    const calls = await readSshCalls(fixture.sshLogPath);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("arc-droplet");
    expect(calls[0]?.join(" ")).toContain("ARC_OPERATOR_MODE=local");
    expect(calls[0]?.join(" ")).toContain("bash scripts/arc-self-drive/arc.sh do");
    expect(calls[0]?.join(" ")).toContain("Build");
  });

  it("avoids printing duplicate health output for local arc status", async () => {
    const localArcScript = await makeLocalFixture(tempRoots);
    const result = spawnSync("/bin/bash", [localArcScript, "status"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ARC_OPERATOR_MODE: "local",
        PATH: "/usr/bin:/bin",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.match(/^HEALTH$/gm) ?? []).toHaveLength(1);
    expect(result.stdout).toContain("SUMMARY");
  });
});
