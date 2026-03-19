#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SYSTEMD_DIR="${HOME}/.config/systemd/user"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

mkdir -p "$SYSTEMD_DIR"

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
ExecStart=/usr/bin/node --import tsx ${ROOT_DIR}/scripts/arc-self-drive/supervisor-tick.ts --repo ${ROOT_DIR}
EOF

cat >"${SYSTEMD_DIR}/arc-self-drive.timer" <<EOF
[Unit]
Description=Run Arc self-drive supervisor every 10 minutes

[Timer]
OnBootSec=2m
OnUnitActiveSec=10m
RandomizedDelaySec=60
Persistent=true
Unit=arc-self-drive.service

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now openclaw-gateway.service
systemctl --user enable --now arc-self-drive.timer

echo "Installed openclaw-gateway.service and arc-self-drive.timer for ${ROOT_DIR}"
