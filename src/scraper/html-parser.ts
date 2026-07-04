const VIDEO_URL_PATTERN =
  /https?:\/\/[^\s"'\\]+?\.(?:mp4|webm|mkv|mov|zip)(?:\?[^\s"'\\]*)?/gi;
const GENERIC_URL_PATTERN = /https?:\/\/[^\s"'\\<>]+/gi;
const FILE_SIZE_PATTERN =
  /(?:file\s*size|size)\s*[:|-]?\s*([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)/i;
const TITLE_PATTERN = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
const OG_IMAGE_PATTERN =
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i;
const TAG_PATTERN = /<a[^>]+rel=["']tag["'][^>]*>([\s\S]*?)<\/a>/gi;
const DOWNLOAD_LINK_PATTERN =
  /<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?Download Wallpaper[\s\S]*?<\/a>/i;
const DOWNLOAD_ONCLICK_PATTERN =
  /<(?:a|button)[^>]+onclick=["']([^"']+)["'][^>]*>[\s\S]*?Download Wallpaper[\s\S]*?<\/(?:a|button)>/i;
const DOWNLOAD_DATA_URL_PATTERN = /data-url=["']([^"']+)["']/i;
const DOWNLOAD_VIDEO_PARAM_PATTERN = /(?:^|[?&]video=)([A-Za-z0-9%._+-]{16,})/i;
const RESOLUTION_PATTERN = /(\d{3,5})\s*x\s*(\d{3,5})/gi;
const LINK_CLICK_PAYLOAD_PATTERN =
  /action=link_click_counter(?:&amp;|&)nonce=([a-z0-9]+)(?:&amp;|&)post_id=(\d+)/i;
const NONCE_PATTERN = /(?:nonce=|["']nonce["']\s*[:=]\s*["'])([a-z0-9]{8,})/i;
const POST_ID_PATTERN = /(?:post_id=|["']post_id["']\s*[:=]\s*["']?)(\d{2,})/i;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const WHITESPACE_PATTERN = /\s+/g;

function parseFileSizeLabel(label: string): number | undefined {
  const match = label.match(/([0-9]+(?:\.[0-9]+)?)\s*(KB|MB|GB)/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const unit = match[2].toUpperCase();
  const multiplier =
    unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  return Math.round(value * multiplier);
}

function stripTags(input: string): string {
  return input
    .replace(HTML_TAG_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function extractWallpaperResolution(
  tags: readonly string[],
  text: string,
): { width: number; height: number; label: string } | undefined {
  const candidates = [...tags, text];
  let best: { width: number; height: number } | undefined;

  for (const source of candidates) {
    let match: RegExpExecArray | null;
    RESOLUTION_PATTERN.lastIndex = 0;
    while ((match = RESOLUTION_PATTERN.exec(source)) !== null) {
      const width = Number.parseInt(match[1] ?? "", 10);
      const height = Number.parseInt(match[2] ?? "", 10);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        continue;
      }
      if (width < 320 || height < 180) {
        continue;
      }
      if (!best || width * height > best.width * best.height) {
        best = { width, height };
      }
    }
  }

  if (!best) {
    return undefined;
  }
  return {
    width: best.width,
    height: best.height,
    label: `${best.width}x${best.height}`,
  };
}

export function parseWallpaperMeta(html: string): {
  title: string;
  previewImageUrl?: string;
  tags: string[];
  fileSizeLabel?: string;
  fileSizeBytes?: number;
  wallpaperResolution?: { width: number; height: number; label: string };
} {
  const text = stripTags(html);
  const title = decodeHtmlEntities(
    stripTags(html.match(TITLE_PATTERN)?.[1] ?? "Wallpaper"),
  );
  const previewImageUrl = html.match(OG_IMAGE_PATTERN)?.[1];
  const tags = Array.from(html.matchAll(TAG_PATTERN))
    .map((match) => decodeHtmlEntities(stripTags(match[1] ?? "")))
    .filter(Boolean);
  const fileSizeMatch = text.match(FILE_SIZE_PATTERN);
  const fileSizeLabel = fileSizeMatch
    ? `${fileSizeMatch[1] ?? ""} ${(fileSizeMatch[2] ?? "").toUpperCase()}`.trim()
    : undefined;
  const fileSizeBytes = fileSizeLabel
    ? parseFileSizeLabel(fileSizeLabel)
    : undefined;
  const wallpaperResolution = extractWallpaperResolution(tags, text);

  return {
    title,
    previewImageUrl,
    tags,
    fileSizeLabel,
    fileSizeBytes,
    wallpaperResolution,
  };
}

export function extractVideoUrlCandidates(html: string): string[] {
  return Array.from(html.matchAll(VIDEO_URL_PATTERN)).map((match) => match[0]);
}

export function extractDirectDownloadCandidates(
  html: string,
  buttonCandidates: readonly string[],
): string[] {
  return [
    html.match(DOWNLOAD_LINK_PATTERN)?.[1] ?? "",
    html.match(DOWNLOAD_ONCLICK_PATTERN)?.[1] ?? "",
    ...buttonCandidates,
  ].filter(Boolean);
}

export function extractDownloadOnclick(html: string): string | undefined {
  return html.match(DOWNLOAD_ONCLICK_PATTERN)?.[1];
}

export function extractInlineDownloadDataUrl(html: string): string | undefined {
  return html.match(DOWNLOAD_DATA_URL_PATTERN)?.[1];
}

export function pickLikelyDownloadUrl(
  candidates: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const cleaned = candidate
      .replaceAll("\\/", "/")
      .replace(/^["']|["']$/g, "");
    if (/^https?:\/\//i.test(cleaned) && VIDEO_URL_PATTERN.test(cleaned)) {
      VIDEO_URL_PATTERN.lastIndex = 0;
      return cleaned;
    }
    if (/^https?:\/\//i.test(cleaned) && /\/download\//i.test(cleaned)) {
      VIDEO_URL_PATTERN.lastIndex = 0;
      return cleaned;
    }
    VIDEO_URL_PATTERN.lastIndex = 0;
  }
  return undefined;
}

export function extractDownloadToken(
  candidates: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const raw = candidate.trim();
    const dataUrlMatch = raw.match(/^url=([A-Za-z0-9%._+-]{16,})$/i);
    if (dataUrlMatch?.[1]) {
      return dataUrlMatch[1];
    }
    const videoMatch = raw.match(DOWNLOAD_VIDEO_PARAM_PATTERN);
    if (videoMatch?.[1]) {
      return videoMatch[1];
    }
    if (
      /^[A-Za-z0-9%._+-]{24,}$/.test(raw) &&
      !raw.startsWith("http") &&
      raw.includes("%")
    ) {
      return raw;
    }
  }
  return undefined;
}

export function extractAjaxPayload(
  html: string,
  onclickRaw?: string,
): {
  nonce?: string;
  postId?: string;
} {
  const joined = `${html}\n${onclickRaw ?? ""}`;
  const clickPayload = joined.match(LINK_CLICK_PAYLOAD_PATTERN);
  if (clickPayload?.[1] && clickPayload[2]) {
    return { nonce: clickPayload[1], postId: clickPayload[2] };
  }
  const nonce = joined.match(NONCE_PATTERN)?.[1];
  const postId = joined.match(POST_ID_PATTERN)?.[1];
  return { nonce, postId };
}

export function extractUrls(text: string): string[] {
  return Array.from(text.matchAll(GENERIC_URL_PATTERN)).map((match) =>
    match[0].replaceAll("\\/", "/"),
  );
}

export function extractStringLeaves(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      extractStringLeaves(item, output);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      extractStringLeaves(nested, output);
    }
  }
}
