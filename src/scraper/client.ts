import type { MoewallsBrowser } from "./index.ts";
import { withMutedBackendLogs } from "./silencer.ts";
import { resolveBrowsersPath } from "./utils.ts";

let browser: MoewallsBrowser | null = null;
let browserReady = false;
let launchPromise: Promise<MoewallsBrowser> | null = null;

async function loadBrowserClass(): Promise<typeof MoewallsBrowser> {
  const module = await import("./index.ts");
  return module.MoewallsBrowser;
}

function withPlaywrightInstallHint(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  if (!error.message.includes("Executable doesn't exist")) {
    return error;
  }
  const browsersPath = resolveBrowsersPath();
  const hint =
    `\nInstall Playwright Chromium runtime:\n` +
    `PLAYWRIGHT_BROWSERS_PATH="${browsersPath}" bunx playwright install chromium`;
  return new Error(`${error.message}${hint}`);
}

export async function getScraperBrowser(): Promise<MoewallsBrowser> {
  if (browser && browserReady) {
    return browser;
  }

  if (!launchPromise) {
    launchPromise = withMutedBackendLogs(async () => {
      const { logger } = await import("../logger.ts");
      logger.debug("scraper: launching browser");

      try {
        const BrowserClass = await loadBrowserClass();
        const instance = new BrowserClass();
        await instance.launch();
        browser = instance;
        browserReady = true;
        logger.debug("scraper: browser ready");
        return instance;
      } catch (error) {
        const wrapped = withPlaywrightInstallHint(error);
        logger.error("scraper: launch failed", wrapped);
        throw wrapped;
      }
    }).catch((error) => {
      launchPromise = null;
      browser = null;
      browserReady = false;
      throw error;
    });
  }

  return launchPromise;
}

export async function closeScraperBrowser(): Promise<void> {
  if (!browser) {
    return;
  }

  const { logger } = await import("../logger.ts");
  logger.debug("scraper: closing browser");

  try {
    await browser.close();
  } catch (error) {
    logger.error("scraper: close failed", error);
  } finally {
    browser = null;
    browserReady = false;
    launchPromise = null;
  }
}

export function isScraperBrowserReady(): boolean {
  return browserReady;
}
