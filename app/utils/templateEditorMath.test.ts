import { describe, expect, it } from 'vitest'
import { computeCanvasScale, computePageReorderMap, computeStagger, computeTooltipPosition } from './templateEditorMath'

describe('computeCanvasScale', () => {
  it('returns 1 when the wrapper has not been measured yet', () => {
    expect(computeCanvasScale({ wrapperWidth: 0, wrapperHeight: 0, pageWidth: 794, pageHeight: 1123 })).toBe(1)
  })

  it('scales down when height is the tighter constraint', () => {
    // wrapper: 900x800, page: 794x1123 -> heightScale (800/1123≈0.712) < widthScale (900/794≈1.133)
    const scale = computeCanvasScale({ wrapperWidth: 900, wrapperHeight: 800, pageWidth: 794, pageHeight: 1123 })
    expect(scale).toBeCloseTo(800 / 1123, 5)
  })

  it('scales down when width is the tighter constraint', () => {
    // wrapper: 500x2000 -> widthScale (500/794≈0.630) < heightScale (2000/1123≈1.781)
    const scale = computeCanvasScale({ wrapperWidth: 500, wrapperHeight: 2000, pageWidth: 794, pageHeight: 1123 })
    expect(scale).toBeCloseTo(500 / 794, 5)
  })

  it('never scales up past 1 even when the wrapper is much larger than the page', () => {
    const scale = computeCanvasScale({ wrapperWidth: 5000, wrapperHeight: 5000, pageWidth: 794, pageHeight: 1123 })
    expect(scale).toBe(1)
  })

  it('uses the wrapper size directly without subtracting anything extra', () => {
    // Regression test: an earlier version subtracted CANVAS_GUTTER a second time on top of
    // the already-gutter-excluded measurement, under-sizing the canvas. Passing a wrapper
    // exactly the size of the page (post-gutter) should yield exactly scale 1, not less.
    const scale = computeCanvasScale({ wrapperWidth: 794, wrapperHeight: 1123, pageWidth: 794, pageHeight: 1123 })
    expect(scale).toBe(1)
  })
})

describe('computeTooltipPosition', () => {
  const base = {
    elementX: 100,
    elementY: 200,
    elementHeight: 24,
    canvasScale: 1,
    tooltipWidth: 200,
    tooltipHeight: 80,
    pageWidth: 794,
    gap: 8
  }

  it('positions above the element when there is enough room', () => {
    const { top, left } = computeTooltipPosition(base)
    expect(top).toBe(200 - 8 - 80) // elementY - gap - tooltipHeight
    expect(left).toBe(100) // elementX, unclamped
  })

  it('flips below the element when there is not enough room above', () => {
    // elementY=20 is too close to the top for an 80px-tall tooltip + 8px gap to fit above.
    const { top } = computeTooltipPosition({ ...base, elementY: 20 })
    expect(top).toBe(20 + 24 + 8) // elementY + elementHeight + gap
  })

  it('clamps horizontally so the tooltip never spills past the right edge of the page', () => {
    // Element near the right edge: elementX (700) + tooltipWidth (200) > pageWidth (794).
    const { left } = computeTooltipPosition({ ...base, elementX: 700 })
    expect(left).toBe(794 - 200) // pageWidth - tooltipWidth, not elementX
  })

  it('does not clamp when the tooltip already fits within the page', () => {
    const { left } = computeTooltipPosition({ ...base, elementX: 50 })
    expect(left).toBe(50)
  })

  it('scales element position/size by canvasScale before positioning', () => {
    const { top, left } = computeTooltipPosition({ ...base, canvasScale: 0.5 })
    // scaledX = 50, scaledY = 100, scaledHeight = 12
    expect(left).toBe(50)
    expect(top).toBe(100 - 8 - 80)
  })
})

describe('computeStagger', () => {
  it('has no offset for the first element', () => {
    expect(computeStagger(0)).toBe(0)
  })

  it('increases by the step size per existing element', () => {
    expect(computeStagger(1)).toBe(24)
    expect(computeStagger(2)).toBe(48)
  })

  it('wraps back to 0 after the configured number of steps', () => {
    expect(computeStagger(8)).toBe(0)
    expect(computeStagger(9)).toBe(24)
  })

  it('respects custom step/wrap arguments', () => {
    expect(computeStagger(3, 10, 4)).toBe(30)
    expect(computeStagger(4, 10, 4)).toBe(0)
  })
})

describe('computePageReorderMap', () => {
  it('moves a page later, shifting the ones in between back by one', () => {
    // [0,1,2,3] -> move 0 to position 2 -> [1,2,0,3]
    const map = computePageReorderMap(4, 0, 2)
    expect(map).toEqual([2, 0, 1, 3])
  })

  it('moves a page earlier, shifting the ones in between forward by one', () => {
    // [0,1,2,3] -> move 3 to position 1 -> [0,3,1,2]
    const map = computePageReorderMap(4, 3, 1)
    expect(map).toEqual([0, 2, 3, 1])
  })

  it('is a no-op when moved to its own position', () => {
    const map = computePageReorderMap(3, 1, 1)
    expect(map).toEqual([0, 1, 2])
  })

  it('handles moving the first page to the last position', () => {
    // [0,1,2] -> move 0 to position 2 -> [1,2,0]
    const map = computePageReorderMap(3, 0, 2)
    expect(map).toEqual([2, 0, 1])
  })

  it('handles moving the last page to the first position', () => {
    // [0,1,2] -> move 2 to position 0 -> [2,0,1]
    const map = computePageReorderMap(3, 2, 0)
    expect(map).toEqual([1, 2, 0])
  })
})
