#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=./load-telegram-env.sh
source "$ROOT_DIR/scripts/arc-self-drive/load-telegram-env.sh"

non_interactive=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive)
      non_interactive=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

load_arc_self_drive_telegram_env

env_file="$(arc_self_drive_telegram_env_file)"
env_dir="$(dirname "$env_file")"

bot_token="${ARC_TELEGRAM_BOT_TOKEN:-}"
chat_id="${ARC_TELEGRAM_CHAT_ID:-}"
thread_id="${ARC_TELEGRAM_THREAD_ID:-}"
notify_on_healthy="${ARC_TELEGRAM_NOTIFY_ON_HEALTHY:-true}"
stall_threshold="${ARC_TELEGRAM_STALL_THRESHOLD:-3}"
watchdog_interval="${ARC_TELEGRAM_WATCHDOG_INTERVAL:-2m}"
watchdog_delay="${ARC_TELEGRAM_WATCHDOG_DELAY:-15s}"
enable_summary="${ARC_TELEGRAM_ENABLE_SUMMARY:-true}"
summary_cron="${ARC_TELEGRAM_SUMMARY_CRON:-0 * * * *}"
summary_tz="${ARC_TELEGRAM_SUMMARY_TZ:-UTC}"
summary_job_name="${ARC_TELEGRAM_SUMMARY_JOB_NAME:-Arc runtime hourly summary}"

trim_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

prompt_value() {
  local label="$1"
  local current="$2"
  local response
  if [[ -n "$current" ]]; then
    read -r -p "${label} [${current}]: " response
    response="$(trim_value "$response")"
    if [[ -z "$response" ]]; then
      printf '%s' "$current"
      return
    fi
    printf '%s' "$response"
    return
  fi
  read -r -p "${label}: " response
  printf '%s' "$(trim_value "$response")"
}

prompt_secret() {
  local label="$1"
  local current="$2"
  local response
  if [[ -n "$current" ]]; then
    read -r -s -p "${label} [press Enter to keep current]: " response
    echo
    if [[ -z "$response" ]]; then
      printf '%s' "$current"
      return
    fi
    printf '%s' "$response"
    return
  fi
  read -r -s -p "${label}: " response
  echo
  printf '%s' "$response"
}

prompt_boolean() {
  local label="$1"
  local current="$2"
  local default_hint="Y/n"
  if [[ "$current" == "false" ]]; then
    default_hint="y/N"
  fi
  local response
  read -r -p "${label} [${default_hint}]: " response
  response="$(trim_value "$response")"
  if [[ -z "$response" ]]; then
    printf '%s' "$current"
    return
  fi
  case "${response,,}" in
    y|yes|true|1)
      printf 'true'
      ;;
    n|no|false|0)
      printf 'false'
      ;;
    *)
      echo "Enter yes or no." >&2
      exit 1
      ;;
  esac
}

if [[ "$non_interactive" == false ]]; then
  bot_token="$(prompt_secret "Telegram bot token" "$bot_token")"
  chat_id="$(prompt_value "Telegram chat id" "$chat_id")"
  thread_id="$(prompt_value "Telegram topic/thread id (optional)" "$thread_id")"
  notify_on_healthy="$(prompt_boolean "Send recovery messages when health returns" "$notify_on_healthy")"
  stall_threshold="$(prompt_value "Consecutive stalled checks before alerting" "$stall_threshold")"
  watchdog_interval="$(prompt_value "Watchdog timer interval" "$watchdog_interval")"
  watchdog_delay="$(prompt_value "Watchdog randomized delay" "$watchdog_delay")"
  enable_summary="$(prompt_boolean "Enable hourly OpenClaw Telegram summaries" "$enable_summary")"
  summary_cron="$(prompt_value "Summary cron expression" "$summary_cron")"
  summary_tz="$(prompt_value "Summary timezone" "$summary_tz")"
  summary_job_name="$(prompt_value "Summary job name" "$summary_job_name")"
fi

