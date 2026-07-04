import React from "react";
import { Box, Text } from "ink";
import type { WallpaperResult } from "../../types/index.ts";
import { renderPreview } from "./preview.tsx";

export const RESULTS_LIST_SUFFIX = "results";
export const COMPACT_ROW_HEIGHT = 3;
const LIST_TITLE_COLOR = "magenta";
const LIST_META_COLOR = "cyan";
const LIST_URL_COLOR = "blue";
const LIST_EMPTY_COLOR = "yellow";

export type ResultsListProps = Readonly<{
  results: readonly WallpaperResult[];
  preview: { width: number; height: number };
  previewProtocol?: "kitty";
  expandedItemHeight: number;
  debouncedQuery: string;
  loading: boolean;
  selectedIndex: number;
  viewportHeight: number;
}>;

function listContentHeight(
  itemCount: number,
  expandedItemHeight: number,
): number {
  if (itemCount === 0) {
    return 0;
  }
  return (itemCount - 1) * COMPACT_ROW_HEIGHT + expandedItemHeight;
}

function rowHeight(
  index: number,
  selectedIndex: number,
  expandedItemHeight: number,
): number {
  return index === selectedIndex ? expandedItemHeight : COMPACT_ROW_HEIGHT;
}

function rowTop(
  index: number,
  selectedIndex: number,
  expandedItemHeight: number,
): number {
  let top = 0;
  for (let i = 0; i < index; i++) {
    top += rowHeight(i, selectedIndex, expandedItemHeight);
  }
  return top;
}

function visibleRowIndices(
  itemCount: number,
  selectedIndex: number,
  expandedItemHeight: number,
  viewportHeight: number,
): ReadonlySet<number> {
  if (itemCount === 0) {
    return new Set();
  }

  const selectedTop = rowTop(selectedIndex, selectedIndex, expandedItemHeight);
  const totalHeight = listContentHeight(itemCount, expandedItemHeight);
  const maxScroll = Math.max(0, totalHeight - viewportHeight);
  const scrollY = Math.max(
    0,
    Math.min(
      maxScroll,
      selectedTop - Math.floor((viewportHeight - expandedItemHeight) / 2),
    ),
  );
  const startY = scrollY;
  const endY = scrollY + viewportHeight;

  const indices = new Set<number>();
  for (let i = 0; i < itemCount; i++) {
    const top = rowTop(i, selectedIndex, expandedItemHeight);
    const bottom = top + rowHeight(i, selectedIndex, expandedItemHeight);
    if (bottom > startY && top < endY) {
      indices.add(i);
    }
  }
  return indices;
}

function renderCompactRow(item: WallpaperResult): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color={LIST_TITLE_COLOR}>{item.title}</Text>
      <Text color={LIST_META_COLOR}>
        {item.votes} votes · {item.category}
      </Text>
    </Box>
  );
}

function renderExpandedRow(
  item: WallpaperResult,
  preview: { width: number; height: number },
  previewProtocol?: "kitty",
): React.ReactElement {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Box flexDirection="row" gap={2}>
        {renderPreview({ item, preview, protocol: previewProtocol })}
        <Box flexDirection="column" flexGrow={1}>
          <Text bold color={LIST_TITLE_COLOR}>{item.title}</Text>
          <Text color={LIST_META_COLOR}>
            {item.votes} votes · {item.category}
          </Text>
          <Text color={LIST_URL_COLOR}>{item.url}</Text>
        </Box>
      </Box>
    </Box>
  );
}

export function renderResultsList({
  results,
  preview,
  previewProtocol,
  expandedItemHeight,
  debouncedQuery,
  loading,
  selectedIndex,
  viewportHeight,
}: ResultsListProps): React.ReactElement {
  if (!debouncedQuery.trim()) {
    return <Text color={LIST_EMPTY_COLOR}>Type to search wallpapers</Text>;
  }

  if (loading && results.length === 0) {
    return <Text color="yellow">Loading results...</Text>;
  }

  if (!loading && results.length === 0) {
    return (
      <Text color={LIST_EMPTY_COLOR}>
        No wallpapers found - try another query or page
      </Text>
    );
  }

  const safeSelectedIndex = Math.max(
    0,
    Math.min(selectedIndex, results.length - 1),
  );
  const visible = visibleRowIndices(
    results.length,
    safeSelectedIndex,
    expandedItemHeight,
    viewportHeight,
  );

  return (
    <Box flexDirection="column">
      {results.map((item, index) => {
        if (!visible.has(index)) {
          return null;
        }
        return (
          <Box key={item.url}>
            {index === safeSelectedIndex
              ? renderExpandedRow(item, preview, previewProtocol)
              : renderCompactRow(item)}
          </Box>
        );
      })}
    </Box>
  );
}
