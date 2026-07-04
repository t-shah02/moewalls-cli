import { homedir } from "node:os";
import { join } from "node:path";

export const SEARCH_DEBOUNCE_MS = 400;
export const RESULTS_PER_PAGE = 16;
export const SPLASH_HOLD_MS = 900;
export const SPLASH_FADE_MS = 450;
export const SEARCH_MAX_LENGTH = 300;
export const DEFAULT_DOWNLOAD_EXTENSION = ".mp4";

export const DOWNLOAD_DIRECTORY = join(
  homedir(),
  ".local",
  "share",
  "moewalls-cli",
  "wallpapers",
);
