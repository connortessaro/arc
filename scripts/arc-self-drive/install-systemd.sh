#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SYSTEMD_DIR="${HOME}/.config/systemd/user"
ENV_DIR="${HOME}/.config/arc-self-drive"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
SELF_DRIVE_INTERVAL="${ARC_SELF_DRIVE_INTERVAL:-2m}"
SELF_DRIVE_DELAY="${ARC_SELF_DRIVE_DELAY:-15s}"

mkdir -p "$SYSTEMD_DIR"
mkdir -p "$ENV_DIR"

python3 "${ROOT_DIR}/scripts/arc-self-drive/configure-cli-backends.py" >/dev/null

cat >"${SYSTEMD_DIR}/openclaw-gateway.service" <<EOF
[Unit]
Description=OpenClaw Gateway (Arc source runtime)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${ROOT_DIR}/scripts/arc-self-drive/run-gateway-source.sh
WorkingDirectory=${ROOT_DIR}
Restart=always
RestartSec=5
TimeoutStopSec=30
TimeoutStartSec=30
SuccessExitStatus=0 143
KillMode=control-group
Environment=HOME=${HOME}
Environment=TMPDIR=/tmp
Environment=PATH=${ROOT_DIR}/node_modules/.bin:/usr/bin:/usr/local/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin
EnvironmentFile=-%h/.config/arc-self-drive/engine.env
Environment=OPENCLAW_GATEWAY_PORT=${GATEWAY_PORT}
Environment=OPENCLAW_SYSTEMD_UNIT=openclaw-gateway.service
Environment=OPENCLAW_SERVICE_MARKER=openclaw
Environment=OPENCLAW_SERVICE_KIND=gateway
Environment=OPENCLAW_SERVICE_VERSION=arc-self-drive

[Install]
WantedBy=default.target
EOF

cat >"${SYSTEMD_DIR}/arc-self-drive.service" <<EOF
[Unit]
Description=Arc self-drive supervisor tick
After=openclaw-gateway.service
Wants=openclaw-gateway.service

[Service]
Type=oneshot
WorkingDirectory=${ROOT_DIR}
Environment=HOME=${HOME}
Environment=TMPDIR=/tmp
Environment=PATH=${ROOT_DIR}/node_modules/.bin:/usr/bin:/usr/local/bin:/bin:${HOME}/.local/bin:${HOME}/.npm-global/bin
EnvironmentFile=-%h/.config/arc-self-drive/engine.env
ExecStart=${ROOT_DIR}/scripts/arc-self-drive/run-supervisor-tick.sh --repo ${ROOT_DIR}
EOF

cat >"${SYSTEMD_DIR}/arc-self-drive.timer" <<EOF
[Unit]
Description=Run Arc self-drive supervisor continuously

[Timer]
OnBootSec=30s
OnUnitActiveSec=${SELF_DRIVE_INTERVAL}
RandomizedDelaySec=${SELF_DRIVE_DELAY}
Persistent=true
Unit=arc-self-drive.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable openclaw-gateway.service >/dev/null
systemctl --user restart openclaw-gateway.service
systemctl --user enable arc-self-drive.timer >/dev/null
systemctl --user restart arc-self-drive.timer

echo "Installed openclaw-gateway.service and arc-self-drive.timer for ${ROOT_DIR}"
