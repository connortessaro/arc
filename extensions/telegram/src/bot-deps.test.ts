import { describe, expect, it, vi } from "vitest";

describe("defaultTelegramBotDeps", () => {
  it("provides skill command helpers during module initialization", async () => {
    const { defaultTelegramBotDeps } = await import("./bot-deps.js");
    expect(typeof defaultTelegramBotDeps.listSkillCommandsForAgents).toBe("function");
    expect(typeof defaultTelegramBotDeps.dispatchReplyWithBufferedBlockDispatcher).toBe("function");
  });

  it("avoids the telegram sdk barrel during module initialization", async () => {
    vi.resetModules();
    vi.doMock("openclaw/plugin-sdk/telegram", () => {
      throw new Error("telegram sdk barrel should not load while building bot deps");
    });
    vi.doMock("openclaw/plugin-sdk/config-runtime", () => ({
      loadConfig: vi.fn(),
      resolveStorePath: vi.fn(),
    }));
    vi.doMock("openclaw/plugin-sdk/conversation-runtime", () => ({
      readChannelAllowFromStore: vi.fn(),
    }));
    vi.doMock("openclaw/plugin-sdk/infra-runtime", () => ({
      enqueueSystemEvent: vi.fn(),
    }));
    vi.doMock("openclaw/plugin-sdk/reply-runtime", () => ({
      dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
      listSkillCommandsForAgents: vi.fn(),
    }));
    vi.doMock("./sent-message-cache.js", () => ({
      wasSentByBot: vi.fn(),
    }));

    const { defaultTelegramBotDeps } = await import("./bot-deps.js");

    expect(typeof defaultTelegramBotDeps.listSkillCommandsForAgents).toBe("function");
  });
});
