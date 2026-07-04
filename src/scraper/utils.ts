import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LaunchOptions, Logger } from "playwright";
import type { RetryOptions, WallpaperResult } from "../types/index.ts";

export const MOEWALLS_BASE_URL =
  process.env.MOEWALLS_BASE_URL ?? "https://moewalls.com/";

const DEFAULT_SCRAPER_MAX_RETRIES = 3;
const DEFAULT_SCRAPER_RETRY_DELAY_MS = 1_000;
const DEFAULT_PLAYWRIGHT_BROWSERS_SUBDIR = join(
  "moewalls-cli",
  "playwright-browsers",
);

function defaultPlaywrightBrowsersPath(): string {
  const home = process.env.HOME?.trim();
  if (!home) {
    return join(process.cwd(), ".playwright-browsers");
  }
  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  const baseDir =
    xdgDataHome && xdgDataHome.length > 0
      ? xdgDataHome
      : join(home, ".local", "share");
  return join(baseDir, DEFAULT_PLAYWRIGHT_BROWSERS_SUBDIR);
}

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = defaultPlaywrightBrowsersPath();
}
if (!process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS) {
  process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
}

export function resolveBrowsersPath(): string {
  return (
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? defaultPlaywrightBrowsersPath()
  );
}

export function ensurePlaywrightEnv(): void {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = resolveBrowsersPath();
  }
  mkdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH, { recursive: true });
  if (!process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS) {
    process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
  }
}

export function resolveExecutablePath(): string | undefined {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (override) {
    return override;
  }
  return undefined;
}

const silentPlaywrightLogger: Logger = {
  isEnabled: () => false,
  log: () => {},
};

export function getLaunchOptions(): LaunchOptions {
  const executablePath = resolveExecutablePath();
  return {
    headless: true,
    logger: silentPlaywrightLogger,
    ...(executablePath ? { executablePath } : {}),
  };
}

export function buildSearchUrl(query: string, page = 1): string {
  const base = MOEWALLS_BASE_URL.endsWith("/")
    ? MOEWALLS_BASE_URL
    : `${MOEWALLS_BASE_URL}/`;

  if (page <= 1) {
    const url = new URL(base);
    url.searchParams.set("s", query);
    return url.toString();
  }

  const url = new URL(`page/${page}/`, base);
  url.searchParams.set("s", query);
  return url.toString();
}

export function getRetryDefaults(): { maxRetries: number; delayMs: number } {
  const maxRetries = Number.parseInt(
    process.env.MOEWALLS_SCRAPER_MAX_RETRIES ??
      String(DEFAULT_SCRAPER_MAX_RETRIES),
    10,
  );
  const delayMs = Number.parseInt(
    process.env.MOEWALLS_SCRAPER_RETRY_DELAY_MS ??
      String(DEFAULT_SCRAPER_RETRY_DELAY_MS),
    10,
  );
  return {
    maxRetries:
      Number.isFinite(maxRetries) && maxRetries > 0
        ? maxRetries
        : DEFAULT_SCRAPER_MAX_RETRIES,
    delayMs:
      Number.isFinite(delayMs) && delayMs >= 0
        ? delayMs
        : DEFAULT_SCRAPER_RETRY_DELAY_MS,
  };
}

const ADVERTISEMENT_MARKER = "g1-advertisement";

const ARTICLE_CARD_PATTERN =
  /<article[^>]*class="[^"]*entry-tpl-grid[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
const ENTRY_TITLE_LINK_PATTERN =
  /<h3[^>]*class="[^"]*entry-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
const IMG_SRC_PATTERN = /<img[^>]+src="([^"]+)"/i;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const WHITESPACE_PATTERN = /\s+/g;

const ENTRY_VOTES_PATTERN =
  /<span class="entry-votes[^"]*"[^>]*>\s*<strong>(\d+)<\/strong>/i;
