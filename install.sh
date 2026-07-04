#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
TARGET_BIN="${BIN_DIR}/moewalls"
TEMP_BIN="${ROOT_DIR}/dist/moewalls"
PLAYWRIGHT_BROWSERS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/moewalls-cli/playwright-browsers"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to install moewalls-cli."
  echo "Install Bun first: https://bun.sh/"
  exit 1
fi

cd "${ROOT_DIR}"

mkdir -p "${BIN_DIR}" "${ROOT_DIR}/dist"

echo "Building production bundle..."
bun run build

echo "Compiling production binary..."
bun run build:binary

if [[ "${MOEWALLS_SKIP_BROWSER_INSTALL:-0}" != "1" ]]; then
  echo "Installing Playwright Chromium runtime..."
  PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_DIR}" bun run install:browsers
else
  echo "Skipping browser install (MOEWALLS_SKIP_BROWSER_INSTALL=1)."
fi

install -m 755 "${TEMP_BIN}" "${TARGET_BIN}"

echo
echo "Installed: ${TARGET_BIN}"
echo "Playwright browsers: ${PLAYWRIGHT_BROWSERS_DIR}"
if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
  echo "Warning: ${BIN_DIR} is not in PATH."
  echo "Add this to your shell profile:"
  echo "  export PATH=\"${BIN_DIR}:\$PATH\""
fi
echo "Run with: moewalls"
