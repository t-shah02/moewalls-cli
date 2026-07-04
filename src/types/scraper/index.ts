export type WallpaperResult = {
  title: string;
  url: string;
  thumbnailUrl?: string;
  votes: number;
  category: string;
};

export type WallpaperItemDetails = {
  title: string;
  itemUrl: string;
  previewImageUrl?: string;
  tags: string[];
  fileSizeLabel?: string;
  fileSizeBytes?: number;
  downloadUrl?: string;
  wallpaperResolution?: {
    width: number;
    height: number;
    label: string;
  };
};

export type RetryOptions = {
  maxRetries?: number;
  delayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
};
