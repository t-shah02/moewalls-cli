import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { execFileSync, spawn } from "node:child_process";
import { useCallback } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { logger } from "../../logger.ts";
import { getScraperBrowser } from "../../scraper/client.ts";
import { FocusTarget } from "../../types/index.ts";
import type {
  MoewallsAppState,
  WallpaperItemDetails,
  WallpaperResult,
} from "../../types/index.ts";
import { DEFAULT_DOWNLOAD_EXTENSION, DOWNLOAD_DIRECTORY } from "./constants.ts";
import {
  extensionFromContentDisposition,
  extensionFromContentType,
  formatError,
  initialDownloadState,
  normalizeVideoExtension,
  sanitizeFileName,
} from "./helpers.ts";

type StateSetter = Dispatch<SetStateAction<MoewallsAppState>>;
type FocusSetter = Dispatch<SetStateAction<FocusTarget>>;
type ItemDetailsCache = Map<string, WallpaperItemDetails>;

type DetailActionDeps = Readonly<{
  state: MoewallsAppState;
  setState: StateSetter;
  setFocusTarget: FocusSetter;
  cacheQueryRef: RefObject<string>;
  itemDetailsCacheRef: RefObject<ItemDetailsCache>;
  detailsGenerationRef: RefObject<number>;
  resetPageCacheForQuery: (query: string) => void;
}>;

export function useDetailActions({
  state,
  setState,
  setFocusTarget,
  cacheQueryRef,
  itemDetailsCacheRef,
  detailsGenerationRef,
  resetPageCacheForQuery,
}: DetailActionDeps): {
  resetDetailView: () => void;
  openSelectedItemDetails: () => Promise<void>;
} {
  const resetDetailView = useCallback(() => {
    setFocusTarget(FocusTarget.Results);
    setState((previous) => ({
      ...previous,
      detailOpen: false,
      detailLoading: false,
      detailError: null,
      detailLoadDurationMs: null,
      detailItem: null,
      liveWallpaperStatus: null,
      download: initialDownloadState(),
    }));
  }, [setFocusTarget, setState]);

  const openSelectedItemDetails = useCallback(async () => {
    const selectedItem: WallpaperResult | undefined =
      state.results[state.selectedIndex];
    const activeQuery = state.debouncedQuery.trim();
    if (!selectedItem || !activeQuery) {
      return;
    }

    if (activeQuery !== cacheQueryRef.current) {
      resetPageCacheForQuery(activeQuery);
    }

    setFocusTarget(FocusTarget.Detail);
    const cached = itemDetailsCacheRef.current.get(selectedItem.url);
    if (cached) {
      setState((previous) => ({
        ...previous,
        detailOpen: true,
        detailLoading: false,
        detailError: null,
        detailLoadDurationMs: 0,
        detailItem: cached,
        liveWallpaperStatus: null,
        download: initialDownloadState(),
      }));
      return;
    }

    const generation = ++detailsGenerationRef.current;
    const startedAt = Date.now();
    setState((previous) => ({
      ...previous,
      detailOpen: true,
      detailLoading: true,
      detailError: null,
      detailLoadDurationMs: null,
      detailItem: null,
      liveWallpaperStatus: null,
      download: initialDownloadState(),
    }));

    try {
      const browser = await getScraperBrowser();
      const details = await browser.fetchWallpaperItemDetails(selectedItem.url);
      if (generation !== detailsGenerationRef.current) {
        return;
      }

      const merged: WallpaperItemDetails = {
        ...details,
        previewImageUrl: details.previewImageUrl ?? selectedItem.thumbnailUrl,
      };
      itemDetailsCacheRef.current.set(selectedItem.url, merged);
      setState((previous) => ({
        ...previous,
        detailOpen: true,
        detailLoading: false,
        detailError: null,
        detailLoadDurationMs: Date.now() - startedAt,
        detailItem: merged,
        liveWallpaperStatus: null,
        download: initialDownloadState(),
      }));
    } catch (error) {
      if (generation !== detailsGenerationRef.current) {
        return;
      }
      setState((previous) => ({
        ...previous,
        detailOpen: true,
        detailLoading: false,
        detailError: formatError(error),
        detailLoadDurationMs: Date.now() - startedAt,
        detailItem: null,
        liveWallpaperStatus: null,
        download: initialDownloadState(),
      }));
    }
  }, [
    cacheQueryRef,
    detailsGenerationRef,
    itemDetailsCacheRef,
    resetPageCacheForQuery,
    setFocusTarget,
    setState,
    state.debouncedQuery,
    state.results,
    state.selectedIndex,
  ]);

  return { resetDetailView, openSelectedItemDetails };
}

