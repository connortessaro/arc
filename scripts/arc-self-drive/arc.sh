#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_REPO_ROOT="${ARC_REPO_ROOT:-$ROOT_DIR}"
REMOTE_REPO_ROOT="${ARC_REMOTE_REPO_ROOT:-/srv/arc/repo}"
REMOTE_SSH_TARGET="${ARC_REMOTE_SSH_TARGET:-arc-droplet}"
REMOTE_SSH_IDENTITY="${ARC_REMOTE_SSH_IDENTITY:-}"
ARC_OPERATOR_MODE="${ARC_OPERATOR_MODE:-auto}"
GATEWAY_UNIT="openclaw-gateway.service"
TIMER_UNIT="arc-self-drive.timer"
TICK_UNIT="arc-self-drive.service"

REMOTE_SSH_ARGS=(ssh)
if [[ -n "$REMOTE_SSH_IDENTITY" ]]; then
  REMOTE_SSH_ARGS+=(-i "$REMOTE_SSH_IDENTITY")
fi

use_remote_operator() {
  case "$ARC_OPERATOR_MODE" in
    remote)
      return 0
      ;;
    local)
      return 1
      ;;
    auto)
      [[ "$(uname -s)" == "Darwin" ]]
      ;;
    *)
      echo "Unknown ARC_OPERATOR_MODE: ${ARC_OPERATOR_MODE}" >&2
      exit 1
      ;;
  esac
}

default_repo_root() {
  if use_remote_operator; then
    printf '%s\n' "$REMOTE_REPO_ROOT"
  else
    printf '%s\n' "$LOCAL_REPO_ROOT"
  fi
}

run_code() {
  if use_remote_operator; then
    ARC_REMOTE_REPO_ROOT="$REMOTE_REPO_ROOT" \
      ARC_REMOTE_SSH_TARGET="$REMOTE_SSH_TARGET" \
      ARC_REMOTE_SSH_IDENTITY="$REMOTE_SSH_IDENTITY" \
      bash "${ROOT_DIR}/scripts/arc-self-drive/run-code-via-ssh-tunnel.sh" "$@"
    return
  fi
  bash "${ROOT_DIR}/scripts/arc-self-drive/run-code-via-gateway.sh" "$@"
}

remote_bash() {
  local command="$1"
  "${REMOTE_SSH_ARGS[@]}" "$REMOTE_SSH_TARGET" "bash -lc $(printf '%q' "$command")"
}

remote_repo_command() {
  local command="$1"
  local repo_quoted
  printf -v repo_quoted '%q' "$REMOTE_REPO_ROOT"
  remote_bash "source ~/.profile && cd ${repo_quoted} && ${command}"
}

nudge_supervisor() {
  run_code supervisor tick --repo "$(default_repo_root)" --json >/dev/null 2>&1 || true
}

print_usage() {
  cat <<EOF
Arc operator commands

Usage:
  arc                       Open the Arc dashboard TUI
  arc dashboard             Open the Arc dashboard TUI
  arc status                Show gateway, engine, and queue status
  arc do "<goal>"           Queue a new task for $(default_repo_root)
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
  run_code tui --repo "$(default_repo_root)" "$@"
}

show_status() {
  if use_remote_operator; then
    remote_repo_command "bash scripts/arc-self-drive/healthcheck.sh"
    echo "---"
    remote_repo_command "bash scripts/arc-self-drive/status.sh"
    return
  fi
  bash "${ROOT_DIR}/scripts/arc-self-drive/healthcheck.sh"
  echo "---"
  bash "${ROOT_DIR}/scripts/arc-self-drive/status.sh"
}

show_doctor() {
  show_status
  echo "---"
  if use_remote_operator; then
    printf 'arc(local)=%s\n' "$(command -v arc || echo missing)"
    remote_bash "source ~/.profile && printf 'openclaw(remote)=%s\n' \"\$(command -v openclaw || echo missing)\" && printf 'codex(remote)=%s\n' \"\$(command -v codex || echo missing)\" && printf 'claude(remote)=%s\n' \"\$(command -v claude || echo missing)\""
    return
  fi
  printf 'arc=%s\n' "$(command -v arc || echo missing)"
  printf 'openclaw=%s\n' "$(command -v openclaw || echo missing)"
  printf 'codex=%s\n' "$(command -v codex || echo missing)"
  printf 'claude=%s\n' "$(command -v claude || echo missing)"
}

daemon_command() {
  local action="${1:-status}"
  if use_remote_operator; then
    case "$action" in
      status)
        remote_bash "source ~/.profile && systemctl --user status ${GATEWAY_UNIT} ${TICK_UNIT} ${TIMER_UNIT} --no-pager"
        ;;
      start)
        remote_bash "source ~/.profile && systemctl --user start ${GATEWAY_UNIT} ${TIMER_UNIT} && systemctl --user start ${TICK_UNIT} || true"
        ;;
      stop)
        remote_bash "source ~/.profile && systemctl --user stop ${TIMER_UNIT} ${TICK_UNIT} ${GATEWAY_UNIT}"
        ;;
      restart)
        remote_bash "source ~/.profile && systemctl --user restart ${GATEWAY_UNIT} ${TIMER_UNIT} && systemctl --user start ${TICK_UNIT} || true"
        ;;
      *)
        echo "Unknown daemon action: ${action}" >&2
        exit 1
        ;;
    esac
    return
  fi
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
    run_code task add "$title" --repo "$(default_repo_root)" "$@"
    nudge_supervisor
    ;;
  tasks)
    run_code task list --repo "$(default_repo_root)" "$@"
    ;;
  blocked)
    run_code task list --repo "$(default_repo_root)" --status blocked "$@"
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
      run_code task add "$title" --repo "$(default_repo_root)" "$@"
      nudge_supervisor
    elif [[ "$subcommand" == "list" ]]; then
      run_code task list --repo "$(default_repo_root)" "$@"
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
    run_code supervisor tick --repo "$(default_repo_root)" "$@"
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
