import { describe, expect, it } from "vitest";
import {
  currentPlatform,
  fdLinkPaths,
  isArmHost,
  isHeadless,
  isMacOS,
  isLinux,
  isWindows,
  isSupportedPlatform,
  platformLabel,
  procCmdlinePath,
  resolvePlatformEntry,
  supportsNoFollow,
  type PlatformRegistry,
  type SupportedPlatform,
} from "./platform.js";

describe("isSupportedPlatform", () => {
  it("accepts darwin, linux, and win32", () => {
    expect(isSupportedPlatform("darwin")).toBe(true);
    expect(isSupportedPlatform("linux")).toBe(true);
    expect(isSupportedPlatform("win32")).toBe(true);
  });

  it("rejects other platforms", () => {
    expect(isSupportedPlatform("freebsd")).toBe(false);
    expect(isSupportedPlatform("sunos")).toBe(false);
    expect(isSupportedPlatform("aix")).toBe(false);
    expect(isSupportedPlatform("android")).toBe(false);
  });
});

describe("currentPlatform", () => {
  it("returns current process platform when supported", () => {
    const platform = currentPlatform();
    expect(["darwin", "linux", "win32"]).toContain(platform);
    expect(platform).toBe(process.platform);
  });
});

describe("boolean helpers", () => {
  it("exactly one of isMacOS, isLinux, isWindows is true", () => {
    const trueCount = [isMacOS, isLinux, isWindows].filter(Boolean).length;
    expect(trueCount).toBe(1);
  });

  it("matches process.platform", () => {
    if (process.platform === "darwin") {
      expect(isMacOS).toBe(true);
    }
    if (process.platform === "linux") {
      expect(isLinux).toBe(true);
    }
    if (process.platform === "win32") {
      expect(isWindows).toBe(true);
    }
  });
});

describe("procCmdlinePath", () => {
  it("returns /proc path on linux", () => {
    if (process.platform === "linux") {
      expect(procCmdlinePath(123)).toBe("/proc/123/cmdline");
    }
  });

  it("returns null on non-linux platforms", () => {
    if (process.platform !== "linux") {
      expect(procCmdlinePath(123)).toBeNull();
    }
  });
});

describe("fdLinkPaths", () => {
  it("returns at least one path on unix platforms", () => {
    if (process.platform !== "win32") {
      const paths = fdLinkPaths(5);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.every((p) => p.includes("5"))).toBe(true);
    }
  });

  it("returns linux-specific paths on linux", () => {
    if (process.platform === "linux") {
      const paths = fdLinkPaths(7);
      expect(paths).toEqual(["/proc/self/fd/7", "/dev/fd/7"]);
    }
  });

  it("returns darwin-specific path on darwin", () => {
    if (process.platform === "darwin") {
      expect(fdLinkPaths(7)).toEqual(["/dev/fd/7"]);
    }
  });

  it("returns empty on windows", () => {
    if (process.platform === "win32") {
      expect(fdLinkPaths(7)).toEqual([]);
    }
  });
});

describe("supportsNoFollow", () => {
  it("is false only on windows", () => {
    expect(supportsNoFollow).toBe(process.platform !== "win32");
  });
});

describe("platformLabel", () => {
  it("returns human-friendly names", () => {
    expect(platformLabel("darwin")).toBe("macOS");
    expect(platformLabel("linux")).toBe("Linux");
    expect(platformLabel("win32")).toBe("Windows");
  });
});

describe("PlatformRegistry / resolvePlatformEntry", () => {
  it("resolves the current platform entry", () => {
    const registry: PlatformRegistry<string> = {
      darwin: "mac-value",
      linux: "linux-value",
      win32: "win-value",
    };
    const result = resolvePlatformEntry(registry);
    const expected = registry[process.platform as SupportedPlatform];
    expect(result).toBe(expected);
  });
});

describe("isHeadless", () => {
  it("returns false for darwin regardless of env", () => {
    expect(isHeadless({}, "darwin")).toBe(false);
  });

  it("returns false for win32 regardless of env", () => {
    expect(isHeadless({}, "win32")).toBe(false);
  });

  it("returns false on linux with DISPLAY set", () => {
    expect(isHeadless({ DISPLAY: ":0" }, "linux")).toBe(false);
  });

  it("returns false on linux with WAYLAND_DISPLAY set", () => {
    expect(isHeadless({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(false);
  });

  it("returns true on linux SSH without display", () => {
    expect(isHeadless({ SSH_CLIENT: "1.2.3.4 12345 22" }, "linux")).toBe(true);
  });

  it("returns true on linux with no display or SSH", () => {
    expect(isHeadless({}, "linux")).toBe(true);
  });
});

describe("isArmHost", () => {
  it("detects arm architectures", () => {
    expect(isArmHost("arm")).toBe(true);
    expect(isArmHost("arm64")).toBe(true);
  });

  it("rejects non-arm architectures", () => {
    expect(isArmHost("x64")).toBe(false);
    expect(isArmHost("ia32")).toBe(false);
  });
});
