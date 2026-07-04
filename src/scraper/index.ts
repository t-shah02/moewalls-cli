import type { Browser, Page, Response } from "playwright";
import type { WallpaperItemDetails, WallpaperResult } from "../types/index.ts";
import { withMutedBackendLogs } from "./silencer.ts";
import {
  extractAjaxPayload,
  extractDirectDownloadCandidates,
  extractDownloadOnclick,
  extractDownloadToken,
  extractInlineDownloadDataUrl,
  extractStringLeaves,
  extractUrls,
  extractVideoUrlCandidates,
  parseWallpaperMeta,
  pickLikelyDownloadUrl,
} from "./html-parser.ts";
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
const DOWNLOAD_BUTTON_SELECTOR =
  'a:has-text("Download Wallpaper"), button:has-text("Download Wallpaper"), .btn-success, .btn-download';

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
          const response = await this.navigateToItemPage(pageHandle, normalizedUrl);

          assertSuccessfulNavigation(response?.status(), normalizedUrl);

          const html = await pageHandle.content();
          const {
            title,
            previewImageUrl,
            tags,
            fileSizeLabel,
            fileSizeBytes,
            wallpaperResolution,
          } = parseWallpaperMeta(html);
          const buttonCandidates = await this.collectButtonDownloadCandidates(pageHandle);
          const downloadUrl = await this.resolveWallpaperDownloadUrl({
            pageHandle,
            html,
            buttonCandidates,
            normalizedUrl,
          });

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

  private async navigateToItemPage(
    pageHandle: Page,
    url: string,
  ): Promise<Response | null> {
    try {
      return await pageHandle.goto(url, {
        waitUntil: "networkidle",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch {
      return pageHandle.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    }
  }

  private async collectButtonDownloadCandidates(pageHandle: Page): Promise<string[]> {
    return pageHandle.evaluate(() => {
      const entries: string[] = [];
      const doc = (globalThis as { document?: any }).document;
      if (!doc) {
        return entries;
      }
      const elements = Array.from(doc.querySelectorAll("a, button, [role='button']"));
      for (const element of elements) {
        const node = element as any;
        const label = String(node?.textContent ?? "").trim().toLowerCase();
        if (!label.includes("download")) {
          continue;
        }
        const anchorHref = node?.tagName === "A" ? String(node?.href ?? "") : "";
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
  }

  private async resolveWallpaperDownloadUrl({
    pageHandle,
    html,
    buttonCandidates,
    normalizedUrl,
  }: Readonly<{
    pageHandle: Page;
    html: string;
    buttonCandidates: readonly string[];
    normalizedUrl: string;
  }>): Promise<string | undefined> {
    const htmlCandidates = extractVideoUrlCandidates(html);
    const directCandidates = extractDirectDownloadCandidates(html, buttonCandidates);

    const directUrl = pickLikelyDownloadUrl([...directCandidates, ...htmlCandidates]);
    if (directUrl) {
      return directUrl;
    }

    const tokenUrl = await this.resolveDownloadUrlFromToken({
      pageHandle,
      html,
      directCandidates,
    });
    if (tokenUrl) {
      return tokenUrl;
    }

    return this.resolveDownloadUrlFromNetworkFallback({
      pageHandle,
      html,
      buttonCandidates,
      normalizedUrl,
    });
  }

  private async resolveDownloadUrlFromToken({
    pageHandle,
    html,
    directCandidates,
  }: Readonly<{
    pageHandle: Page;
    html: string;
    directCandidates: readonly string[];
  }>): Promise<string | undefined> {
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
    const htmlToken = extractInlineDownloadDataUrl(html);
    const token = extractDownloadToken([
      ...(preferredToken ? [preferredToken] : []),
      ...(htmlToken ? [htmlToken] : []),
      ...directCandidates,
    ]);
    if (!token) {
      return undefined;
    }
    return `https://go.moewalls.com/download.php?video=${token}`;
  }

  private async resolveDownloadUrlFromNetworkFallback({
    pageHandle,
    html,
    buttonCandidates,
    normalizedUrl,
  }: Readonly<{
    pageHandle: Page;
    html: string;
    buttonCandidates: readonly string[];
    normalizedUrl: string;
  }>): Promise<string | undefined> {
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
      const button = pageHandle.locator(DOWNLOAD_BUTTON_SELECTOR).first();
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
      const popupUrl = await popupPromise;

      await Promise.all(responseTextTasks);
      if (popupUrl) {
        intercepted.add(popupUrl);
      }

      const ajaxClick = [
        extractDownloadOnclick(html) ?? "",
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
      return pickLikelyDownloadUrl([
        ...Array.from(intercepted),
        ...extractedFromAjax,
      ]);
    } finally {
      pageHandle.off("response", listener);
    }
  }

  private async ensurePage(): Promise<void> {
    if (!this.browser || !this.page) {
      await this.launch();
    }
  }
}
