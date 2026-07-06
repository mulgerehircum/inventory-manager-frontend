// Pure layout math for the template editor's canvas. Extracted from templates/[id].vue so
// it can be unit tested directly — this is the exact logic that had real bugs during
// development (double-subtracting padding in the scale calc, tooltip clipping off-canvas).

export interface CanvasScaleInput {
  wrapperWidth: number
  wrapperHeight: number
  pageWidth: number
  pageHeight: number
}

// Shrinks the editable canvas to fit entirely inside its wrapper (no scroll needed) by
// scaling down to whatever fraction of the real page size actually fits. Never scales up
// past 1, so on a large enough wrapper the canvas renders at true size.
//
// Callers measuring wrapper size via ResizeObserver's contentRect should pass that value
// directly — contentRect already excludes padding/border, so don't subtract it again here
// (a real bug caught during development: subtracting it twice made the canvas render
// smaller than necessary).
export function computeCanvasScale({ wrapperWidth, wrapperHeight, pageWidth, pageHeight }: CanvasScaleInput): number {
  if (!wrapperWidth || !wrapperHeight) return 1
  const heightScale = wrapperHeight / pageHeight
  const widthScale = wrapperWidth / pageWidth
  return Math.min(1, heightScale, widthScale)
}

export interface TooltipPositionInput {
  elementX: number
  elementY: number
  elementHeight: number
  canvasScale: number
  tooltipWidth: number
  tooltipHeight: number
  pageWidth: number
  gap: number
}

export interface TooltipPosition {
  left: number
  top: number
}

// Positions a tooltip relative to the scaled canvas's own (0,0) origin, flipping above/below
// and clamping horizontally so it never escapes past the canvas's edges regardless of where
// the element sits (a real bug caught during development: an element near the top of the
// canvas pushed the tooltip above the visible page entirely).
export function computeTooltipPosition({
  elementX,
  elementY,
  elementHeight,
  canvasScale,
  tooltipWidth,
  tooltipHeight,
  pageWidth,
  gap
}: TooltipPositionInput): TooltipPosition {
  const scaledX = elementX * canvasScale
  const scaledY = elementY * canvasScale
  const scaledHeight = elementHeight * canvasScale
  const scaledCanvasWidth = pageWidth * canvasScale

  const fitsAbove = scaledY - gap - tooltipHeight >= 0
  const top = fitsAbove ? scaledY - gap - tooltipHeight : scaledY + scaledHeight + gap

  const maxLeft = Math.max(0, scaledCanvasWidth - tooltipWidth)
  const left = Math.min(scaledX, maxLeft)

  return { left, top }
}

// Cascades each new element diagonally by stepPx so newly-added elements don't all land
// exactly on top of each other; wraps back to 0 after wrapAfter steps so they don't drift
// off the page (a real bug caught during development: every new element defaulted to the
// exact same position, stacking Text+Field+Table on top of each other).
export function computeStagger(elementCount: number, stepPx = 24, wrapAfter = 8): number {
  return (elementCount % wrapAfter) * stepPx
}

// Dragging a page thumbnail from fromIndex to toIndex reshuffles every page in between by
// one slot. Returns a map where result[oldPageIndex] = newPageIndex, so callers can remap
// every element's `page` field (and `currentPage`) in one pass without hand-rolling the
// splice-and-reinsert dance at each call site.
export function computePageReorderMap(pageCount: number, fromIndex: number, toIndex: number): number[] {
  const order = Array.from({ length: pageCount }, (_, i) => i)
  const [moved] = order.splice(fromIndex, 1)
  order.splice(toIndex, 0, moved)

  const map = new Array(pageCount)
  order.forEach((oldIndex, newIndex) => {
    map[oldIndex] = newIndex
  })
  return map
}
