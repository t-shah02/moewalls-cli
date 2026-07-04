import { extname } from "node:path";
import { execFileSync } from "node:child_process";
import type React from "react";
import { SPLASH_FADE_MS, SPLASH_HOLD_MS } from "./constants.ts";
import type {
  DownloadState,
  MoewallsAppState,
  ScreenResolution,
} from "../../types/index.ts";
import { SPLASH_TICK_MS } from "../components/index.ts";

const SUPPORTED_VIDEO_EXTENSIONS = new Set([
  "mp4",
  "webm",
  "mkv",
  "mov",
  "avi",
]);

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function queueSearch(
  runSearch: (query: string, page: number) => Promise<void>,
  query: string,
  page: number,
): void {
  queueMicrotask(() => {
    void runSearch(query, page);
  });
}

export function pageCacheKey(page: number): string {
  return `page_${page}`;
}

export function sanitizeFileName(input: string): string {
  const cleaned = input
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "wallpaper";
}

export function normalizeVideoExtension(
  extension: string | null | undefined,
): string | undefined {
  if (!extension) {
    return undefined;
  }
  const normalized = extension.toLowerCase().replace(/^\./, "");
  return SUPPORTED_VIDEO_EXTENSIONS.has(normalized)
    ? `.${normalized}`
    : undefined;
}

export function extensionFromContentType(
  contentType: string | null,
): string | undefined {
  if (!contentType) {
    return undefined;
  }
  const lower = contentType.toLowerCase();
  if (lower.includes("video/mp4")) {
    return ".mp4";
  }
  if (lower.includes("video/webm")) {
    return ".webm";
  }
  if (lower.includes("video/x-matroska") || lower.includes("video/mkv")) {
    return ".mkv";
  }
  if (lower.includes("video/quicktime")) {
    return ".mov";
  }
  if (lower.includes("video/x-msvideo")) {
    return ".avi";
  }
  return undefined;
}

export function extensionFromContentDisposition(
  header: string | null,
): string | undefined {
  if (!header) {
    return undefined;
  }
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const ascii = header.match(/filename="?([^\";]+)"?/i)?.[1];
  const raw = utf8 ? decodeURIComponent(utf8) : ascii;
  if (!raw) {
    return undefined;
  }
  return normalizeVideoExtension(extname(raw));
}

export function initialDownloadState(
  targetPath: string | null = null,
): DownloadState {
  return {
    status: "idle",
    targetPath,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
  };
}

export function startSplashAnimation(
  setState: React.Dispatch<React.SetStateAction<MoewallsAppState>>,
  splashTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>,
): void {
  const startedAt = Date.now();
  const tick = () => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= SPLASH_HOLD_MS + SPLASH_FADE_MS) {
      splashTimerRef.current = null;
      setState((previous) => ({
        ...previous,
        splashDone: true,
        splashOpacity: 0,
      }));
      return;
    }
    const opacity =
      elapsed < SPLASH_HOLD_MS
        ? 1
        : 1 - (elapsed - SPLASH_HOLD_MS) / SPLASH_FADE_MS;
    setState((previous) => ({
      ...previous,
      splashOpacity: Math.max(0, opacity),
    }));
    splashTimerRef.current = setTimeout(tick, SPLASH_TICK_MS);
  };
  tick();
}

export function detectScreenResolution(): ScreenResolution | null {
  try {
    const output = execFileSync("xrandr", ["--current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const current = output.match(/current\s+(\d+)\s*x\s*(\d+)/i);
    if (current?.[1] && current[2]) {
      const width = Number.parseInt(current[1], 10);
      const height = Number.parseInt(current[2], 10);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        return { width, height };
      }
    }
  } catch {}
  return null;
}
