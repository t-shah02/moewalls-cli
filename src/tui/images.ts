export const DEFAULT_CELL_WIDTH_PX = 10;
export const DEFAULT_CELL_HEIGHT_PX = 20;

export function previewDimensions(
  terminalWidth: number,
  _terminalHeight: number,
  cellWidthPx = DEFAULT_CELL_WIDTH_PX,
  cellHeightPx = DEFAULT_CELL_HEIGHT_PX,
): { width: number; height: number } {
  const safeCellW = cellWidthPx > 0 ? cellWidthPx : DEFAULT_CELL_WIDTH_PX;
  const safeCellH = cellHeightPx > 0 ? cellHeightPx : DEFAULT_CELL_HEIGHT_PX;
  const width = Math.min(36, Math.max(20, Math.floor(terminalWidth * 0.32)));
  const widthPx = width * safeCellW;
  const height = Math.max(4, Math.round((widthPx * 9) / (16 * safeCellH)));
  return { width, height };
}
