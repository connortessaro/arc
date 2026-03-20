#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"

incoming_github_token="${ARC_SELF_DRIVE_GITHUB_TOKEN-}"
incoming_base_branch="${ARC_SELF_DRIVE_BASE_BRANCH-}"
incoming_remote_name="${ARC_SELF_DRIVE_GITHUB_REMOTE-}"
incoming_push_transport="${ARC_SELF_DRIVE_GITHUB_PUSH_TRANSPORT-}"
incoming_ssh_host_alias="${ARC_SELF_DRIVE_GITHUB_SSH_HOST_ALIAS-}"
incoming_ssh_key_path="${ARC_SELF_DRIVE_GITHUB_SSH_KEY_PATH-}"
incoming_claude_token="${CLAUDE_CODE_OAUTH_TOKEN-}"

# shellcheck source=./load-engine-env.sh
source "$ROOT_DIR/scripts/arc-self-drive/load-engine-env.sh"
load_arc_self_drive_env

env_file="$(arc_self_drive_env_file)"
env_dir="$(dirname "$env_file")"
# Allow explicit shell exports to override the persisted env file so operators can
# rotate auth or switch transports without manually editing engine.env first.
github_token="${incoming_github_token:-${ARC_SELF_DRIVE_GITHUB_TOKEN:-}}"
base_branch="${incoming_base_branch:-${ARC_SELF_DRIVE_BASE_BRANCH:-main}}"
remote_name="${incoming_remote_name:-${ARC_SELF_DRIVE_GITHUB_REMOTE:-origin}}"
push_transport="${incoming_push_transport:-${ARC_SELF_DRIVE_GITHUB_PUSH_TRANSPORT:-https}}"
ssh_host_alias="${incoming_ssh_host_alias:-${ARC_SELF_DRIVE_GITHUB_SSH_HOST_ALIAS:-github.com-arc-self-drive}}"
ssh_key_path="${incoming_ssh_key_path:-${ARC_SELF_DRIVE_GITHUB_SSH_KEY_PATH:-${HOME}/.ssh/arc_runtime_github}}"
claude_token="${incoming_claude_token:-${CLAUDE_CODE_OAUTH_TOKEN:-}}"

if [[ -z "$github_token" ]]; then
  echo "ARC_SELF_DRIVE_GITHUB_TOKEN must be exported in the current shell before running this installer." >&2
  exit 1
fi

if [[ "$github_token" == *$'\n'* ]]; then
  echo "ARC_SELF_DRIVE_GITHUB_TOKEN must be a single-line token." >&2
  exit 1
fi

install_gh_cli() {
  if command -v gh >/dev/null 2>&1; then
    return
  fi

  local os arch release_json version archive_name download_url install_root extracted_dir tmp_root
  os="linux"
  case "$(uname -m)" in
    x86_64 | amd64) arch="amd64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *)
      echo "Unsupported architecture for gh install: $(uname -m)" >&2
      exit 1
      ;;
  esac

  tmp_root="$(mktemp -d)"
  release_json="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest)"
  version="$(
    python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["tag_name"])' <<<"$release_json"
  )"
  archive_name="gh_${version#v}_${os}_${arch}.tar.gz"
  download_url="https://github.com/cli/cli/releases/download/${version}/${archive_name}"
  install_root="${HOME}/.local/lib/gh"

  mkdir -p "${HOME}/.local/bin" "$install_root"
  curl -fsSL "$download_url" -o "${tmp_root}/${archive_name}"
  tar -xzf "${tmp_root}/${archive_name}" -C "$tmp_root"
  extracted_dir="${tmp_root}/gh_${version#v}_${os}_${arch}"
  cp "${extracted_dir}/bin/gh" "${HOME}/.local/bin/gh"
  chmod +x "${HOME}/.local/bin/gh"
  rm -rf "$tmp_root"
}

github_https_push_url() {
  local fetch_url="$1"
  python3 - "$fetch_url" <<'PY'
import re
import sys

fetch_url = sys.argv[1].strip()
patterns = [
    r"^git@github\.com:(?P<repo>.+?)(?:\.git)?$",
    r"^ssh://git@github\.com/(?P<repo>.+?)(?:\.git)?$",
    r"^https://github\.com/(?P<repo>.+?)(?:\.git)?$",
]
for pattern in patterns:
    match = re.match(pattern, fetch_url)
    if match:
        repo = match.group("repo")
        print(f"https://github.com/{repo}.git")
        raise SystemExit(0)
raise SystemExit(1)
PY
}

github_repo_path() {
  local fetch_url="$1"
  python3 - "$fetch_url" <<'PY'
import re
import sys

fetch_url = sys.argv[1].strip()
patterns = [
    r"^git@github\.com:(?P<repo>.+?)(?:\.git)?$",
    r"^ssh://git@github\.com/(?P<repo>.+?)(?:\.git)?$",
    r"^https://github\.com/(?P<repo>.+?)(?:\.git)?$",
]
for pattern in patterns:
    match = re.match(pattern, fetch_url)
    if match:
        print(match.group("repo"))
        raise SystemExit(0)
raise SystemExit(1)
PY
}