bot_token="$(trim_value "$bot_token")"
chat_id="$(trim_value "$chat_id")"
thread_id="$(trim_value "$thread_id")"
stall_threshold="$(trim_value "$stall_threshold")"
watchdog_interval="$(trim_value "$watchdog_interval")"
watchdog_delay="$(trim_value "$watchdog_delay")"
summary_cron="$(trim_value "$summary_cron")"
summary_tz="$(trim_value "$summary_tz")"
summary_job_name="$(trim_value "$summary_job_name")"

if [[ -z "$bot_token" ]]; then
  echo "ARC_TELEGRAM_BOT_TOKEN must be set." >&2
  exit 1
fi
if [[ "$bot_token" == *$'\n'* ]]; then
  echo "ARC_TELEGRAM_BOT_TOKEN must be a single-line token." >&2
  exit 1
fi
if [[ -z "$chat_id" ]]; then
  echo "ARC_TELEGRAM_CHAT_ID must be set." >&2
  exit 1
fi
if [[ "$chat_id" == *$'\n'* ]]; then
  echo "ARC_TELEGRAM_CHAT_ID must be a single line." >&2
  exit 1
fi
if [[ -n "$thread_id" && "$thread_id" == *$'\n'* ]]; then
  echo "ARC_TELEGRAM_THREAD_ID must be a single line." >&2
  exit 1
fi
if [[ ! "$stall_threshold" =~ ^[0-9]+$ ]] || [[ "$stall_threshold" -lt 1 ]]; then
  echo "ARC_TELEGRAM_STALL_THRESHOLD must be a positive integer." >&2
  exit 1
fi
case "$notify_on_healthy" in
  true|false) ;;
  *)
    echo "ARC_TELEGRAM_NOTIFY_ON_HEALTHY must be true or false." >&2
    exit 1
    ;;
esac
case "$enable_summary" in
  true|false) ;;
  *)
    echo "ARC_TELEGRAM_ENABLE_SUMMARY must be true or false." >&2
    exit 1
    ;;
esac

mkdir -p "$env_dir"
chmod 700 "$env_dir"

python3 - "$env_file" "$bot_token" "$chat_id" "$thread_id" "$notify_on_healthy" "$stall_threshold" "$watchdog_interval" "$watchdog_delay" "$enable_summary" "$summary_cron" "$summary_tz" "$summary_job_name" <<'PY'
import json
import pathlib
import sys

(
    env_path,
    bot_token,
    chat_id,
    thread_id,
    notify_on_healthy,
    stall_threshold,
    watchdog_interval,
    watchdog_delay,
    enable_summary,
    summary_cron,
    summary_tz,
    summary_job_name,
) = sys.argv[1:]

lines = [
    "# Arc self-drive Telegram monitoring\n",
    f"ARC_TELEGRAM_BOT_TOKEN={json.dumps(bot_token)}\n",
    f"ARC_TELEGRAM_CHAT_ID={json.dumps(chat_id)}\n",
    f"ARC_TELEGRAM_THREAD_ID={json.dumps(thread_id)}\n",
    f"ARC_TELEGRAM_NOTIFY_ON_HEALTHY={json.dumps(notify_on_healthy)}\n",
    f"ARC_TELEGRAM_STALL_THRESHOLD={json.dumps(stall_threshold)}\n",
    f"ARC_TELEGRAM_WATCHDOG_INTERVAL={json.dumps(watchdog_interval)}\n",
    f"ARC_TELEGRAM_WATCHDOG_DELAY={json.dumps(watchdog_delay)}\n",
    f"ARC_TELEGRAM_ENABLE_SUMMARY={json.dumps(enable_summary)}\n",
    f"ARC_TELEGRAM_SUMMARY_CRON={json.dumps(summary_cron)}\n",
    f"ARC_TELEGRAM_SUMMARY_TZ={json.dumps(summary_tz)}\n",
    f"ARC_TELEGRAM_SUMMARY_JOB_NAME={json.dumps(summary_job_name)}\n",
]

pathlib.Path(env_path).write_text("".join(lines), encoding="utf-8")
PY
chmod 600 "$env_file"

echo "Wrote Telegram monitoring config to ${env_file}"

if [[ "${ARC_TELEGRAM_SKIP_INSTALL:-0}" != "1" ]]; then
  bash "$ROOT_DIR/scripts/arc-self-drive/install-telegram-monitoring.sh"
fi
