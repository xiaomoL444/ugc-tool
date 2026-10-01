export interface MinimapRect { x: number; y: number; width: number; height: number }

export function fitDialogueMinimap(width: number, height: number, mapWidth: number, mapHeight: number) {
  const scale = Math.min(mapWidth / Math.max(1, width), mapHeight / Math.max(1, height));
  return { scale, x: (mapWidth - width * scale) / 2, y: (mapHeight - height * scale) / 2 };
}

/** Clip only the drawing; navigation still uses the full viewport, including canvas margins. */
export function clipMinimapViewport(viewport: MinimapRect, width: number, height: number): MinimapRect {
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  const x = clamp(viewport.x, width), y = clamp(viewport.y, height);
  return { x, y, width: Math.max(0, clamp(viewport.x + viewport.width, width) - x),
    height: Math.max(0, clamp(viewport.y + viewport.height, height) - y) };
}

export function minimapPointToCanvas(x: number, y: number, projection: ReturnType<typeof fitDialogueMinimap>) {
  return { x: (x - projection.x) / projection.scale, y: (y - projection.y) / projection.scale };
}
