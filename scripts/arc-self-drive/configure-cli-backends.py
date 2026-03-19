#!/usr/bin/env python3
import json
import os
from pathlib import Path


def resolve_state_dir() -> Path:
    return Path(os.environ.get("OPENCLAW_STATE_DIR", str(Path.home() / ".openclaw"))).expanduser()


def resolve_config_path(state_dir: Path) -> Path:
    override = os.environ.get("OPENCLAW_CONFIG_PATH")
    if override:
      return Path(override).expanduser()
    return state_dir / "openclaw.json"


def pick_command(preferred: str, fallback: str) -> str:
    preferred_path = Path(preferred).expanduser()
    if preferred_path.exists():
        return str(preferred_path)
    return fallback


def main() -> None:
    state_dir = resolve_state_dir()
    state_dir.mkdir(parents=True, exist_ok=True)
    config_path = resolve_config_path(state_dir)

    if config_path.exists():
        config = json.loads(config_path.read_text())
    else:
        config = {}

    agents = config.setdefault("agents", {})
    defaults = agents.setdefault("defaults", {})
    cli_backends = defaults.setdefault("cliBackends", {})

    codex = cli_backends.setdefault("codex-cli", {})
    codex["command"] = pick_command("~/.npm-global/bin/codex", "codex")
    codex["args"] = [
        "exec",
        "--json",
        "--color",
        "never",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
    ]
    codex["resumeArgs"] = [
        "exec",
        "resume",
        "{sessionId}",
        "--color",
        "never",
        "--dangerously-bypass-approvals-and-sandbox",
        "--skip-git-repo-check",
    ]

    claude = cli_backends.setdefault("claude-cli", {})
    claude["command"] = pick_command("~/.npm-global/bin/claude", "claude")

    config_path.write_text(f"{json.dumps(config, indent=2)}\n")
    print(str(config_path))


if __name__ == "__main__":
    main()
