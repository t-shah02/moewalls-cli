import React from "react";
import { Box, Text } from "ink";
import type {
  DownloadState,
  ScreenResolution,
  WallpaperItemDetails,
} from "../../types/index.ts";
import { renderPreview } from "./preview.tsx";

export type ItemDetailsPaneProps = Readonly<{
  item: WallpaperItemDetails | null;
  loading: boolean;
  error: string | null;
  detailLoadDurationMs: number | null;
  screenResolution: ScreenResolution | null;
  preview: { width: number; height: number };
  previewProtocol?: "kitty";
  download: DownloadState;
  liveWallpaperStatus: string | null;
}>;

const DETAIL_TITLE_COLOR = "green";
const DETAIL_LABEL_COLOR = "yellow";
const DETAIL_VALUE_COLOR = "cyan";
const DETAIL_TAGS_COLOR = "magenta";
const DETAIL_HINT_COLOR = "blue";

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 ** 2) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 ** 3) {
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  }
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function renderProgressBar(download: DownloadState): React.ReactElement | null {
  if (download.status !== "downloading" && download.status !== "done") {
    return null;
  }
  const total = download.totalBytes ?? 0;
  const ratio = total > 0 ? Math.min(1, download.downloadedBytes / total) : 0;
  const width = 26;
  const filled = Math.round(ratio * width);
  const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
  const right =
    total > 0
      ? `${formatBytes(download.downloadedBytes)} / ${formatBytes(total)}`
      : `${formatBytes(download.downloadedBytes)}`;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="green">
        [{bar}] {Math.round(ratio * 100)}%
      </Text>
      <Text color="gray">{right}</Text>
    </Box>
  );
}

function resolutionWarning(
  screenResolution: ScreenResolution | null,
  wallpaper: WallpaperItemDetails | null,
): string | null {
  if (!screenResolution || !wallpaper?.wallpaperResolution) {
    return null;
  }
  const screen = screenResolution;
  const wall = wallpaper.wallpaperResolution;
  const wallSmaller = wall.width < screen.width || wall.height < screen.height;
  if (wallSmaller) {
    return `Wallpaper ${wall.label} may look soft on ${screen.width}x${screen.height}.`;
  }
  const screenAspect = screen.width / screen.height;
  const wallAspect = wall.width / wall.height;
  const aspectDiff = Math.abs(screenAspect - wallAspect);
  if (aspectDiff > 0.12) {
    return `Aspect ratio mismatch: wallpaper ${wall.label} vs screen ${screen.width}x${screen.height}.`;
  }
  return null;
}

export function renderItemDetailsPane({
  item,
  loading,
  error,
  detailLoadDurationMs,
  screenResolution,
  preview,
  previewProtocol,
  download,
  liveWallpaperStatus,
}: ItemDetailsPaneProps): React.ReactElement {
  if (loading) {
    return (
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        <Text color="yellow">Loading wallpaper details...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        <Text color="red">{error}</Text>
        <Text color={DETAIL_HINT_COLOR}>Press b to return</Text>
      </Box>
    );
  }

  if (!item) {
    return (
      <Box borderStyle="round" paddingX={1} flexDirection="column">
        <Text color={DETAIL_HINT_COLOR}>Select an item and press Enter</Text>
      </Box>
    );
  }

  const tagsText =
    item.tags.length > 0 ? item.tags.join(", ") : "No tags found";
  const sizeText =
    item.fileSizeLabel ??
    (item.fileSizeBytes ? formatBytes(item.fileSizeBytes) : "Unknown");
  const resolutionText = item.wallpaperResolution?.label ?? "Unknown";
  const fitWarning = resolutionWarning(screenResolution, item);
  const previewItem = {
    title: item.title,
    url: item.itemUrl,
    thumbnailUrl: item.previewImageUrl,
    votes: 0,
    category: "Detail",
  };

  return (
    <Box borderStyle="round" paddingX={1} flexDirection="column">
      <Text bold color={DETAIL_TITLE_COLOR}>
        {item.title}
      </Text>
      <Box marginTop={1}>
        {renderPreview({
          item: previewItem,
          preview,
          protocol: previewProtocol,
        })}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={DETAIL_HINT_COLOR}>
          Source url: <Text color={DETAIL_VALUE_COLOR}>{item.itemUrl}</Text>
        </Text>
        <Text color={DETAIL_LABEL_COLOR}>
          File size: <Text color={DETAIL_VALUE_COLOR}>{sizeText}</Text>
        </Text>
        <Text color={DETAIL_LABEL_COLOR}>
          Resolution: <Text color={DETAIL_VALUE_COLOR}>{resolutionText}</Text>
        </Text>
        {screenResolution ? (
          <Text color={DETAIL_LABEL_COLOR}>
            Screen:{" "}
            <Text color={DETAIL_VALUE_COLOR}>
              {screenResolution.width}x{screenResolution.height}
            </Text>
          </Text>
        ) : null}
        <Text color={DETAIL_LABEL_COLOR}>
          Tags: <Text color={DETAIL_TAGS_COLOR}>{tagsText}</Text>
        </Text>
        {detailLoadDurationMs !== null ? (
          <Text color={DETAIL_LABEL_COLOR}>
            Loaded in:{" "}
            <Text color={DETAIL_VALUE_COLOR}>{detailLoadDurationMs}ms</Text>
          </Text>
        ) : null}
        {fitWarning ? <Text color="red">{fitWarning}</Text> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="green">Download Wallpaper (press d)</Text>
        <Text color="cyan">Set as live wallpaper in KDE (press s)</Text>
        <Text color={DETAIL_HINT_COLOR}>Open with default app (press o)</Text>
        <Text color={DETAIL_LABEL_COLOR}>
          Target path: {download.targetPath ?? "~/.local/share/moewalls-cli"}
        </Text>
      </Box>
      {renderProgressBar(download)}
      {download.status === "done" ? (
        <Text color="green">Download complete.</Text>
      ) : null}
      {download.status === "error" && download.error ? (
        <Text color="red">Download failed: {download.error}</Text>
      ) : null}
      {liveWallpaperStatus ? (
        <Text
          color={liveWallpaperStatus.startsWith("Failed") ? "red" : "green"}
        >
          {liveWallpaperStatus}
        </Text>
      ) : null}
      <Box marginTop={1}>
        <Text color={DETAIL_HINT_COLOR}>Press b to return to list</Text>
      </Box>
    </Box>
  );
}
