// Mirrors the backend's compileBackground (template-compiler.ts) exactly — shared by the
// canvas element renderer and the page-background preview so both match what the compiled
// PDF actually renders. A gradient takes over from a plain solid color whenever fill isn't
// 'solid' and at least 2 stops are present; otherwise the solid color (or nothing) applies.

import type { BackgroundFill, GradientStop } from '~/composables/useTemplatesApi'

export function computeBackground(
  fill: BackgroundFill | undefined,
  stops: GradientStop[] | undefined,
  angle: number | undefined,
  soloColor: string | undefined
): string | undefined {
  if (fill && fill !== 'solid' && stops && stops.length >= 2) {
    const stopList = stops.map((s) => `${s.color} ${s.position}%`).join(', ')
    const deg = angle ?? 135
    if (fill === 'radial') return `radial-gradient(circle, ${stopList})`
    if (fill === 'conic') return `conic-gradient(from ${deg}deg, ${stopList})`
    return `linear-gradient(${deg}deg, ${stopList})`
  }
  return soloColor || undefined
}
