#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
WAIT_TIMEOUT_SECONDS="${ARC_SELF_DRIVE_GATEWAY_WAIT_SECONDS:-180}"

require_clean_checkout() {
  if ! git -C "$ROOT_DIR" diff --quiet --ignore-submodules --; then
    echo "Refusing to deploy from a dirty checkout: $ROOT_DIR" >&2
    exit 1
  fi
  if ! git -C "$ROOT_DIR" diff --cached --quiet --ignore-submodules --; then
    echo "Refusing to deploy with staged-but-uncommitted changes: $ROOT_DIR" >&2
    exit 1
  fi
}

resolve_branch() {
  local branch="${1:-}"
  if [[ -n "$branch" ]]; then
    printf '%s\n' "$branch"
    return
  fi
  branch="$(git -C "$ROOT_DIR" branch --show-current)"
  if [[ -z "$branch" ]]; then
    echo "Unable to deploy from a detached HEAD checkout." >&2
    exit 1
  fi
  printf '%s\n' "$branch"
}

resolve_upstream() {
  local branch="$1"
  local upstream
  upstream="$(git -C "$ROOT_DIR" for-each-ref --format='%(upstream:short)' "refs/heads/${branch}" | head -n1)"
  if [[ -n "$upstream" ]]; then
    printf '%s\n' "$upstream"
    return
  fi
  printf 'origin/%s\n' "$branch"
}

branch="$(resolve_branch "${1:-}")"
upstream_ref="$(resolve_upstream "$branch")"
remote_name="${upstream_ref%%/*}"

require_clean_checkout

git -C "$ROOT_DIR" fetch "$remote_name" --prune
git -C "$ROOT_DIR" checkout "$branch"
git -C "$ROOT_DIR" merge --ff-only "$upstream_ref"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required before running deploy.sh. Run 'sudo corepack enable' once on the VPS." >&2
  exit 1
fi

pnpm --dir "$ROOT_DIR" install --frozen-lockfile
pnpm --dir "$ROOT_DIR" build
bash "$ROOT_DIR/scripts/arc-self-drive/install-systemd.sh" >/dev/null

deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
until curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    echo "Gateway did not become healthy within ${WAIT_TIMEOUT_SECONDS}s." >&2
    systemctl --user status openclaw-gateway.service --no-pager >&2 || true
    exit 1
  fi
  sleep 2
done

bash "$ROOT_DIR/scripts/arc-self-drive/healthcheck.sh"
