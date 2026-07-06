import { describe, expect, it } from 'vitest'
import { computeMoveSnap, computeResizeSnap } from './alignmentGuides'

describe('computeMoveSnap', () => {
  const other = { x: 100, y: 100, width: 200, height: 50 } // edges: x 100/200/300, y 100/125/150

  it('snaps the left edge to another element\'s left edge', () => {
    const moving = { x: 103, y: 400, width: 60, height: 20 }
    const { dx, verticalGuideX } = computeMoveSnap(moving, [other], 6)
    expect(dx).toBe(-3) // 103 + dx = 100
    expect(verticalGuideX).toBe(100)
  })

  it('snaps center to center', () => {
    // moving center x = 30 + 33 = 63... use round numbers: width 60 -> center offset 30
    const moving = { x: 168, y: 400, width: 64, height: 20 } // center = 200, other center = 200
    const { dx, verticalGuideX } = computeMoveSnap(moving, [other], 6)
    expect(dx).toBe(0)
    expect(verticalGuideX).toBe(200)
  })

  it('snaps the right edge to another element\'s right edge', () => {
    const moving = { x: 240, y: 400, width: 62, height: 20 } // right = 302, other right = 300
    const { dx, verticalGuideX } = computeMoveSnap(moving, [other], 6)
    expect(dx).toBe(-2) // right becomes exactly 300
    expect(verticalGuideX).toBe(300)
  })

  it('snaps vertically the same way as horizontally', () => {
    // height chosen so the center/end edges (119/134) land nowhere near other's edges
    // (100/125/150) — only the start edge (104) is a candidate match here.
    const moving = { x: 400, y: 104, width: 60, height: 30 }
    const { dy, horizontalGuideY } = computeMoveSnap(moving, [other], 6)
    expect(dy).toBe(-4) // 104 + dy = 100
    expect(horizontalGuideY).toBe(100)
  })

  it('does not snap when nothing is within the threshold', () => {
    const moving = { x: 500, y: 500, width: 60, height: 20 }
    const result = computeMoveSnap(moving, [other], 6)
    expect(result.dx).toBe(0)
    expect(result.dy).toBe(0)
    expect(result.verticalGuideX).toBeNull()
    expect(result.horizontalGuideY).toBeNull()
  })

  it('picks the closest candidate when multiple are within threshold', () => {
    // Two others: one whose left edge is 2px away, one whose left edge is 5px away.
    // Width 500 keeps each one's own center/end edges far outside the threshold, so only
    // the start-edge distance (2 vs 5) decides the winner.
    const near = { x: 102, y: 0, width: 500, height: 10 }
    const far = { x: 95, y: 0, width: 500, height: 10 }
    const moving = { x: 100, y: 400, width: 60, height: 20 }
    const { verticalGuideX } = computeMoveSnap(moving, [far, near], 6)
    expect(verticalGuideX).toBe(102) // the closer match, not 95
  })
})

describe('computeResizeSnap', () => {
  const other = { x: 0, y: 0, width: 300, height: 100 } // edges: x 0/150/300, y 0/50/100

  it('snaps the right edge (width grows to match)', () => {
    const moving = { x: 50, y: 200, width: 197, height: 40 } // right = 247, nearest target 150? no -> use 300
    // right edge 247 is not within 6 of 150 or 300; adjust to be close to 300
    const closeToRight = { x: 50, y: 200, width: 248, height: 40 } // right = 298, within 6 of 300
    const { dWidth, verticalGuideX } = computeResizeSnap(closeToRight, [other], 6)
    expect(closeToRight.width + dWidth).toBe(250) // right becomes x(50) -> 300, width = 250
    expect(verticalGuideX).toBe(300)
  })

  it('snaps center-x (width adjusts so the box re-centers on the target)', () => {
    // other's centerX = 150. moving.x = 50, so width should become 2*(150-50) = 200
    const moving = { x: 50, y: 200, width: 196, height: 40 } // current center = 148, within 6 of 150
    const { dWidth, verticalGuideX } = computeResizeSnap(moving, [other], 6)
    expect(moving.width + dWidth).toBe(200)
    expect(verticalGuideX).toBe(150)
  })

  it('snaps the bottom edge (height grows to match)', () => {
    const moving = { x: 200, y: 10, width: 40, height: 87 } // bottom = 97, within 6 of 100
    const { dHeight, horizontalGuideY } = computeResizeSnap(moving, [other], 6)
    expect(moving.height + dHeight).toBe(90) // bottom becomes y(10) -> 100, height = 90
    expect(horizontalGuideY).toBe(100)
  })

  it('never adjusts based on the fixed start edge', () => {
    // moving.x already equals other's left edge (0) — resize must not react to that, only
    // to the end/center edges which actually move during a resize.
    const moving = { x: 0, y: 200, width: 40, height: 20 }
    const { dWidth, verticalGuideX } = computeResizeSnap(moving, [other], 6)
    expect(dWidth).toBe(0)
    expect(verticalGuideX).toBeNull()
  })

  it('does not snap when nothing is within threshold', () => {
    const moving = { x: 500, y: 500, width: 40, height: 20 }
    const result = computeResizeSnap(moving, [other], 6)
    expect(result.dWidth).toBe(0)
    expect(result.dHeight).toBe(0)
    expect(result.verticalGuideX).toBeNull()
    expect(result.horizontalGuideY).toBeNull()
  })
})
