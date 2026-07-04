import { useInput } from "ink";
import type { Dispatch, SetStateAction } from "react";
import { logger } from "../../logger.ts";
import { AppInputKey, FocusTarget } from "../../types/index.ts";
import type { MoewallsAppState } from "../../types/index.ts";
import { initialDownloadState, queueSearch } from "./helpers.ts";

type KeyboardBindingsOptions = Readonly<{
  exit: () => void;
  focusTarget: FocusTarget;
  state: MoewallsAppState;
  setState: Dispatch<SetStateAction<MoewallsAppState>>;
  setFocusTarget: Dispatch<SetStateAction<FocusTarget>>;
  runSearch: (query: string, page: number) => Promise<void>;
  resetDetailView: () => void;
  openSelectedItemDetails: () => Promise<void>;
  downloadCurrentWallpaper: () => Promise<void>;
  openCurrentMedia: () => Promise<void>;
  setCurrentAsLiveWallpaper: () => Promise<void>;
}>;

export function useKeyboardBindings({
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
}: KeyboardBindingsOptions): void {
  useInput((input, key) => {
    const lowerInput = input.toLowerCase();

    if (key.ctrl && lowerInput === AppInputKey.Quit) {
      exit();
      return;
    }

    if (lowerInput === AppInputKey.Back && focusTarget === FocusTarget.Detail) {
      resetDetailView();
      return;
    }

    const isEnter =
      key.return ||
      input === AppInputKey.EnterCarriageReturn ||
      input === AppInputKey.EnterLineFeed ||
      (key as { enter?: boolean }).enter === true;

    if (isEnter && focusTarget !== FocusTarget.Detail) {
      logger.debug("enter pressed", {
        focusTarget,
        selectedIndex: state.selectedIndex,
        resultsCount: state.results.length,
      });
      void openSelectedItemDetails();
      return;
    }

    if (lowerInput === AppInputKey.Download && focusTarget === FocusTarget.Detail) {
      void downloadCurrentWallpaper();
      return;
    }

    if (lowerInput === AppInputKey.Open && focusTarget === FocusTarget.Detail) {
      void openCurrentMedia();
      return;
    }

    if (
      lowerInput === AppInputKey.SetWallpaper &&
      focusTarget === FocusTarget.Detail
    ) {
      void setCurrentAsLiveWallpaper();
      return;
    }

    if (key.tab && focusTarget !== FocusTarget.Detail) {
      setFocusTarget((previous) =>
        previous === FocusTarget.Search ? FocusTarget.Results : FocusTarget.Search,
      );
      return;
    }

    if (focusTarget === FocusTarget.Detail) {
      return;
    }

    if (key.upArrow) {
      setState((previous) => {
        if (previous.results.length === 0) {
          return previous;
        }
        return {
          ...previous,
          selectedIndex: Math.max(0, previous.selectedIndex - 1),
        };
      });
      return;
    }

    if (key.downArrow) {
      setState((previous) => {
        if (previous.results.length === 0) {
          return previous;
        }
        return {
          ...previous,
          selectedIndex: Math.min(
            previous.results.length - 1,
            previous.selectedIndex + 1,
          ),
        };
      });
      return;
    }

    const wantsPrevPage =
      key.pageUp ||
      (focusTarget === FocusTarget.Results &&
        (input === AppInputKey.PrevPage || key.leftArrow));
    const wantsNextPage =
      key.pageDown ||
      (focusTarget === FocusTarget.Results &&
        (input === AppInputKey.NextPage || key.rightArrow));

    if (wantsPrevPage) {
      setState((previous) => {
        if (previous.page <= 1 || previous.loading || !previous.debouncedQuery.trim()) {
          return previous;
        }
        const nextPage = previous.page - 1;
        logger.debug("page change", { page: nextPage });
        queueSearch(runSearch, previous.debouncedQuery, nextPage);
        return {
          ...previous,
          page: nextPage,
          selectedIndex: 0,
          loading: true,
          error: null,
          detailOpen: false,
          detailLoading: false,
          detailError: null,
          detailItem: null,
          liveWallpaperStatus: null,
          download: initialDownloadState(),
        };
      });
      return;
    }

    if (wantsNextPage) {
      setState((previous) => {
        if (previous.loading || !previous.debouncedQuery.trim()) {
          return previous;
        }
        const nextPage = previous.page + 1;
        logger.debug("page change", { page: nextPage });
        queueSearch(runSearch, previous.debouncedQuery, nextPage);
        return {
          ...previous,
          page: nextPage,
          selectedIndex: 0,
          loading: true,
          error: null,
          detailOpen: false,
          detailLoading: false,
          detailError: null,
          detailItem: null,
          liveWallpaperStatus: null,
          download: initialDownloadState(),
        };
      });
    }
  }, { isActive: true });
}
