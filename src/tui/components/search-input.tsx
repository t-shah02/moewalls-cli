import React, { useCallback, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { logger } from "../../logger.ts";
import { getScraperBrowser } from "../../scraper/client.ts";
import type { MoewallsAppState, WallpaperResult } from "../../types/index.ts";
import { SEARCH_DEBOUNCE_MS } from "../app/constants.ts";
import { initialMoewallsAppState } from "../state.ts";

export const SEARCH_MAX_LENGTH = 300;
const SEARCH_LABEL_COLOR = "yellow";
type PageResultsCache = Map<string, readonly WallpaperResult[]>;

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function queueSearch(
  runSearch: (query: string, page: number) => Promise<void>,
  query: string,
  page: number,
): void {
  queueMicrotask(() => {
    void runSearch(query, page);
  });
}

function pageCacheKey(page: number): string {
  return `page_${page}`;
}

function initialDownloadState(targetPath: string | null = null) {
  return {
    ...initialMoewallsAppState().download,
    targetPath,
  };
}

export type SearchInputProps = Readonly<{
  value: string;
  focused: boolean;
  onInput: (value: string) => void;
}>;

export type SearchControllerDeps = Readonly<{
  state: MoewallsAppState;
  setState: React.Dispatch<React.SetStateAction<MoewallsAppState>>;
  cacheQueryRef: React.MutableRefObject<string>;
  pageResultsCacheRef: React.MutableRefObject<PageResultsCache>;
  searchGenerationRef: React.MutableRefObject<number>;
  resetPageCacheForQuery: (query: string) => void;
}>;

export function useSearchController({
  state,
  setState,
  cacheQueryRef,
  pageResultsCacheRef,
  searchGenerationRef,
  resetPageCacheForQuery,
}: SearchControllerDeps): {
  runSearch: (query: string, page: number) => Promise<void>;
  handleSearchInput: (value: string) => void;
} {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (query: string, page: number) => {
    const trimmedQuery = query.trim();
    const generation = ++searchGenerationRef.current;

    if (!trimmedQuery) {
      resetPageCacheForQuery("");
      setState((previous) => ({
        ...previous,
        results: [],
        loading: false,
        error: null,
        searchDurationMs: null,
        detailOpen: false,
        detailLoading: false,
        detailError: null,
        detailItem: null,
        liveWallpaperStatus: null,
        download: initialDownloadState(),
      }));
      return;
    }

    if (cacheQueryRef.current !== trimmedQuery) {
      resetPageCacheForQuery(trimmedQuery);
    }

    const cached = pageResultsCacheRef.current.get(pageCacheKey(page));
    if (cached) {
      logger.debug("search cache hit", { query: trimmedQuery, page, count: cached.length });
      setState((previous) => ({
        ...previous,
        results: cached,
        selectedIndex: 0,
        loading: false,
        error: null,
        searchDurationMs: 0,
        detailOpen: false,
        detailLoading: false,
        detailError: null,
        detailItem: null,
        liveWallpaperStatus: null,
        download: initialDownloadState(),
      }));
      return;
    }

    setState((previous) => ({
      ...previous,
      loading: true,
      error: null,
    }));

    logger.debug("search start", { query: trimmedQuery, page });
    const startedAt = Date.now();

    try {
      const browser = await getScraperBrowser();
      const results = await browser.searchWallpapers(trimmedQuery, page);

      if (generation !== searchGenerationRef.current) {
        return;
      }

      logger.debug("search complete", {
        query: trimmedQuery,
        page,
        count: results.length,
      });
      pageResultsCacheRef.current.set(pageCacheKey(page), results);

      setState((previous) => ({
        ...previous,
        results,
        selectedIndex: 0,
        loading: false,
        error: null,
        searchDurationMs: Date.now() - startedAt,
        detailOpen: false,
        detailLoading: false,
        detailError: null,
        detailItem: null,
        liveWallpaperStatus: null,
        download: initialDownloadState(),
      }));
    } catch (error) {
      if (generation !== searchGenerationRef.current) {
        return;
      }

      logger.error("search failed", error);
      setState((previous) => ({
        ...previous,
        results: [],
        selectedIndex: 0,
        loading: false,
        error: formatError(error),
        searchDurationMs: Date.now() - startedAt,
        detailOpen: false,
        detailLoading: false,
        detailError: null,
        detailItem: null,
        liveWallpaperStatus: null,
        download: initialDownloadState(),
      }));
    }
  }, [
    cacheQueryRef,
    pageResultsCacheRef,
    resetPageCacheForQuery,
    searchGenerationRef,
    setState,
  ]);

  const scheduleDebouncedSearch = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      setState((previous) => {
        queueSearch(runSearch, previous.searchQuery, previous.page);
        return {
          ...previous,
          debouncedQuery: previous.searchQuery,
        };
      });
    }, SEARCH_DEBOUNCE_MS);
  }, [runSearch, setState]);

  const handleSearchInput = useCallback((value: string) => {
    const truncated = value.slice(0, SEARCH_MAX_LENGTH);
    logger.debug("search input", { searchQuery: truncated });
    const trimmed = truncated.trim();
    if (trimmed !== cacheQueryRef.current) {
      resetPageCacheForQuery(trimmed);
    }
    setState((previous) => ({
      ...previous,
      searchQuery: truncated,
      page: 1,
      searchDurationMs: null,
      detailOpen: false,
      detailLoading: false,
      detailError: null,
      detailItem: null,
      liveWallpaperStatus: null,
      download: initialDownloadState(),
    }));
    scheduleDebouncedSearch();
  }, [cacheQueryRef, resetPageCacheForQuery, scheduleDebouncedSearch, setState]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!state.debouncedQuery && debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, [state.debouncedQuery]);

  return { runSearch, handleSearchInput };
}

export function renderSearchInput({
  value,
  focused,
  onInput,
}: SearchInputProps): React.ReactElement {
  return (
    <Box width="100%">
      <Text color={focused ? SEARCH_LABEL_COLOR : "gray"}>Search: </Text>
      <TextInput
        value={value}
        placeholder="Search wallpapers..."
        focus={focused}
        onChange={(nextValue) => onInput(nextValue.slice(0, SEARCH_MAX_LENGTH))}
      />
    </Box>
  );
}
