// Narrow reply runtime helpers for channel plugins that need to dispatch
// replies or expose skill commands without importing the full reply-runtime
// barrel and its heavier Telegram-facing dependencies.

export { dispatchReplyWithBufferedBlockDispatcher } from "../auto-reply/reply/provider-dispatcher.js";
export { listSkillCommandsForAgents } from "../auto-reply/skill-commands.js";
