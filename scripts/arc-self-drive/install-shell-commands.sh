#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_BIN_DIR="${HOME}/.local/bin"
PROFILE_BLOCK_START="# >>> arc-shell-path >>>"
PROFILE_BLOCK_END="# <<< arc-shell-path <<<"

mkdir -p "${LOCAL_BIN_DIR}"

cat > "${LOCAL_BIN_DIR}/openclaw" <<EOF
#!/usr/bin/env bash
exec node --import tsx "${ROOT_DIR}/src/index.ts" "\$@"
EOF

cat > "${LOCAL_BIN_DIR}/arc" <<EOF
#!/usr/bin/env bash
exec "${ROOT_DIR}/scripts/arc-self-drive/arc.sh" "\$@"
EOF

chmod +x "${LOCAL_BIN_DIR}/openclaw" "${LOCAL_BIN_DIR}/arc"

ensure_shell_path() {
  local shell_file="$1"
  touch "$shell_file"
  if grep -Fq "${PROFILE_BLOCK_START}" "$shell_file"; then
    return
  fi

  cat >> "$shell_file" <<'EOF'
# >>> arc-shell-path >>>
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
case ":$PATH:" in
  *":$HOME/.npm-global/bin:"*) ;;
  *) export PATH="$HOME/.npm-global/bin:$PATH" ;;
esac
# <<< arc-shell-path <<<
EOF
}

ensure_shell_path "${HOME}/.profile"
ensure_shell_path "${HOME}/.bashrc"
ensure_shell_path "${HOME}/.zprofile"
ensure_shell_path "${HOME}/.zshrc"

echo "Installed arc and openclaw shims into ${LOCAL_BIN_DIR}"
