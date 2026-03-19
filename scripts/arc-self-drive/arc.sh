#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_REPO_ROOT="${ARC_REPO_ROOT:-$ROOT_DIR}"
GATEWAY_UNIT="openclaw-gateway.service"
TIMER_UNIT="arc-self-drive.timer"
TICK_UNIT="arc-self-drive.service"

run_code() {
  bash "${ROOT_DIR}/scripts/arc-self-drive/run-code-via-gateway.sh" "$@"
}

nudge_supervisor() {
  systemctl --user start "${TICK_UNIT}" >/dev/null 2>&1 || true
}

print_usage() {
  cat <<EOF
Arc operator commands

Usage:
  arc                       Show status and available commands
  arc status                Show gateway, engine, and queue status
  arc do "<goal>"           Queue a new task for ${DEFAULT_REPO_ROOT}
  arc tasks [args...]       List tasks through the live gateway
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

show_status() {
  bash "${ROOT_DIR}/scripts/arc-self-drive/healthcheck.sh"
  echo "---"
  bash "${ROOT_DIR}/scripts/arc-self-drive/status.sh"
}

show_doctor() {
  show_status
  echo "---"
  printf 'arc=%s\n' "$(command -v arc || echo missing)"
  printf 'openclaw=%s\n' "$(command -v openclaw || echo missing)"
  printf 'codex=%s\n' "$(command -v codex || echo missing)"
  printf 'claude=%s\n' "$(command -v claude || echo missing)"
}

daemon_command() {
  local action="${1:-status}"
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

command_name="${1:-status}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$command_name" in
  ""|status)
    show_status
    if [[ "${command_name}" != "status" ]]; then
      echo "---"
      print_usage
    fi
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
    run_code task add "$title" --repo "${DEFAULT_REPO_ROOT}" "$@"
    nudge_supervisor
    ;;
  tasks)
    run_code task list --repo "${DEFAULT_REPO_ROOT}" "$@"
    ;;
  task)
    subcommand="${1:-}"
    if [[ -z "$subcommand" ]]; then
      echo "Usage: arc task <add|list|show|status> ..." >&2
      exit 1
    fi
    shift
    if [[ "$subcommand" == "add" ]]; then
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
    run_code review list "$@"
    ;;
  approve|reject|dismiss)
    if [[ $# -eq 0 ]]; then
      echo "Usage: arc ${command_name} <review-id>" >&2
      exit 1
    fi
    review_id="$1"
    shift
    review_status="$(resolve_review_action "$command_name")"
    run_code review status "$review_id" "$review_status" "$@"
    nudge_supervisor
    ;;
  daemon)
    daemon_command "${1:-status}"
    ;;
  tick)
    bash "${ROOT_DIR}/scripts/arc-self-drive/run-supervisor-tick.sh" --repo "${DEFAULT_REPO_ROOT}" "$@"
    ;;
  doctor)
    show_doctor
    ;;
  code)
    run_code "$@"
    ;;
  *)
    echo "Unknown arc command: ${command_name}" >&2
    echo >&2
    print_usage >&2
    exit 1
    ;;
esac
