import type {
  WallpaperItemDetails,
  WallpaperResult,
} from "../scraper/index.ts";

export enum AppInputKey {
  Quit = "q",
  Back = "b",
  Download = "d",
  Open = "o",
  SetWallpaper = "s",
  PrevPage = "[",
  NextPage = "]",
  EnterCarriageReturn = "\r",
  EnterLineFeed = "\n",
}

export enum FocusTarget {
  Search = "search",
  Results = "results",
  Detail = "detail",
}

export type DownloadStatus = "idle" | "downloading" | "done" | "error";

export type DownloadState = {
  status: DownloadStatus;
  targetPath: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
};

export type ScreenResolution = {
  width: number;
  height: number;
};

export type MoewallsAppHandle = Readonly<{
  run: () => Promise<void>;
}>;

export type MoewallsAppState = {
  searchQuery: string;
  debouncedQuery: string;
  page: number;
  results: readonly WallpaperResult[];
  loading: boolean;
  error: string | null;
  splashDone: boolean;
  splashOpacity: number;
  selectedIndex: number;
  detailOpen: boolean;
  detailLoading: boolean;
  detailError: string | null;
  detailLoadDurationMs: number | null;
  detailItem: WallpaperItemDetails | null;
  liveWallpaperStatus: string | null;
  searchDurationMs: number | null;
  screenResolution: ScreenResolution | null;
  download: DownloadState;
};
