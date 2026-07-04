import type { Browser, Page, Response } from "playwright";
import type { WallpaperItemDetails, WallpaperResult } from "../types/index.ts";
import { withMutedBackendLogs } from "./silencer.ts";
import {
  assertSuccessfulNavigation,
  buildSearchUrl,
  ensurePlaywrightEnv,
  getLaunchOptions,
  getRetryDefaults,
  parseSearchResults,
  withRetry,
} from "./utils.ts";

export {
  buildSearchUrl,
} from "./utils.ts";
export type { WallpaperItemDetails, WallpaperResult } from "../types/index.ts";

const NAVIGATION_TIMEOUT_MS = 30_000;
const SEARCH_RESULTS_SELECTOR = "article.entry-tpl-grid";
const POPUP_TIMEOUT_MS = 2_500;
const DOWNLOAD_BUTTON_CLICK_TIMEOUT_MS = 2_000;
const POST_CLICK_SETTLE_MS = 1_500;
const VIDEO_URL_PATTERN = /https?:\/\/[^\s"'\\]+?\.(?:mp4|webm|mkv|mov|zip)(?:\?[^\s"'\\]*)?/gi;
const GENERIC_URL_PATTERN = /https?:\/\/[^\s"'\\<>]+/gi;
const FILE_SIZE_PATTERN = /(?:file\s*size|size)\s*[:|-]?\s*([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)/i;
const TITLE_PATTERN = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
const OG_IMAGE_PATTERN = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i;
const TAG_PATTERN = /<a[^>]+rel=["']tag["'][^>]*>([\s\S]*?)<\/a>/gi;
const DOWNLOAD_LINK_PATTERN =
  /<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?Download Wallpaper[\s\S]*?<\/a>/i;
const DOWNLOAD_ONCLICK_PATTERN =
  /<(?:a|button)[^>]+onclick=["']([^"']+)["'][^>]*>[\s\S]*?Download Wallpaper[\s\S]*?<\/(?:a|button)>/i;
const DOWNLOAD_DATA_URL_PATTERN = /data-url=["']([^"']+)["']/i;
const DOWNLOAD_VIDEO_PARAM_PATTERN = /(?:^|[?&]video=)([A-Za-z0-9%._+-]{16,})/i;
const RESOLUTION_PATTERN = /(\d{3,5})\s*x\s*(\d{3,5})/gi;
const LINK_CLICK_PAYLOAD_PATTERN =
  /action=link_click_counter(?:&amp;|&)nonce=([a-z0-9]+)(?:&amp;|&)post_id=(\d+)/i;
const NONCE_PATTERN = /(?:nonce=|["']nonce["']\s*[:=]\s*["'])([a-z0-9]{8,})/i;
const POST_ID_PATTERN = /(?:post_id=|["']post_id["']\s*[:=]\s*["']?)(\d{2,})/i;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const WHITESPACE_PATTERN = /\s+/g;

function parseFileSizeLabel(label: string): number | undefined {
  const match = label.match(/([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const unit = match[2].toUpperCase();
  const multiplier = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  return Math.round(value * multiplier);
}

function pickLikelyDownloadUrl(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const cleaned = candidate
      .replaceAll("\\/", "/")
      .replace(/^["']|["']$/g, "");
    if (/^https?:\/\//i.test(cleaned) && VIDEO_URL_PATTERN.test(cleaned)) {
      VIDEO_URL_PATTERN.lastIndex = 0;
      return cleaned;
    }
    if (/^https?:\/\//i.test(cleaned) && /\/download\//i.test(cleaned)) {
      VIDEO_URL_PATTERN.lastIndex = 0;
      return cleaned;
    }
    VIDEO_URL_PATTERN.lastIndex = 0;
  }
  return undefined;
}

function stripTags(input: string): string {
  return input.replace(HTML_TAG_PATTERN, " ").replace(WHITESPACE_PATTERN, " ").trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function extractAjaxPayload(html: string, onclickRaw?: string): {
  nonce?: string;
  postId?: string;
} {
  const joined = `${html}\n${onclickRaw ?? ""}`;
  const clickPayload = joined.match(LINK_CLICK_PAYLOAD_PATTERN);
  if (clickPayload?.[1] && clickPayload[2]) {
    return { nonce: clickPayload[1], postId: clickPayload[2] };
  }
  const nonce = joined.match(NONCE_PATTERN)?.[1];
  const postId = joined.match(POST_ID_PATTERN)?.[1];
  return { nonce, postId };
}

function extractUrls(text: string): string[] {
  return Array.from(text.matchAll(GENERIC_URL_PATTERN)).map((match) =>
    match[0].replaceAll("\\/", "/"),
  );
}

function extractDownloadToken(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const raw = candidate.trim();
    const dataUrlMatch = raw.match(/^url=([A-Za-z0-9%._+-]{16,})$/i);
    if (dataUrlMatch?.[1]) {
      return dataUrlMatch[1];
    }
    const videoMatch = raw.match(DOWNLOAD_VIDEO_PARAM_PATTERN);
    if (videoMatch?.[1]) {
      return videoMatch[1];
    }
    if (
      /^[A-Za-z0-9%._+-]{24,}$/.test(raw) &&
      !raw.startsWith("http") &&
      raw.includes("%")
    ) {
      return raw;
    }
  }
  return undefined;
}

function extractStringLeaves(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      extractStringLeaves(item, output);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      extractStringLeaves(nested, output);
    }
  }
}

function extractWallpaperResolution(
  tags: readonly string[],
  text: string,
): { width: number; height: number; label: string } | undefined {
  const candidates = [...tags, text];
  let best: { width: number; height: number } | undefined;

  for (const source of candidates) {
    let match: RegExpExecArray | null;
    RESOLUTION_PATTERN.lastIndex = 0;
    while ((match = RESOLUTION_PATTERN.exec(source)) !== null) {
      const width = Number.parseInt(match[1] ?? "", 10);
      const height = Number.parseInt(match[2] ?? "", 10);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        continue;
      }
      if (width < 320 || height < 180) {
        continue;
      }
      if (!best || width * height > best.width * best.height) {
        best = { width, height };
      }
    }
  }

  if (!best) {
    return undefined;
  }
  return {
    width: best.width,
    height: best.height,
    label: `${best.width}x${best.height}`,
  };
}

async function getChromium() {
  ensurePlaywrightEnv();
  const { chromium } = await import("playwright");
  return chromium;
}

export class MoewallsBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async launch(): Promise<void> {
    await withMutedBackendLogs(() =>
      withRetry(async () => {
        if (this.browser) {
          return;
        }

        const chromium = await getChromium();
        this.browser = await chromium.launch(getLaunchOptions());
        this.page = await this.browser.newPage();
      }),
    );
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async searchWallpapers(query: string, page = 1): Promise<WallpaperResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const { maxRetries } = getRetryDefaults();

    return withMutedBackendLogs(() =>
      withRetry(
        async () => {
          await this.ensurePage();
          const pageHandle = this.page!;
          const url = buildSearchUrl(trimmedQuery, page);
          let response: Response | null;

          try {
            response = await pageHandle.goto(url, {
              waitUntil: "networkidle",
              timeout: NAVIGATION_TIMEOUT_MS,
            });
          } catch {
            response = await pageHandle.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: NAVIGATION_TIMEOUT_MS,
            });
            await pageHandle.waitForSelector(SEARCH_RESULTS_SELECTOR, {
              timeout: NAVIGATION_TIMEOUT_MS,
            });
          }

          assertSuccessfulNavigation(response?.status(), url);

          const html = await pageHandle.content();
          const results = parseSearchResults(html);

          if (results.length === 0) {
            if (page > 1) {
              return [];
            }
            throw new Error(
              `No search results parsed for query "${trimmedQuery}"`,
            );
          }

          return results;
        },
        { maxRetries },
      ),
    );
  }

  async fetchWallpaperItemDetails(itemUrl: string): Promise<WallpaperItemDetails> {
    const { maxRetries } = getRetryDefaults();
    const normalizedUrl = itemUrl.trim();
    if (!normalizedUrl) {
      throw new Error("Missing wallpaper item URL");
    }

    return withMutedBackendLogs(() =>
      withRetry(
        async () => {
          await this.ensurePage();
          const pageHandle = this.page!;
          let response: Response | null;

          try {
            response = await pageHandle.goto(normalizedUrl, {
              waitUntil: "networkidle",
              timeout: NAVIGATION_TIMEOUT_MS,
            });
          } catch {
            response = await pageHandle.goto(normalizedUrl, {
              waitUntil: "domcontentloaded",
              timeout: NAVIGATION_TIMEOUT_MS,
            });
          }

          assertSuccessfulNavigation(response?.status(), normalizedUrl);

          const html = await pageHandle.content();
          const text = stripTags(html);
          const title = decodeHtmlEntities(
            stripTags(html.match(TITLE_PATTERN)?.[1] ?? "Wallpaper"),
          );
          const previewImageUrl = html.match(OG_IMAGE_PATTERN)?.[1];
          const tags = Array.from(html.matchAll(TAG_PATTERN))
            .map((match) => decodeHtmlEntities(stripTags(match[1] ?? "")))
            .filter(Boolean);

          const fileSizeMatch = text.match(FILE_SIZE_PATTERN);
          const fileSizeLabel = fileSizeMatch
            ? `${fileSizeMatch[1] ?? ""} ${(fileSizeMatch[2] ?? "").toUpperCase()}`.trim()
            : undefined;
          const fileSizeBytes = fileSizeLabel ? parseFileSizeLabel(fileSizeLabel) : undefined;
          const wallpaperResolution = extractWallpaperResolution(tags, text);

          const htmlCandidates = Array.from(html.matchAll(VIDEO_URL_PATTERN)).map(
            (match) => match[0],
          );
          const buttonCandidates = await pageHandle.evaluate(() => {
            const entries: string[] = [];
            const doc = (globalThis as { document?: any }).document;
            if (!doc) {
              return entries;
            }
            const elements = Array.from(
              doc.querySelectorAll("a, button, [role='button']"),
            );
            for (const element of elements) {
              const node = element as any;
              const label = String(node?.textContent ?? "").trim().toLowerCase();
              if (!label.includes("download")) {
                continue;
              }
              const anchorHref =
                node?.tagName === "A" ? String(node?.href ?? "") : "";
              entries.push(anchorHref);
              entries.push(node?.getAttribute?.("href") ?? "");
              entries.push(node?.getAttribute?.("onclick") ?? "");
              entries.push(node?.getAttribute?.("data-url") ?? "");
              entries.push(node?.getAttribute?.("data-href") ?? "");
              entries.push(node?.getAttribute?.("data-download") ?? "");
              const dataset = node?.dataset ?? {};
              for (const [key, value] of Object.entries(dataset)) {
                entries.push(`${key}=${value ?? ""}`);
              }
            }
            return entries.filter(Boolean);
          });

          const directCandidates = [
            html.match(DOWNLOAD_LINK_PATTERN)?.[1] ?? "",
            html.match(DOWNLOAD_ONCLICK_PATTERN)?.[1] ?? "",
            ...buttonCandidates,
          ].filter(Boolean);
          let downloadUrl = pickLikelyDownloadUrl([
            ...directCandidates,
            ...htmlCandidates,
          ]);

          if (!downloadUrl) {
            const preferredToken = await pageHandle.evaluate(() => {
              const doc = (globalThis as { document?: any }).document;
              if (!doc) {
                return "";
              }
              const primary = doc.querySelector("#moe-download");
              const primaryToken = primary?.getAttribute?.("data-url");
              if (primaryToken) {
                return primaryToken;
              }
              const fallback = doc.querySelector(".lcc-wall[data-url]");
              return fallback?.getAttribute?.("data-url") ?? "";
            });
            const htmlToken = html.match(DOWNLOAD_DATA_URL_PATTERN)?.[1];
            const token = extractDownloadToken([
              ...(preferredToken ? [preferredToken] : []),
              ...(htmlToken ? [htmlToken] : []),
              ...directCandidates,
            ]);
            if (token) {
              downloadUrl = `https://go.moewalls.com/download.php?video=${token}`;
            }
          }

          if (!downloadUrl) {
            const intercepted = new Set<string>();
            const responseTextCandidates: string[] = [];
            const responseTextTasks: Promise<void>[] = [];
            const listener = (resp: Response) => {
              const url = resp.url();
              const contentType = resp.headers()["content-type"]?.toLowerCase() ?? "";
              if (
                /\.(?:mp4|webm|mkv|mov|zip)(?:$|\?)/i.test(url) ||
                contentType.includes("video/") ||
                contentType.includes("application/octet-stream")
              ) {
                intercepted.add(url);
              }
              if (url.includes("/wp-admin/admin-ajax.php")) {
                responseTextTasks.push(
                  resp
                    .text()
                    .then((body) => {
                      responseTextCandidates.push(body);
                    })
                    .catch(() => {}),
                );
              }
            };

            pageHandle.on("response", listener);
            try {
              const button = pageHandle.locator(
                'a:has-text("Download Wallpaper"), button:has-text("Download Wallpaper"), .btn-success, .btn-download',
              ).first();
              let popupUrl: string | undefined;
              const popupPromise = pageHandle
                .waitForEvent("popup", { timeout: POPUP_TIMEOUT_MS })
                .then(async (popup) => {
                  try {
                    await popup.waitForLoadState("domcontentloaded", {
                      timeout: POPUP_TIMEOUT_MS,
                    });
                  } catch {}
                  const resolvedUrl = popup.url();
                  await popup.close().catch(() => {});
                  return resolvedUrl;
                })
                .catch(() => undefined);

              if (await button.count()) {
                await button.click({ timeout: DOWNLOAD_BUTTON_CLICK_TIMEOUT_MS }).catch(() => {});
                await pageHandle.waitForTimeout(POST_CLICK_SETTLE_MS);
              }
              popupUrl = await popupPromise;

              await Promise.all(responseTextTasks);
              if (popupUrl) {
                intercepted.add(popupUrl);
              }

              const ajaxClick = [
                html.match(DOWNLOAD_ONCLICK_PATTERN)?.[1] ?? "",
                ...buttonCandidates,
              ].join("\n");
              const payload = extractAjaxPayload(html, ajaxClick);
              if (payload.nonce && payload.postId) {
                const ajaxUrl = new URL("/wp-admin/admin-ajax.php", normalizedUrl).toString();
                const origin = new URL(normalizedUrl).origin;
                const ajaxResponse = await pageHandle.request.post(ajaxUrl, {
                  headers: {
                    accept: "*/*",
                    origin,
                    referer: normalizedUrl,
                    "x-requested-with": "XMLHttpRequest",
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                  },
                  form: {
                    action: "link_click_counter",
                    nonce: payload.nonce,
                    post_id: payload.postId,
                  },
                });
                const ajaxText = await ajaxResponse.text().catch(() => "");
                responseTextCandidates.push(ajaxText);
                const ajaxJson = await ajaxResponse.json().catch(() => undefined);
                if (ajaxJson) {
                  const jsonLeaves: string[] = [];
                  extractStringLeaves(ajaxJson, jsonLeaves);
                  responseTextCandidates.push(...jsonLeaves);
                }
              }

              const extractedFromAjax = responseTextCandidates.flatMap(extractUrls);
              downloadUrl = pickLikelyDownloadUrl([
                ...Array.from(intercepted),
                ...extractedFromAjax,
              ]);
            } finally {
              pageHandle.off("response", listener);
            }
          }

          return {
            title: title || "Wallpaper",
            itemUrl: normalizedUrl,
            previewImageUrl,
            tags,
            fileSizeLabel,
            fileSizeBytes,
            downloadUrl,
            wallpaperResolution,
          };
        },
        { maxRetries },
      ),
    );
  }

  private async ensurePage(): Promise<void> {
    if (!this.browser || !this.page) {
      await this.launch();
    }
  }
}