const ENTRY_CATEGORY_PATTERN =
  /<a[^>]+class="[^"]*entry-category[^"]*"[^>]*>([^<]+)<\/a>/i;
const HTML_ENTITY_AMP_PATTERN = /&amp;/g;
const HTML_ENTITY_QUOT_PATTERN = /&quot;/g;
const HTML_ENTITY_APOS_PATTERN = /&#39;/g;
const HTML_ENTITY_LT_PATTERN = /&lt;/g;
const HTML_ENTITY_GT_PATTERN = /&gt;/g;
const WP_THUMBNAIL_SIZE_SUFFIX_PATTERN =
  /-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp|avif)$)/i;

export class ScraperHttpError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "ScraperHttpError";
    this.retryable = status >= 500 && status < 600;
  }
}

export function isClientHttpStatus(status: number): boolean {
  return status >= 400 && status < 500;
}

export function isServerHttpStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

export function assertSuccessfulNavigation(
  status: number | undefined,
  url: string,
): void {
  if (!status || status < 400) {
    return;
  }

  throw new ScraperHttpError(status, url);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const defaults = getRetryDefaults();
  const maxRetries = options?.maxRetries ?? defaults.maxRetries;
  const delayMs = options?.delayMs ?? defaults.delayMs;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error instanceof ScraperHttpError && !error.retryable) {
        throw error;
      }
      if (attempt >= maxRetries) {
        break;
      }
      options?.onRetry?.(attempt, error);
      await Bun.sleep(delayMs * attempt);
    }
  }

  throw lastError;
}

export function parseSearchResults(html: string): WallpaperResult[] {
  const results: WallpaperResult[] = [];
  const seen = new Set<string>();

  ARTICLE_CARD_PATTERN.lastIndex = 0;

  let cardMatch: RegExpExecArray | null;
  while ((cardMatch = ARTICLE_CARD_PATTERN.exec(html)) !== null) {
    const cardHtml = cardMatch[1] ?? "";
    if (cardHtml.includes(ADVERTISEMENT_MARKER)) {
      continue;
    }

    const titleMatch = ENTRY_TITLE_LINK_PATTERN.exec(cardHtml);
    if (!titleMatch?.[1] || !titleMatch[2]) {
      continue;
    }

    const href = titleMatch[1];
    const title = stripTags(titleMatch[2]).trim();
    const imgMatch = IMG_SRC_PATTERN.exec(cardHtml);
    const votesMatch = ENTRY_VOTES_PATTERN.exec(cardHtml);
    const categoryMatch = ENTRY_CATEGORY_PATTERN.exec(cardHtml);
    const url = resolveAbsoluteUrl(href);

    if (!title || seen.has(url)) {
      continue;
    }

    seen.add(url);
    results.push({
      title: decodeHtmlEntities(title),
      url,
      votes: votesMatch?.[1] ? Number.parseInt(votesMatch[1], 10) : 0,
      category: categoryMatch?.[1]
        ? decodeHtmlEntities(categoryMatch[1].trim())
        : "Unknown",
      ...(imgMatch?.[1]
        ? {
            thumbnailUrl: normalizeThumbnailUrl(
              resolveAbsoluteUrl(imgMatch[1]),
            ),
          }
        : {}),
    });
  }

  return results;
}

function normalizeThumbnailUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(
      WP_THUMBNAIL_SIZE_SUFFIX_PATTERN,
      "",
    );
    return parsed.toString();
  } catch {
    return url.replace(WP_THUMBNAIL_SIZE_SUFFIX_PATTERN, "");
  }
}

function resolveAbsoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const base = MOEWALLS_BASE_URL.endsWith("/")
    ? MOEWALLS_BASE_URL
    : `${MOEWALLS_BASE_URL}/`;
  return new URL(pathOrUrl, base).toString();
}

function stripTags(html: string): string {
  return html.replace(HTML_TAG_PATTERN, " ").replace(WHITESPACE_PATTERN, " ");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(HTML_ENTITY_AMP_PATTERN, "&")
    .replace(HTML_ENTITY_QUOT_PATTERN, '"')
    .replace(HTML_ENTITY_APOS_PATTERN, "'")
    .replace(HTML_ENTITY_LT_PATTERN, "<")
    .replace(HTML_ENTITY_GT_PATTERN, ">");
}
