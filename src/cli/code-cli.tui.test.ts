import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runCodeCockpitTui = vi.fn(async () => {});
const tuiModuleFactory = vi.fn(() => ({
  runCodeCockpitTui,
}));

async function createProgram() {
  vi.resetModules();
  vi.doMock("../code-cockpit/tui.js", tuiModuleFactory);
  const { registerCodeCli } = await import("./code-cli.js");
  const program = new Command();
  program.name("openclaw");
  registerCodeCli(program);
  return program;
}

describe("code cli tui", () => {
  beforeEach(() => {
    runCodeCockpitTui.mockClear();
    tuiModuleFactory.mockClear();
  });

  afterEach(() => {
    vi.doUnmock("../code-cockpit/tui.js");
  });

  it("launches the Arc dashboard TUI for the selected repo", async () => {
    const program = await createProgram();

    expect(tuiModuleFactory).not.toHaveBeenCalled();

    await program.parseAsync(["code", "tui", "--repo", "/srv/arc/repo"], {
      from: "user",
    });

    expect(tuiModuleFactory).toHaveBeenCalledTimes(1);
    expect(runCodeCockpitTui).toHaveBeenCalledWith({
      repoRoot: "/srv/arc/repo",
    });
  });
});