type DownloadActionDeps = Readonly<{
  state: MoewallsAppState;
  setState: StateSetter;
}>;

export function useDownloadAction({
  state,
  setState,
}: DownloadActionDeps): () => Promise<void> {
  return useCallback(async () => {
    const detail = state.detailItem;
    if (state.download.status === "downloading") {
      return;
    }
    if (!detail?.downloadUrl) {
      setState((previous) => ({
        ...previous,
        download: {
          ...previous.download,
          status: "error",
          error: "No downloadable file URL found on this item page.",
        },
      }));
      return;
    }

    mkdirSync(DOWNLOAD_DIRECTORY, { recursive: true });
    const baseName = sanitizeFileName(detail.title);
    let targetPath = join(DOWNLOAD_DIRECTORY, basename(`${baseName}.mp4`));

    setState((previous) => ({
      ...previous,
      download: {
        status: "downloading",
        targetPath,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
      },
    }));

    try {
      const response = await fetch(detail.downloadUrl);
      if (!response.ok || !response.body) {
        throw new Error(`Download failed (${response.status})`);
      }

      const resolvedUrlPath = new URL(response.url).pathname;
      const extension =
        extensionFromContentDisposition(
          response.headers.get("content-disposition"),
        ) ??
        extensionFromContentType(response.headers.get("content-type")) ??
        normalizeVideoExtension(extname(resolvedUrlPath)) ??
        DEFAULT_DOWNLOAD_EXTENSION;
      targetPath = join(
        DOWNLOAD_DIRECTORY,
        basename(`${baseName}${extension}`),
      );
      setState((previous) => ({
        ...previous,
        download: {
          ...previous.download,
          targetPath,
        },
      }));

      const contentLengthHeader = response.headers.get("content-length");
      const totalBytes = contentLengthHeader
        ? Number.parseInt(contentLengthHeader, 10)
        : null;
      setState((previous) => ({
        ...previous,
        download: {
          ...previous.download,
          totalBytes:
            totalBytes && Number.isFinite(totalBytes) && totalBytes > 0
              ? totalBytes
              : null,
        },
      }));

      const writable = createWriteStream(targetPath);
      const stream = Readable.fromWeb(
        response.body as globalThis.ReadableStream<Uint8Array>,
      );
      let downloadedBytes = 0;

      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        downloadedBytes += buffer.length;
        writable.write(buffer);
        setState((previous) => ({
          ...previous,
          download: {
            ...previous.download,
            downloadedBytes,
          },
        }));
      }

      await new Promise<void>((resolve, reject) => {
        writable.once("finish", () => resolve());
        writable.once("error", (error) => reject(error));
        writable.end();
      });

      setState((previous) => ({
        ...previous,
        download: {
          ...previous.download,
          status: "done",
          error: null,
        },
      }));
      logger.debug("download complete", { targetPath, bytes: downloadedBytes });
    } catch (error) {
      logger.error("download failed", error);
      setState((previous) => ({
        ...previous,
        download: {
          ...previous.download,
          status: "error",
          error: formatError(error),
        },
      }));
    }
  }, [setState, state.detailItem, state.download.status]);
}

type OpenMediaDeps = Readonly<{
  state: MoewallsAppState;
  setState: StateSetter;
}>;

