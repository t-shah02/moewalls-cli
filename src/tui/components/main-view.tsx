import React from "react";
import { Box, Text } from "ink";
import { previewDimensions } from "../images.ts";
import { FocusTarget, type MoewallsAppState } from "../../types/index.ts";
import { renderItemDetailsPane } from "./item-details-pane.tsx";
import { renderResultsList } from "./results-list.tsx";
import { renderSearchInput } from "./search-input.tsx";
import { renderSplash } from "./splash.tsx";

export function terminalSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

const STATUS_TEXT_COLOR = "cyan";
const ERROR_TEXT_COLOR = "red";
const FOOTER_TEXT_COLOR = "blue";

export type MainViewProps = Readonly<{
  state: MoewallsAppState;
  onSearchInput: (value: string) => void;
  focusTarget: FocusTarget;
  searchSpinnerFrame: number;
  cellWidthPx?: number;
  cellHeightPx?: number;
  previewProtocol?: "kitty";
}>;

const SEARCH_SPINNER_FRAMES = ["|", "/", "-", "\\"];

function footerHint(focusTarget: FocusTarget): string {
  if (focusTarget === FocusTarget.Detail) {
    return "d download · s set live wallpaper · o open · b back · PgUp/PgDn pages · ctrl+q quit";
  }
  return focusTarget === FocusTarget.Search
    ? "PgUp/PgDn pages · Tab results · Enter open wallpaper detail · ctrl+q quit"
    : "↑/↓ browse · Enter open wallpaper detail · PgUp/PgDn pages · [ ] or ←/→ pages · Tab search · ctrl+q quit";
}

export function renderMainView({
  state,
  onSearchInput,
  focusTarget,
  searchSpinnerFrame,
  cellWidthPx,
  cellHeightPx,
  previewProtocol,
}: MainViewProps): React.ReactElement {
  if (!state.splashDone) {
    return renderSplash(state);
  }

  const { cols, rows } = terminalSize();
  const preview = previewDimensions(cols, rows, cellWidthPx, cellHeightPx);
  const expandedItemHeight = preview.height + 3;

  const spinner =
    SEARCH_SPINNER_FRAMES[
      ((searchSpinnerFrame % SEARCH_SPINNER_FRAMES.length) +
        SEARCH_SPINNER_FRAMES.length) %
        SEARCH_SPINNER_FRAMES.length
    ] ?? SEARCH_SPINNER_FRAMES[0];

  const statusText = (() => {
    if (!state.debouncedQuery.trim()) {
      return "Search live wallpapers from moewalls.com";
    }
    if (state.loading) {
      return `Searching ${spinner} page ${state.page}`;
    }
    if (state.error) {
      return state.error;
    }
    if (state.results.length === 0) {
      return `No results for "${state.debouncedQuery}" on page ${state.page}`;
    }
    const duration =
      state.searchDurationMs !== null ? ` · ${state.searchDurationMs}ms` : "";
    return `${state.results.length} result${state.results.length === 1 ? "" : "s"} · page ${state.page}${duration}`;
  })();

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      {renderSearchInput({
        value: state.searchQuery,
        focused: focusTarget === FocusTarget.Search,
        onInput: onSearchInput,
      })}
      <Text color={state.error ? ERROR_TEXT_COLOR : STATUS_TEXT_COLOR}>
        {statusText}
      </Text>
      <Box marginTop={1} flexDirection="row" gap={1}>
        <Box flexDirection="column" width={state.detailOpen ? "60%" : "100%"}>
          {renderResultsList({
            results: state.results,
            preview,
            previewProtocol,
            expandedItemHeight,
            debouncedQuery: state.debouncedQuery,
            loading: state.loading,
            selectedIndex: state.selectedIndex,
            viewportHeight: Math.max(expandedItemHeight, rows - 7),
          })}
        </Box>
        {state.detailOpen ? (
          <Box width="40%" flexDirection="column">
            {renderItemDetailsPane({
              item: state.detailItem,
              loading: state.detailLoading,
              error: state.detailError,
              detailLoadDurationMs: state.detailLoadDurationMs,
              screenResolution: state.screenResolution,
              preview,
              previewProtocol,
              download: state.download,
              liveWallpaperStatus: state.liveWallpaperStatus,
            })}
          </Box>
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Text color={FOOTER_TEXT_COLOR}>
          Page {state.page} · {footerHint(focusTarget)}
        </Text>
      </Box>
    </Box>
  );
}