configure_ssh_push_access() {
  local repo_path="$1"
  local ssh_dir="${HOME}/.ssh"
  local ssh_config="${ssh_dir}/config"
  local known_hosts="${ssh_dir}/known_hosts"

  if [[ ! -f "$ssh_key_path" ]]; then
    echo "SSH push transport requested, but no key exists at ${ssh_key_path}." >&2
    echo "Create a dedicated deploy key first or set ARC_SELF_DRIVE_GITHUB_PUSH_TRANSPORT=https." >&2
    exit 1
  fi

  mkdir -p "$ssh_dir"
  chmod 700 "$ssh_dir"
  touch "$known_hosts"
  chmod 600 "$known_hosts"
  if ! ssh-keygen -F github.com -f "$known_hosts" >/dev/null 2>&1; then
    ssh-keyscan -H github.com >>"$known_hosts" 2>/dev/null
  fi

  python3 - "$ssh_config" "$ssh_host_alias" "$ssh_key_path" <<'PY'
import pathlib
import sys

config_path = pathlib.Path(sys.argv[1]).expanduser()
host_alias = sys.argv[2]
identity_path = pathlib.Path(sys.argv[3]).expanduser()

block = (
    f"\nHost {host_alias}\n"
    "  HostName github.com\n"
    "  User git\n"
    f"  IdentityFile {identity_path}\n"
    "  IdentitiesOnly yes\n"
    "  StrictHostKeyChecking accept-new\n"
)

existing = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
start = f"Host {host_alias}\n"
if start in existing:
    before, _, tail = existing.partition(start)
    remainder = tail.split("\nHost ", 1)
    if len(remainder) == 2:
        _, rest = remainder
        existing = before + "\nHost " + rest
    else:
        existing = before.rstrip() + "\n"

config_path.write_text(existing.rstrip() + block + "\n", encoding="utf-8")
PY
  chmod 600 "$ssh_config"

  push_url="git@${ssh_host_alias}:${repo_path}.git"
}

mkdir -p "$env_dir"
chmod 700 "$env_dir"

python3 - "$env_file" "$claude_token" "$github_token" "$base_branch" "$remote_name" "$push_transport" "$ssh_host_alias" "$ssh_key_path" <<'PY'
import json
import pathlib
import sys

env_path = pathlib.Path(sys.argv[1])
claude_token = sys.argv[2]
github_token = sys.argv[3]
base_branch = sys.argv[4]
remote_name = sys.argv[5]
push_transport = sys.argv[6]
ssh_host_alias = sys.argv[7]
ssh_key_path = sys.argv[8]

lines = ["# Arc self-drive engine auth\n"]
if claude_token:
    lines.append(f"CLAUDE_CODE_OAUTH_TOKEN={json.dumps(claude_token)}\n")
lines.append(f"ARC_SELF_DRIVE_GITHUB_TOKEN={json.dumps(github_token)}\n")
lines.append(f"ARC_SELF_DRIVE_BASE_BRANCH={json.dumps(base_branch)}\n")
lines.append(f"ARC_SELF_DRIVE_GITHUB_REMOTE={json.dumps(remote_name)}\n")
lines.append(f"ARC_SELF_DRIVE_GITHUB_PUSH_TRANSPORT={json.dumps(push_transport)}\n")
lines.append(f"ARC_SELF_DRIVE_GITHUB_SSH_HOST_ALIAS={json.dumps(ssh_host_alias)}\n")
lines.append(f"ARC_SELF_DRIVE_GITHUB_SSH_KEY_PATH={json.dumps(ssh_key_path)}\n")
env_path.write_text("".join(lines), encoding="utf-8")
PY
chmod 600 "$env_file"

install_gh_cli

fetch_url="$(git -C "$ROOT_DIR" remote get-url "$remote_name")"
repo_path="$(github_repo_path "$fetch_url")"
case "$push_transport" in
  https)
    push_url="$(github_https_push_url "$fetch_url")"
    ;;
  ssh)
    configure_ssh_push_access "$repo_path"
    ;;
  *)
    echo "Unsupported ARC_SELF_DRIVE_GITHUB_PUSH_TRANSPORT: ${push_transport}" >&2
    exit 1
    ;;
esac
git -C "$ROOT_DIR" config "remote.${remote_name}.pushurl" "$push_url"
git -C "$ROOT_DIR" config arc.selfDriveBaseBranch "$base_branch"
git -C "$ROOT_DIR" fetch "$remote_name" "$base_branch" --prune >/dev/null 2>&1 || true
git -C "$ROOT_DIR" remote set-head "$remote_name" "$base_branch" >/dev/null 2>&1 || true

printf '%s' "$github_token" | gh auth login --hostname github.com --with-token
gh auth setup-git --hostname github.com >/dev/null

systemctl --user daemon-reload
systemctl --user restart openclaw-gateway.service
systemctl --user restart arc-self-drive.timer

echo "Persisted Arc draft PR auth to ${env_file}"
bash "$ROOT_DIR/scripts/arc-self-drive/healthcheck.sh"
