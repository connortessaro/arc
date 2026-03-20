#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_REPO_ROOT="${ARC_REPO_ROOT:-$ROOT_DIR}"
REMOTE_REPO_ROOT="${ARC_REMOTE_REPO_ROOT:-/srv/arc/repo}"
REMOTE_SSH_TARGET="${ARC_REMOTE_SSH_TARGET:-arc-droplet}"
OPERATOR_MODE="${ARC_OPERATOR_MODE:-auto}"
GATEWAY_UNIT="openclaw-gateway.service"
TIMER_UNIT="arc-self-drive.timer"
TICK_UNIT="arc-self-drive.service"

use_remote_arc() {
  case "$OPERATOR_MODE" in
    remote)
      return 0
      ;;
    local)
      return 1
      ;;
    auto)
      if command -v systemctl >/dev/null 2>&1; then
        return 1
      fi
      return 0
      ;;
    *)
      echo "Unknown ARC_OPERATOR_MODE: ${OPERATOR_MODE}" >&2
      exit 1
      ;;
  esac
}

ensure_ssh() {
  if ! command -v ssh >/dev/null 2>&1; then
    echo "ssh is unavailable here. Install it or run arc on the VPS user shell." >&2
    exit 1
  fi
}

remote_arc_command() {
  ensure_ssh

  local remote_command
  printf -v remote_command 'source ~/.profile >/dev/null 2>&1 || true; cd %q && ARC_OPERATOR_MODE=local bash scripts/arc-self-drive/arc.sh' "${REMOTE_REPO_ROOT}"
  for arg in "$@"; do
    printf -v remote_command '%s %q' "${remote_command}" "${arg}"
  done

  ssh "${REMOTE_SSH_TARGET}" "${remote_command}"
}

remote_arc_tty_command() {
  ensure_ssh

  local remote_command
  printf -v remote_command 'source ~/.profile >/dev/null 2>&1 || true; cd %q && ARC_OPERATOR_MODE=local bash scripts/arc-self-drive/arc.sh' "${REMOTE_REPO_ROOT}"
  for arg in "$@"; do
    printf -v remote_command '%s %q' "${remote_command}" "${arg}"
  done

  ssh -tt "${REMOTE_SSH_TARGET}" "${remote_command}"
}

run_code() {
  bash "${ROOT_DIR}/scripts/arc-self-drive/run-code-via-gateway.sh" "$@"
}

nudge_supervisor() {
  if use_remote_arc; then
    remote_arc_command tick >/dev/null 2>&1 || true
  else
    systemctl --user start "${TICK_UNIT}" >/dev/null 2>&1 || true
  fi
}

print_usage() {
  local repo_root="${DEFAULT_REPO_ROOT}"
  if use_remote_arc; then
    repo_root="${REMOTE_REPO_ROOT}"
  fi
  cat <<EOF
Arc operator commands

Usage:
  arc                       Open the Arc dashboard TUI
  arc dashboard             Open the Arc dashboard TUI
  arc self-drive            Start self-drive, nudge the queue, and show status
  arc self-drive <cmd>      start | status | stop | restart | tick
  arc drive                 Alias for arc self-drive
  arc status                Show gateway, engine, and queue status
  arc do "<goal>"           Queue a new task for ${repo_root}
  arc tasks [args...]       List tasks through the live gateway
  arc blocked [args...]     List blocked tasks that need intervention
  arc reviews [args...]     List reviews through the live gateway
  arc approve <review-id>   Approve a review and resume the queue
  arc reject <review-id>    Request changes on a review and resume the queue
  arc dismiss <review-id>   Dismiss a review and resume the queue
  arc daemon <cmd>          status | start | stop | restart
  arc tick                  Run one supervisor tick immediately
  arc doctor                Show health plus command paths
  arc help                  Show this help
EOF
}

run_dashboard() {
  if use_remote_arc; then
    remote_arc_tty_command dashboard "$@"
  else
    run_code tui --repo "${DEFAULT_REPO_ROOT}" "$@"
  fi
}

show_status() {
  if use_remote_arc; then
    remote_arc_command status
  else
    bash "${ROOT_DIR}/scripts/arc-self-drive/status.sh"
  fi
}

show_doctor() {
  if use_remote_arc; then
    remote_arc_command doctor
  else
    show_status
    echo "---"
    printf 'arc=%s\n' "$(command -v arc || echo missing)"
    printf 'openclaw=%s\n' "$(command -v openclaw || echo missing)"
    printf 'codex=%s\n' "$(command -v codex || echo missing)"
    printf 'claude=%s\n' "$(command -v claude || echo missing)"
  fi
}

ensure_systemctl() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl is unavailable here. Set ARC_OPERATOR_MODE=remote or run arc on the VPS user shell." >&2
    exit 1
  fi
}

