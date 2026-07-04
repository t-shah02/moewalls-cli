import React, { useCallback, useEffect, useRef, useState } from "react";
import { render, useApp } from "ink";
import { InkPictureProvider, useTerminalInfo } from "ink-picture";
import { logger } from "../logger.ts";
import { closeScraperBrowser, getScraperBrowser } from "../scraper/client.ts";
import {
  FocusTarget,
} from "../types/index.ts";
import type {
  MoewallsAppHandle,
  MoewallsAppState,
  WallpaperItemDetails,
  WallpaperResult,
} from "../types/index.ts";
import { renderMainView } from "./components/index.ts";
import {
  startSplashAnimation,
  detectScreenResolution,
} from "./app/helpers.ts";
import {
  useDetailActions,
  useDownloadAction,
  useOpenMediaAction,
  useSetLiveWallpaperAction,
} from "./app/actions.ts";
import { useKeyboardBindings } from "./app/keyboard.ts";
import { useSearchController } from "./components/search-input.tsx";
import { initialMoewallsAppState } from "./state.ts";
type PageResultsCache = Map<string, readonly WallpaperResult[]>;
type ItemDetailsCache = Map<string, WallpaperItemDetails>;

function shouldForceKittyProtocol(): boolean {
  const forcedProtocol = process.env.MOEWALLS_PREVIEW_PROTOCOL?.trim().toLowerCase();
  if (forcedProtocol) {
    return forcedProtocol === "kitty";
  }
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? "";
  const term = process.env.TERM?.toLowerCase() ?? "";
  if (termProgram.includes("ghostty") || term.includes("ghostty")) {
    return true;
  }
  if (term.includes("kitty")) {
    return true;
  }
  if ((process.env.KITTY_WINDOW_ID ?? "").length > 0) {
    return true;
  }
  return false;
}

function MoewallsInkApp(): React.ReactElement {
  const { exit } = useApp();
  const terminalInfo = useTerminalInfo();
  const [state, setState] = useState<MoewallsAppState>(initialMoewallsAppState);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(FocusTarget.Search);
  const splashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenerationRef = useRef(0);
  const didStartRef = useRef(false);
  const cacheQueryRef = useRef("");
  const pageResultsCacheRef = useRef<PageResultsCache>(new Map());
  const itemDetailsCacheRef = useRef<ItemDetailsCache>(new Map());
  const detailsGenerationRef = useRef(0);

  const resetPageCacheForQuery = useCallback((query: string) => {
    cacheQueryRef.current = query;
    pageResultsCacheRef.current.clear();
    itemDetailsCacheRef.current.clear();
  }, []);
  const { runSearch, handleSearchInput } = useSearchController({
    state,
    setState,
    cacheQueryRef,
    pageResultsCacheRef,
    searchGenerationRef,
    resetPageCacheForQuery,
  });

  const { resetDetailView, openSelectedItemDetails } = useDetailActions({
    state,
    setState,
    setFocusTarget,
    cacheQueryRef,
    itemDetailsCacheRef,
    detailsGenerationRef,
    resetPageCacheForQuery,
  });
  const downloadCurrentWallpaper = useDownloadAction({ state, setState });
  const openCurrentMedia = useOpenMediaAction({ state, setState });
  const setCurrentAsLiveWallpaper = useSetLiveWallpaperAction({ state, setState });
  const [searchSpinnerFrame, setSearchSpinnerFrame] = useState(0);
  useKeyboardBindings({
    exit,
    focusTarget,
    state,
    setState,
    setFocusTarget,
    runSearch,
    resetDetailView,
    openSelectedItemDetails,
    downloadCurrentWallpaper,
    openCurrentMedia,
    setCurrentAsLiveWallpaper,
  });

  useEffect(() => {
    if (!state.loading) {
      return;
    }
    const timer = setInterval(() => {
      setSearchSpinnerFrame((previous) => previous + 1);
    }, 90);
    return () => clearInterval(timer);
  }, [state.loading]);

  useEffect(() => {
    if (didStartRef.current) {
      return;
    }
    didStartRef.current = true;
    logger.debug("app ready", { terminalInfo });
    const screenResolution = detectScreenResolution();
    if (screenResolution) {
      setState((previous) => ({ ...previous, screenResolution }));
      logger.debug("screen resolution detected", screenResolution);
    }
    startSplashAnimation(setState, splashTimerRef);
    void getScraperBrowser().catch((error) => {
      logger.error("scraper: background warmup failed", error);
    });

    return () => {
      if (splashTimerRef.current) {
        clearTimeout(splashTimerRef.current);
        splashTimerRef.current = null;
      }
    };
  }, [terminalInfo]);

  const forceKittyProtocol = shouldForceKittyProtocol();
  const previewProtocol =
    terminalInfo.supportsKittyGraphics || forceKittyProtocol
      ? "kitty"
      : undefined;

  return renderMainView({
    state,
    onSearchInput: handleSearchInput,
    focusTarget,
    searchSpinnerFrame,
    cellWidthPx: terminalInfo.cellWidth,
    cellHeightPx: terminalInfo.cellHeight,
    previewProtocol,
  });
}

function RootApp(): React.ReactElement {
  return React.createElement(
    InkPictureProvider,
    null,
    React.createElement(MoewallsInkApp),
  );
}

export function createMoewallsApp(): MoewallsAppHandle {
  const instance = render(React.createElement(RootApp));
  return {
    run: async () => {
      await instance.waitUntilExit();
    },
  };
}

export async function shutdownMoewallsApp(): Promise<void> {
  await closeScraperBrowser();
}
