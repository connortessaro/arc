import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("openclaw CLI bootstrap", () => {
  it("exits cleanly for root help through the tsx entrypoint", () => {
    const entry = path.resolve(process.cwd(), "src/index.ts");
    const result = spawnSync(process.execPath, ["--import", "tsx", entry, "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 8_000,
      env: {
        ...process.env,
        OPENCLAW_TEST_FAST: "1",
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });
});
