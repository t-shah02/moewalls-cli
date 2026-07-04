import type { MoewallsAppState } from "../types/index.ts";
export type { DownloadState, FocusTarget, MoewallsAppHandle, MoewallsAppState } from "../types/index.ts";

export const initialMoewallsAppState = (): MoewallsAppState => ({
  searchQuery: "",
  debouncedQuery: "",
  page: 1,
  results: [],
  loading: false,
  error: null,
  splashDone: false,
  splashOpacity: 1,
  selectedIndex: 0,
  detailOpen: false,
  detailLoading: false,
  detailError: null,
  detailLoadDurationMs: null,
  detailItem: null,
  liveWallpaperStatus: null,
  searchDurationMs: null,
  screenResolution: null,
  download: {
    status: "idle",
    targetPath: null,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
  },
});
