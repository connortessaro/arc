import { describe, expect, it } from "vitest";
import { defaultTelegramBotDeps } from "./bot-deps.js";

describe("defaultTelegramBotDeps", () => {
  it("provides skill command helpers during module initialization", () => {
    expect(typeof defaultTelegramBotDeps.listSkillCommandsForAgents).toBe("function");
    expect(typeof defaultTelegramBotDeps.dispatchReplyWithBufferedBlockDispatcher).toBe("function");
  });
});
