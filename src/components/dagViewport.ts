export interface DagViewport {
  x: number
  y: number
  k: number
}

// A collapsed graph has no usable viewport. Keep the previous transform until
// layout provides space, rather than mirroring nodes with a negative scale.
export function fitDagViewport(
  width: number,
  height: number,
  worldWidth: number,
  worldHeight: number
): DagViewport | null {
  if (
    ![width, height, worldWidth, worldHeight].every(Number.isFinite) ||
    width <= 24 ||
    height <= 24 ||
    worldWidth <= 0 ||
    worldHeight <= 0
  )
    return null
  const k = Math.min((width - 24) / worldWidth, (height - 24) / worldHeight, 1.15)
  if (!Number.isFinite(k) || k <= 0) return null
  return { k, x: (width - worldWidth * k) / 2, y: (height - worldHeight * k) / 2 }
}
