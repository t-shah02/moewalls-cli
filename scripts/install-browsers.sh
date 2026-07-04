#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_PLAYWRIGHT_BROWSERS_PATH="${XDG_DATA_HOME:-$HOME/.local/share}/moewalls-cli/playwright-browsers"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$DEFAULT_PLAYWRIGHT_BROWSERS_PATH}"
export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS="${PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS:-true}"

if [[ -f /etc/os-release ]] && grep -qi '^ID=arch' /etc/os-release; then
  echo "Arch Linux detected."
  echo "If Chromium fails to launch, install system libraries:"
  echo "  sudo pacman -S --needed nss nspr atk cups libxcomposite libxrandr libxdamage \\"
  echo "    libxkbcommon libxfixes libxext libxshmfence mesa alsa-lib pango cairo gtk3 \\"
  echo "    libdrm libxcb libx11 libxss libxtst"
fi

mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
cd "$ROOT"

echo "Installing Chromium to $PLAYWRIGHT_BROWSERS_PATH ..."
bunx playwright install chromium

cat > "$ROOT/.env.example" <<EOF
PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
MOEWALLS_BASE_URL=https://moewalls.com/
MOEWALLS_SCRAPER_MAX_RETRIES=3
MOEWALLS_SCRAPER_RETRY_DELAY_MS=1000
MOEWALLS_PREVIEW_PROTOCOL=
EOF

EXEC_PATH="$(bun -e "
  process.env.PLAYWRIGHT_BROWSERS_PATH = '$PLAYWRIGHT_BROWSERS_PATH';
  const { chromium } = await import('playwright');
  console.log(chromium.executablePath());
")"

echo "Chromium executable: $EXEC_PATH"
