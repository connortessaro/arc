#!/usr/bin/env bash
# shellcheck shell=bash

# Prefer the full Xcode toolchain for macOS app builds when the active
# developer directory is Command Line Tools. SwiftUI macro/plugin packages in
# this repo require Xcode's SDK/toolchain layout.

if [[ -n "${DEVELOPER_DIR:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi

XCODE_APP_PATH="${OPENCLAW_XCODE_APP:-/Applications/Xcode.app}"
XCODE_DEVELOPER_DIR="${XCODE_APP_PATH}/Contents/Developer"
CURRENT_DEVELOPER_DIR="$(xcode-select -p 2>/dev/null || true)"

if [[ -d "${XCODE_DEVELOPER_DIR}" && ( -z "${CURRENT_DEVELOPER_DIR}" || "${CURRENT_DEVELOPER_DIR}" == /Library/Developer/CommandLineTools* ) ]]; then
  export DEVELOPER_DIR="${XCODE_DEVELOPER_DIR}"
  printf '==> Using Xcode developer dir: %s\n' "${DEVELOPER_DIR}" >&2
fi

