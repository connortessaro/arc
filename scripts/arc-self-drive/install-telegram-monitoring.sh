#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SYSTEMD_DIR="${HOME}/.config/systemd/user"

# shellcheck source=./load-telegram-env.sh
source "$ROOT_DIR/scripts/arc-self-drive/load-telegram-env.sh"

write_template_env() {
  local destination="$1"
  python3 - "$destination" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(
    "# Arc self-drive Telegram monitoring\n"
    "# Fill these values, then rerun install-telegram-monitoring.sh\n"
    'ARC_TELEGRAM_BOT_TOKEN=""\n'
    'ARC_TELEGRAM_CHAT_ID=""\n'
    'ARC_TELEGRAM_THREAD_ID=""\n'
    'ARC_TELEGRAM_NOTIFY_ON_HEALTHY="true"\n'
    'ARC_TELEGRAM_STALL_THRESHOLD="3"\n'
    'ARC_TELEGRAM_WATCHDOG_INTERVAL="2m"\n'
    'ARC_TELEGRAM_WATCHDOG_DELAY="15s"\n'
    'ARC_TELEGRAM_ENABLE_SUMMARY="true"\n'
    'ARC_TELEGRAM_SUMMARY_CRON="0 * * * *"\n'
    'ARC_TELEGRAM_SUMMARY_TZ="UTC"\n'
    'ARC_TELEGRAM_SUMMARY_JOB_NAME="Arc runtime hourly summary"\n',
    encoding="utf-8",
)
PY
}

configure_openclaw_summary_job() {
  local enabled="${ARC_TELEGRAM_ENABLE_SUMMARY:-true}"
  if [[ "$enabled" != "true" ]]; then
    echo "Telegram hourly summary job is disabled in ${env_file}"
    return
  fi

  local openclaw_command="${ARC_SELF_DRIVE_OPENCLAW_COMMAND:-openclaw}"
  if ! command -v "$openclaw_command" >/dev/null 2>&1; then
    echo "Skipping OpenClaw summary job because ${openclaw_command} is unavailable." >&2
    return
  fi

  local summary_target="${ARC_TELEGRAM_CHAT_ID}"
  if [[ -n "${ARC_TELEGRAM_THREAD_ID:-}" ]]; then
    summary_target="${summary_target}:topic:${ARC_TELEGRAM_THREAD_ID}"
  fi

  local summary_prompt
  summary_prompt="$(
    cat <<EOF
In ${ROOT_DIR}, run \`bash scripts/arc-self-drive/status.sh\` and send a concise Arc runtime operator summary. Include gateway health, Claude auth health, running workers, blocked tasks, pending reviews, and recent failed runs. If there are failures, lead with them.
EOF
  )"
  local summary_job_name="${ARC_TELEGRAM_SUMMARY_JOB_NAME:-Arc runtime hourly summary}"
  local summary_cron="${ARC_TELEGRAM_SUMMARY_CRON:-0 * * * *}"
  local summary_tz="${ARC_TELEGRAM_SUMMARY_TZ:-UTC}"

  "$openclaw_command" channels add --channel telegram --token "${ARC_TELEGRAM_BOT_TOKEN}" >/dev/null

  local cron_list_json job_id
  cron_list_json="$("$openclaw_command" cron list --all --json)"
  job_id="$(
    CRON_LIST_JSON="$cron_list_json" python3 - "$summary_job_name" <<'PY'
import json
import os
import sys

target_name = sys.argv[1]
payload = json.loads(os.environ.get("CRON_LIST_JSON", "{}"))
for job in payload.get("jobs", []):
    if job.get("name") == target_name:
        print(job.get("id", ""))
        break
PY
  )"

  if [[ -n "$job_id" ]]; then
    "$openclaw_command" cron edit "$job_id" \
      --cron "$summary_cron" \
      --tz "$summary_tz" \
      --message "$summary_prompt" \
      --deliver \
      --channel telegram \
      --to "$summary_target" >/dev/null
    echo "Updated OpenClaw Telegram summary job ${job_id}"
    return
  fi

  "$openclaw_command" cron add \
    --name "$summary_job_name" \
    --cron "$summary_cron" \
    --tz "$summary_tz" \
    --session isolated \
    --message "$summary_prompt" \
    --announce \
    --channel telegram \
    --to "$summary_target" >/dev/null
  echo "Installed OpenClaw Telegram summary job ${summary_job_name}"
}

env_file="$(arc_self_drive_telegram_env_file)"
env_dir="$(dirname "$env_file")"

mkdir -p "$SYSTEMD_DIR" "$env_dir"
chmod 700 "$env_dir"

if [[ ! -f "$env_file" ]]; then
  write_template_env "$env_file"
  chmod 600 "$env_file"
fi

load_arc_self_drive_telegram_env

watchdog_interval="${ARC_TELEGRAM_WATCHDOG_INTERVAL:-2m}"
watchdog_delay="${ARC_TELEGRAM_WATCHDOG_DELAY:-15s}"
configured=false
if [[ -n "${ARC_TELEGRAM_BOT_TOKEN:-}" && -n "${ARC_TELEGRAM_CHAT_ID:-}" ]]; then
  configured=true
fi

cat >"${SYSTEMD_DIR}/arc-telegram-watchdog.service" <<EOF
[Unit]
Description=Arc Telegram runtime watchdog
After=network-online.target openclaw-gateway.service
Wants=network-online.target openclaw-gateway.service

[Service]
Type=oneshot
WorkingDirectory=${ROOT_DIR}
Environment=HOME=${HOME}
Environment=TMPDIR=/tmp
Environment=PATH=${ROOT_DIR}/node_modules/.bin:/usr/bin:/usr/local/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin
EnvironmentFile=-%h/.config/arc-self-drive/telegram-watchdog.env
ExecStart=${ROOT_DIR}/scripts/arc-self-drive/telegram-watchdog.sh
EOF

cat >"${SYSTEMD_DIR}/arc-telegram-watchdog.timer" <<EOF
[Unit]
Description=Run Arc Telegram runtime watchdog

[Timer]
OnBootSec=45s
OnUnitActiveSec=${watchdog_interval}
RandomizedDelaySec=${watchdog_delay}
Persistent=true
Unit=arc-telegram-watchdog.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload

if [[ "$configured" == true ]]; then
  systemctl --user enable arc-telegram-watchdog.timer >/dev/null
  systemctl --user restart arc-telegram-watchdog.timer
  systemctl --user start arc-telegram-watchdog.service >/dev/null 2>&1 || true
  configure_openclaw_summary_job
  echo "Installed Arc Telegram watchdog for ${ROOT_DIR}"
  exit 0
fi

systemctl --user disable arc-telegram-watchdog.timer >/dev/null 2>&1 || true
echo "Created Telegram monitoring template at ${env_file}"
echo "Run: bash ${ROOT_DIR}/scripts/arc-self-drive/configure-telegram-monitoring.sh"
