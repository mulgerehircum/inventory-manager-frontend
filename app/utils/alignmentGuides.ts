// Canva/Figma-style smart alignment guides for the template editor's canvas. Pure math,
// extracted so it's unit-testable — snapping decisions here directly control where an
// element ends up, so a bug is immediately visible as misplaced content in the PDF.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface EdgeCandidate {
  value: number
  kind: 'start' | 'center' | 'end'
}

function xEdges(r: Rect): EdgeCandidate[] {
  return [
    { value: r.x, kind: 'start' },
    { value: r.x + r.width / 2, kind: 'center' },
    { value: r.x + r.width, kind: 'end' }
  ]
}

function yEdges(r: Rect): EdgeCandidate[] {
  return [
    { value: r.y, kind: 'start' },
    { value: r.y + r.height / 2, kind: 'center' },
    { value: r.y + r.height, kind: 'end' }
  ]
}

interface Match {
  distance: number
  delta: number
  guide: number
  mineKind: EdgeCandidate['kind']
}

// Finds the closest-matching pair of candidate edges (within threshold) across all others.
// Only the single closest match wins per axis — real multi-guide UIs can show several at
// once, but one authoritative snap per axis keeps the result unambiguous.
function closestMatch(mine: EdgeCandidate[], others: Rect[], othersEdges: (r: Rect) => EdgeCandidate[], threshold: number): Match | null {
  let best: Match | null = null
  for (const other of others) {
    for (const target of othersEdges(other)) {
      for (const candidate of mine) {
        const distance = Math.abs(candidate.value - target.value)
        if (distance <= threshold && (!best || distance < best.distance)) {
          best = { distance, delta: target.value - candidate.value, guide: target.value, mineKind: candidate.kind }
        }
      }
    }
  }
  return best
}

export interface MoveSnapResult {
  dx: number
  dy: number
  verticalGuideX: number | null
  horizontalGuideY: number | null
}

// While dragging, the whole rect translates together, so all three edges (start/center/end)
// are candidates on both axes.
export function computeMoveSnap(moving: Rect, others: Rect[], threshold: number): MoveSnapResult {
  const xMatch = closestMatch(xEdges(moving), others, xEdges, threshold)
  const yMatch = closestMatch(yEdges(moving), others, yEdges, threshold)
  return {
    dx: xMatch?.delta ?? 0,
    dy: yMatch?.delta ?? 0,
    verticalGuideX: xMatch?.guide ?? null,
    horizontalGuideY: yMatch?.guide ?? null
  }
}

export interface ResizeSnapResult {
  dWidth: number
  dHeight: number
  verticalGuideX: number | null
  horizontalGuideY: number | null
}

// The resize handle is anchored at the top-left (see TemplateCanvasElement — only
// width/height change on resize), so the start edge is fixed and only the center/end
// edges move as the box grows or shrinks.
export function computeResizeSnap(moving: Rect, others: Rect[], threshold: number): ResizeSnapResult {
  const movingX = xEdges(moving).filter((e) => e.kind !== 'start')
  const movingY = yEdges(moving).filter((e) => e.kind !== 'start')

  const xMatch = closestMatch(movingX, others, xEdges, threshold)
  const yMatch = closestMatch(movingY, others, yEdges, threshold)

  const dWidth = xMatch
    ? (xMatch.mineKind === 'center' ? (xMatch.guide - moving.x) * 2 : xMatch.guide - moving.x) - moving.width
    : 0
  const dHeight = yMatch
    ? (yMatch.mineKind === 'center' ? (yMatch.guide - moving.y) * 2 : yMatch.guide - moving.y) - moving.height
    : 0

  return {
    dWidth,
    dHeight,
    verticalGuideX: xMatch?.guide ?? null,
    horizontalGuideY: yMatch?.guide ?? null
  }
}