daemon_command() {
  local action="${1:-status}"
  if use_remote_arc; then
    remote_arc_command daemon "${action}"
    return
  fi
  ensure_systemctl
  case "$action" in
    status)
      systemctl --user status "${GATEWAY_UNIT}" "${TICK_UNIT}" "${TIMER_UNIT}" --no-pager
      ;;
    start)
      systemctl --user start "${GATEWAY_UNIT}" "${TIMER_UNIT}"
      systemctl --user start "${TICK_UNIT}" || true
      ;;
    stop)
      systemctl --user stop "${TIMER_UNIT}" "${TICK_UNIT}" "${GATEWAY_UNIT}"
      ;;
    restart)
      systemctl --user restart "${GATEWAY_UNIT}" "${TIMER_UNIT}"
      systemctl --user start "${TICK_UNIT}" || true
      ;;
    *)
      echo "Unknown daemon action: ${action}" >&2
      exit 1
      ;;
  esac
}

self_drive_command() {
  local action="${1:-start}"
  if use_remote_arc; then
    remote_arc_command self-drive "${action}"
    return
  fi
  case "$action" in
    start|on|"")
      daemon_command start
      nudge_supervisor
      show_status
      ;;
    status)
      show_status
      ;;
    stop|off)
      daemon_command stop
      ;;
    restart)
      daemon_command restart
      show_status
      ;;
    tick|now)
      nudge_supervisor
      show_status
      ;;
    *)
      echo "Unknown self-drive action: ${action}" >&2
      echo "Usage: arc self-drive [start|status|stop|restart|tick]" >&2
      exit 1
      ;;
  esac
}

resolve_review_action() {
  case "$1" in
    approve) echo "approved" ;;
    reject) echo "changes_requested" ;;
    dismiss) echo "dismissed" ;;
    *)
      echo "Unknown review action: $1" >&2
      exit 1
      ;;
  esac
}

command_name="${1:-dashboard}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$command_name" in
  "")
    if [[ -t 0 && -t 1 ]]; then
      run_dashboard "$@"
    else
      show_status
      echo "---"
      print_usage
    fi
    ;;
  dashboard)
    run_dashboard "$@"
    ;;
  self-drive|drive)
    self_drive_command "${1:-start}"
    ;;
  status)
    show_status
    ;;
  help|-h|--help)
    print_usage
    ;;
  do)
    if [[ $# -eq 0 ]]; then
      echo "Usage: arc do \"<goal>\" [openclaw code task add options...]" >&2
      exit 1
    fi
    title="$1"
    shift
    if use_remote_arc; then
      remote_arc_command do "$title" "$@"
    else
      run_code task add "$title" --repo "${DEFAULT_REPO_ROOT}" "$@"
      nudge_supervisor
    fi
    ;;
  tasks)
    if use_remote_arc; then
      remote_arc_command tasks "$@"
    else
      run_code task list --repo "${DEFAULT_REPO_ROOT}" "$@"
    fi
    ;;
  blocked)
    if use_remote_arc; then
      remote_arc_command blocked "$@"
    else
      run_code task list --repo "${DEFAULT_REPO_ROOT}" --status blocked "$@"
    fi
    ;;
  task)
    subcommand="${1:-}"
    if [[ -z "$subcommand" ]]; then
      echo "Usage: arc task <add|list|show|status> ..." >&2
      exit 1
    fi
    shift
    if use_remote_arc; then
      remote_arc_command task "$subcommand" "$@"
    elif [[ "$subcommand" == "add" ]]; then
      if [[ $# -eq 0 ]]; then
        echo "Usage: arc task add \"<title>\" [options...]" >&2
        exit 1
      fi
      title="$1"
      shift
      run_code task add "$title" --repo "${DEFAULT_REPO_ROOT}" "$@"
      nudge_supervisor
    elif [[ "$subcommand" == "list" ]]; then
      run_code task list --repo "${DEFAULT_REPO_ROOT}" "$@"
    else
      run_code task "$subcommand" "$@"
      if [[ "$subcommand" == "status" ]]; then
        nudge_supervisor
      fi
    fi
    ;;
  reviews)
    if use_remote_arc; then
      remote_arc_command reviews "$@"
    else
      run_code review list "$@"
    fi
    ;;
  approve|reject|dismiss)
    if [[ $# -eq 0 ]]; then
      echo "Usage: arc ${command_name} <review-id>" >&2
      exit 1
    fi
    review_id="$1"
    shift
    review_status="$(resolve_review_action "$command_name")"
    if use_remote_arc; then
      remote_arc_command "${command_name}" "$review_id" "$@"
    else
      run_code review status "$review_id" "$review_status" "$@"
      nudge_supervisor
    fi
    ;;
  daemon)
    daemon_command "${1:-status}"
    ;;
  tick)
    if use_remote_arc; then
      remote_arc_command tick "$@"
    else
      bash "${ROOT_DIR}/scripts/arc-self-drive/run-supervisor-tick.sh" --repo "${DEFAULT_REPO_ROOT}" "$@"
    fi
    ;;
  doctor)
    show_doctor
    ;;
  code)
    if use_remote_arc; then
      remote_arc_command code "$@"
    else
      run_code "$@"
    fi
    ;;
  *)
    echo "Unknown arc command: ${command_name}" >&2
    echo >&2
    print_usage >&2
    exit 1
    ;;
esac
