import React from "react";
import { Box, Text } from "ink";
import Image from "ink-picture";
import type { WallpaperResult } from "../../types/index.ts";

export type PreviewProps = Readonly<{
  item: WallpaperResult;
  preview: { width: number; height: number };
  protocol?: "kitty";
}>;

export function renderPreview({
  item,
  preview,
  protocol,
}: PreviewProps): React.ReactElement {
  if (item.thumbnailUrl) {
    return (
      <Box width={preview.width} height={preview.height} flexDirection="column">
        <Image
          src={item.thumbnailUrl}
          width="100%"
          height="100%"
          alt=""
          protocol={protocol}
        />
      </Box>
    );
  }

  return (
    <Box
      width={preview.width}
      height={preview.height}
      borderStyle="single"
      justifyContent="center"
      alignItems="center"
    >
      <Text dimColor>preview unavailable</Text>
    </Box>
  );
}
