import os from "node:os";

/**
 * The three desktop platforms OpenClaw targets at runtime.
 * Narrower than NodeJS.Platform so callers can exhaustively switch
 * without handling hypothetical platforms.
 */
export type SupportedPlatform = "darwin" | "linux" | "win32";

/**
 * Type guard that narrows a NodeJS.Platform to SupportedPlatform.
 */
export function isSupportedPlatform(platform: NodeJS.Platform): platform is SupportedPlatform {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

/**
 * Returns the current process platform as SupportedPlatform, or throws
 * if running on an unsupported platform.
 */
export function currentPlatform(): SupportedPlatform {
  if (isSupportedPlatform(process.platform)) {
    return process.platform;
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

/**
 * Convenience boolean helpers. These read `process.platform` once
 * and are cheaper than string comparison at hot call sites.
 *
 * NOTE: These are module-level constants evaluated at import time.
 * Do not use in code paths where tests mock `process.platform` at
 * runtime — use `process.platform === "..."` checks directly there.
 */
export const isMacOS = process.platform === "darwin";
export const isLinux = process.platform === "linux";
export const isWindows = process.platform === "win32";

/**
 * Platform-specific path to read a process's command line given its PID.
 * Returns null when the platform does not expose procfs-style command line files.
 */
export function procCmdlinePath(pid: number): string | null {
  if (process.platform === "linux") {
    return `/proc/${pid}/cmdline`;
  }
  return null;
}

/**
 * Platform-specific file descriptor link paths used to resolve
 * the real path of an already-opened file handle.
 * Returns candidates in priority order; empty on Windows.
 */
export function fdLinkPaths(fd: number): string[] {
  if (process.platform === "linux") {
    return [`/proc/self/fd/${fd}`, `/dev/fd/${fd}`];
  }
  if (process.platform === "darwin") {
    return [`/dev/fd/${fd}`];
  }
  return [];
}

/**
 * Whether the platform supports O_NOFOLLOW on file open.
 * Windows does not expose this flag.
 */
export const supportsNoFollow = process.platform !== "win32";

/**
 * Human-friendly platform noun for UI/log output.
 */
export function platformLabel(platform: SupportedPlatform = currentPlatform()): string {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    case "win32":
      return "Windows";
  }
}

/**
 * Shared type for a registry keyed by supported platform.
 * Mirrors the pattern established in daemon/service.ts.
 */
export type PlatformRegistry<T> = Record<SupportedPlatform, T>;

/**
 * Look up the current platform in a PlatformRegistry.
 * Throws if the runtime platform is unsupported.
 */
export function resolvePlatformEntry<T>(registry: PlatformRegistry<T>): T {
  return registry[currentPlatform()];
}

/**
 * Returns true when the process appears to be running in a headless
 * environment (SSH session with no display forwarding, or a container
 * with no DISPLAY / WAYLAND_DISPLAY).
 * On Windows and macOS the desktop is assumed always present.
 */
export function isHeadless(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "win32" || platform === "darwin") {
    return false;
  }
  const hasDisplay = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  if (hasDisplay) {
    return false;
  }
  const isSsh = Boolean(env.SSH_CLIENT) || Boolean(env.SSH_TTY) || Boolean(env.SSH_CONNECTION);
  if (isSsh) {
    return true;
  }
  // No display and not SSH — could be a container or headless server.
  return true;
}

/**
 * True when running on an ARM host (arm or arm64).
 */
export function isArmHost(arch: string = os.arch()): boolean {
  return arch === "arm" || arch === "arm64";
}
