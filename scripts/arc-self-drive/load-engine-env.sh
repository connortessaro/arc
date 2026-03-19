#!/usr/bin/env bash
set -euo pipefail

ARC_SELF_DRIVE_ENV_FILE="${ARC_SELF_DRIVE_ENGINE_ENV_FILE:-${HOME}/.config/arc-self-drive/engine.env}"

arc_self_drive_env_file() {
  printf '%s\n' "$ARC_SELF_DRIVE_ENV_FILE"
}

load_arc_self_drive_env() {
  local env_file
  env_file="$(arc_self_drive_env_file)"
  if [[ ! -f "$env_file" ]]; then
    return
  fi

  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
}
