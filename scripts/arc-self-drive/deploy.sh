#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
WAIT_TIMEOUT_SECONDS="${ARC_SELF_DRIVE_GATEWAY_WAIT_SECONDS:-180}"
REPAIRABLE_REGISTRY_PACKAGES=(
  "@lancedb/lancedb"
  "@larksuiteoapi/node-sdk"
  "@mariozechner/pi-agent-core"
  "@sinclair/typebox"
  "ajv"
  "commander"
  "express"
  "https-proxy-agent"
  "markdown-it"
  "playwright-core"
  "undici"
  "ws"
  "zod"
)

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

repair_registry_package() {
  local package_name="$1"
  local encoded_name="${package_name//\//+}"
  local top_level_target top_level_target_resolved preferred_package_dir=""
  local package_matches
  package_matches="$(find "$ROOT_DIR/node_modules/.pnpm" -maxdepth 1 -type d -name "${encoded_name}@*" | sort || true)"

  [[ -n "$package_matches" ]] || return 0

  top_level_target="$ROOT_DIR/node_modules/$package_name"
  if [[ -L "$top_level_target" ]]; then
    top_level_target_resolved="$(readlink -f "$top_level_target" 2>/dev/null || true)"
  else
    top_level_target_resolved=""
  fi

  while IFS= read -r package_dir; do
    [[ -n "$package_dir" ]] || continue
    if [[ -n "$top_level_target_resolved" && "$top_level_target_resolved" == "$package_dir/node_modules/$package_name" ]]; then
      preferred_package_dir="$package_dir"
    fi

    local package_base package_suffix package_version archive_path
    package_base="$(basename "$package_dir")"
    package_suffix="${package_base#${encoded_name}@}"
    package_version="${package_suffix%%_*}"
    archive_path="$(npm pack "${package_name}@${package_version}" --silent | tail -n 1)"
    rm -rf "$package_dir/node_modules/$package_name"
    mkdir -p "$package_dir/node_modules/$package_name"
    tar -xzf "$archive_path" --strip-components=1 -C "$package_dir/node_modules/$package_name"
    rm -f "$archive_path"
  done <<< "$package_matches"

  local selected_package_dir
  selected_package_dir="${preferred_package_dir:-$(printf '%s\n' "$package_matches" | head -n 1)}"
  mkdir -p "$(dirname "$ROOT_DIR/node_modules/$package_name")"
  ln -sfn "$selected_package_dir/node_modules/$package_name" "$ROOT_DIR/node_modules/$package_name"
}

repair_broken_registry_packages() {
  local package_name
  for package_name in "${REPAIRABLE_REGISTRY_PACKAGES[@]}"; do
    repair_registry_package "$package_name"
  done
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

pnpm --dir "$ROOT_DIR" install --frozen-lockfile --force
repair_broken_registry_packages
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
