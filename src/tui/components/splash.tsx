import React from "react";
import { Box, Text } from "ink";
import type { MoewallsAppState } from "../../types/index.ts";

export const SPLASH_TICK_MS = 40;
const SPLASH_DIM_OPACITY_THRESHOLD = 0.65;
const SPLASH_TAGLINE_MARGIN_TOP = 1;

export const MOEWALLS_BANNER_LINES = [
  " __  __            _    _      _     ",
  "|  \\/  | ___   ___| | _| | ___| |__  ",
  "| |\\/| |/ _ \\ / __| |/ / |/ / | '_ \\ ",
  "| |  | | (_) | (__|   <|   <| | | | |",
  "|_|  |_|\\___/ \\___|_|\\_\\_|\\_\\_|_| |_|",
] as const;

export const MOEWALLS_BANNER = MOEWALLS_BANNER_LINES.join("\n");
export const MOEWALLS_TAGLINE = "live wallpaper browser";

export function renderSplash(state: MoewallsAppState): React.ReactElement {
  const dim = state.splashOpacity < SPLASH_DIM_OPACITY_THRESHOLD;
  return (
    <Box width="100%" height="100%" justifyContent="center" alignItems="center">
      <Box flexDirection="column" alignItems="center">
        {MOEWALLS_BANNER_LINES.map((line, index) => (
          <Text key={`banner-${index}`} dimColor={dim}>
            {line}
          </Text>
        ))}
        <Box marginTop={SPLASH_TAGLINE_MARGIN_TOP}>
          <Text color="gray" dimColor={dim}>
            {MOEWALLS_TAGLINE}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