export function useOpenMediaAction({
  state,
  setState,
}: OpenMediaDeps): () => Promise<void> {
  return useCallback(async () => {
    const target = state.download.targetPath && state.download.status === "done"
      ? state.download.targetPath
      : state.detailItem?.downloadUrl ?? null;

    if (!target) {
      setState((previous) => ({
        ...previous,
        download: {
          ...previous.download,
          status: "error",
          error: "No local file or download URL available to open.",
        },
      }));
      return;
    }

    try {
      const child = spawn("xdg-open", [target], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      logger.debug("open media requested", { target });
    } catch (error) {
      logger.error("open media failed", error);
      setState((previous) => ({
        ...previous,
        download: {
          ...previous.download,
          status: "error",
          error: `Failed to open target: ${formatError(error)}`,
        },
      }));
    }
  }, [setState, state.detailItem?.downloadUrl, state.download.status, state.download.targetPath]);
}

type SetLiveWallpaperDeps = Readonly<{
  state: MoewallsAppState;
  setState: StateSetter;
}>;

const SMART_VIDEO_PLUGIN_ID = "luisbocanegra.smart.video.wallpaper.reborn";

function isSmartVideoWallpaperInstalled(): boolean {
  const home = process.env.HOME ?? "";
  const localPath = join(
    home,
    ".local/share/plasma/wallpapers",
    SMART_VIDEO_PLUGIN_ID,
  );
  const systemPath = join("/usr/share/plasma/wallpapers", SMART_VIDEO_PLUGIN_ID);
  return existsSync(localPath) || existsSync(systemPath);
}

function runPlasmaScript(script: string): void {
  const args = [
    "org.kde.plasmashell",
    "/PlasmaShell",
    "org.kde.PlasmaShell.evaluateScript",
    script,
  ];
  try {
    execFileSync("qdbus6", args, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return;
  } catch {}

  execFileSync("qdbus", args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

export function useSetLiveWallpaperAction({
  state,
  setState,
}: SetLiveWallpaperDeps): () => Promise<void> {
  return useCallback(async () => {
    const targetPath =
      state.download.status === "done" ? state.download.targetPath : null;
    if (!targetPath) {
      setState((previous) => ({
        ...previous,
        liveWallpaperStatus:
          "Download a wallpaper first, then press s to set it.",
      }));
      return;
    }

    if (!isSmartVideoWallpaperInstalled()) {
      setState((previous) => ({
        ...previous,
        liveWallpaperStatus:
          "Smart Video Wallpaper Reborn is not installed in this Plasma session.",
      }));
      return;
    }

    const fileUrl = pathToFileURL(targetPath).toString();
    const videoUrls = JSON.stringify([
      {
        filename: fileUrl,
        enabled: true,
        duration: 0,
        customDuration: 0,
        playbackRate: 0,
        alternativePlaybackRate: 0,
        loop: true,
      },
    ]);
    const script = [
      "desktops().forEach((d) => {",
      `  d.wallpaperPlugin = ${JSON.stringify(SMART_VIDEO_PLUGIN_ID)};`,
      `  d.currentConfigGroup = ['Wallpaper', ${JSON.stringify(SMART_VIDEO_PLUGIN_ID)}, 'General'];`,
      `  d.writeConfig('VideoUrls', ${JSON.stringify(videoUrls)});`,
      "  d.writeConfig('PauseMode', 3);",
      "  d.writeConfig('PlaybackRate', 1.0);",
      "  d.writeConfig('AlternativePlaybackRate', 1.0);",
      "  d.writeConfig('ChangeWallpaperMode', 0);",
      "  d.writeConfig('LastVideoIndex', 0);",
      "  d.writeConfig('LastVideoPosition', 0);",
      "  d.reloadConfig();",
      "});",
    ].join("\n");

    try {
      runPlasmaScript(script);
      logger.debug("set live wallpaper requested", {
        targetPath,
        plugin: SMART_VIDEO_PLUGIN_ID,
      });
      setState((previous) => ({
        ...previous,
        liveWallpaperStatus: `Live wallpaper set: ${basename(targetPath)}`,
      }));
    } catch (error) {
      logger.error("set live wallpaper failed", error);
      setState((previous) => ({
        ...previous,
        liveWallpaperStatus: `Failed to set live wallpaper: ${formatError(error)}`,
      }));
    }
  }, [setState, state.download.status, state.download.targetPath]);
}
