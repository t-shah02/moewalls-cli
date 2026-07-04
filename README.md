# moewalls-cli

Terminal UI for searching live wallpapers from [moewalls.com](https://moewalls.com/).

## Setup

```bash
bun install
bun run install:browsers   # or: ./scripts/install-browsers.sh
cp .env.example .env       # optional overrides
```

By default browsers are installed to `~/.local/share/moewalls-cli/playwright-browsers`.

On Arch Linux, Playwright downloads an Ubuntu fallback Chromium build. If launch fails, install the system libraries printed by the install script.

## Run

```bash
bun run start
```

## Install command

Build and install a production executable to `~/.local/bin/moewalls`:

```bash
./install.sh
```

After install, run:

```bash
moewalls
```

`install.sh` also installs the Playwright Chromium runtime to
`~/.local/share/moewalls-cli/playwright-browsers` (set `MOEWALLS_SKIP_BROWSER_INSTALL=1`
to skip).

`MOEWALLS_RUNTIME_MODE` controls runtime behavior:

- `development` / `dev`: shows debug log path on startup
- `production`: hides debug log path for cleaner UX (default)

`MOEWALLS_PREVIEW_PROTOCOL` can force image rendering protocol:

- `kitty`: force Kitty graphics mode (recommended for Ghostty if auto-detection is flaky)

If the app exits immediately, check the debug log:

```bash
tail -f ~/.local/state/moewalls-cli/debug.log
```

- Type in the search bar to find wallpapers (debounced)
- `↑` / `↓` browse results
- `Tab` toggles focus between search and results
- `PgUp` / `PgDn` change result pages (always)
- `[` / `]` or `←` / `→` also change pages when results are focused
- `Enter` opens the selected item detail pane
- `d` downloads the selected wallpaper from the detail pane
- `s` sets the downloaded wallpaper as KDE live wallpaper via Smart Video Wallpaper Reborn
- `o` opens the downloaded file (or remote URL) with the default app
- `b` closes the detail pane and returns to list focus

## Scraper module

Headless Playwright scraper used by the TUI:

```typescript
import { MoewallsBrowser } from "./src/scraper/index.ts";

const browser = new MoewallsBrowser();
await browser.launch();
const results = await browser.searchWallpapers("anime", 2);
await browser.close();
```
