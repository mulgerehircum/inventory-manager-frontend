<script setup lang="ts">
import type { ReportContext, TemplateElement } from '~/composables/useTemplatesApi'

const props = defineProps<{
  element: TemplateElement
  selected: boolean
  scale: number
  reportContext: ReportContext | null
}>()

const emit = defineEmits<{
  select: []
  move: [{ x: number; y: number }]
  resize: [{ width: number; height: number }]
  // Distinct from `resize` — this is the ResizeObserver-driven auto-fit sizing (text/field
  // boxes matching their own content), not a user drag, so it must never go through the
  // parent's alignment-snapping logic.
  autosize: [{ width: number; height: number }]
  interactionEnd: []
}>()

// Shows (and measures) the real resolved value for a field, not the raw {{ fieldPath }}
// placeholder — the placeholder is a different length than the actual rendered value
// (e.g. "generatedAt" resolves to "Jul 4, 2026, 1:27 AM"), which was causing auto-fit
// boxes sized off the placeholder to clip the real text once rendered into the PDF.
function fieldDisplayValue(fieldPath?: string) {
  if (!fieldPath) return '{{ ? }}'
  const value = props.reportContext?.[fieldPath as keyof ReportContext]
  if (value === undefined) return ['{{', fieldPath, '}}'].join(' ')
  return String(value)
}

// Table rows preview against the same real product data the PDF preview renders (falling
// back to the raw fieldPath, like fieldDisplayValue, until reportContext has loaded) —
// previously these showed the literal fieldPath ("sku") while the PDF preview showed real
// values ("WID-2"), so what you were editing didn't match what you'd get.
const sampleProducts = computed<Array<Record<string, unknown> | undefined>>(() => {
  const products = props.reportContext?.products
  if (!products || products.length === 0) return [undefined, undefined]
  return [products[0], products[1] ?? products[0]]
})

function tableCellValue(row: Record<string, unknown> | undefined, fieldPath: string) {
  if (!row) return fieldPath
  const value = row[fieldPath]
  return value === undefined ? fieldPath : String(value)
}

// Chart preview uses the *whole* real products array (not just the 2-row table sample) so
// bar heights are normalized against a realistic max, the same way the compiled PDF's
// maxOf/percentOf Handlebars helpers normalize against the real array at render time.
const chartProducts = computed<Array<Record<string, unknown>>>(() => props.reportContext?.products ?? [])

function chartBarPercent(row: Record<string, unknown>, field?: string) {
  if (!field) return 0
  const max = Math.max(0, ...chartProducts.value.map((p) => Number(p[field]) || 0))
  const value = Number(row[field]) || 0
  return max > 0 ? Math.round((value / max) * 100) : 0
}

function chartLabelValue(row: Record<string, unknown>, field?: string) {
  if (!field) return ''
  const value = row[field]
  return value === undefined ? '' : String(value)
}

// Mirrors the backend's compileBackground (template-compiler.ts) — a two-stop gradient
// takes over from the plain backgroundColor when both stops are set, so the canvas preview
// matches what the compiled PDF actually renders.
function elementBackground(el: TemplateElement) {
  if (el.gradientFrom && el.gradientTo) {
    return `linear-gradient(${el.gradientAngle ?? 135}deg, ${el.gradientFrom}, ${el.gradientTo})`
  }
  return el.backgroundColor || undefined
}

// Text/field boxes always fit their own content exactly (matching how the PDF renders
// them — see template-compiler.ts), so they render at natural size and report that size
// back to the parent model rather than being manually resizable.
const autoFitsContent = computed(() => props.element.type === 'text' || props.element.type === 'field')

const canvasElementEl = ref<HTMLElement | null>(null)
let bodyResizeObserver: ResizeObserver | null = null

watch(
  canvasElementEl,
  (el) => {
    bodyResizeObserver?.disconnect()
    bodyResizeObserver = null
    if (!el || !autoFitsContent.value) return
    bodyResizeObserver = new ResizeObserver(() => {
      const width = el.offsetWidth
      const height = el.offsetHeight
      if (width !== props.element.width || height !== props.element.height) {
        emit('autosize', { width, height })
      }
    })
    bodyResizeObserver.observe(el)
  },
  { immediate: true }
)

onBeforeUnmount(() => bodyResizeObserver?.disconnect())

function onDragStart(startEvent: PointerEvent) {
  startEvent.stopPropagation()
  emit('select')
  const startX = startEvent.clientX
  const startY = startEvent.clientY
  const originX = props.element.x
  const originY = props.element.y

  function onMove(moveEvent: PointerEvent) {
    const dx = (moveEvent.clientX - startX) / props.scale
    const dy = (moveEvent.clientY - startY) / props.scale
    emit('move', { x: Math.max(0, Math.round(originX + dx)), y: Math.max(0, Math.round(originY + dy)) })
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    emit('interactionEnd')
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onResizeStart(startEvent: PointerEvent) {
  startEvent.stopPropagation()
  emit('select')
  const startX = startEvent.clientX
  const startY = startEvent.clientY
  const originWidth = props.element.width
  const originHeight = props.element.height

  function onMove(moveEvent: PointerEvent) {
    const dx = (moveEvent.clientX - startX) / props.scale
    const dy = (moveEvent.clientY - startY) / props.scale
    emit('resize', { width: Math.max(1, Math.round(originWidth + dx)), height: Math.max(1, Math.round(originHeight + dy)) })
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    emit('interactionEnd')
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <div
    ref="canvasElementEl"
    class="canvas-element"
    :class="{ selected }"
    :style="{
      left: `${element.x}px`,
      top: `${element.y}px`,
      width: autoFitsContent ? 'auto' : `${element.width}px`,
      height: autoFitsContent ? 'auto' : `${element.height}px`,
      fontSize: `${element.fontSize ?? 12}px`,
      // Matches template-compiler.ts's fallback stack exactly — the actual font file is
      // loaded via the <link> useHead() injects in [id].vue based on which fonts are in use.
      fontFamily: element.fontFamily ? `'${element.fontFamily}', Helvetica, Arial, sans-serif` : undefined,
      fontWeight: element.bold ? 700 : undefined,
      fontStyle: element.italic ? 'italic' : undefined,
      textDecoration: element.underline ? 'underline' : undefined,
      color: element.color || undefined,
      background: elementBackground(element),
      borderRadius: element.borderRadius ? `${element.borderRadius}px` : undefined,
      boxShadow: element.boxShadow || undefined
    }"
    @pointerdown="onDragStart"
  >
    <div class="element-body" :class="{ 'no-padding': element.type === 'image' }">
      <template v-if="element.type === 'text'">{{ element.content || 'Text' }}</template>
      <template v-else-if="element.type === 'field'">{{ fieldDisplayValue(element.fieldPath) }}</template>
      <template v-else-if="element.type === 'table'">
        <table class="table-preview">
          <thead>
            <tr>
              <th v-for="col in element.columns" :key="col.label" :style="{ textAlign: col.align || undefined }">{{ col.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(product, n) in sampleProducts" :key="n">
              <td
                v-for="col in element.columns"
                :key="col.label"
                :style="{ textAlign: col.align || undefined, fontWeight: col.bold ? 700 : undefined }"
              >
                {{ tableCellValue(product, col.fieldPath) }}
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <template v-else-if="element.type === 'image'">
        <img v-if="element.imageData" :src="element.imageData" class="image-preview" alt="" />
        <div v-else class="image-placeholder">No image</div>
      </template>
      <template v-else-if="element.type === 'chart'">
        <div v-if="chartProducts.length === 0" class="chart-preview-empty">No data</div>
        <div v-else class="chart-preview">
          <div v-for="(row, n) in chartProducts" :key="n" class="chart-preview-col">
            <div
              class="chart-preview-bar"
              :style="{ height: `${chartBarPercent(row, element.chartValueField)}%`, background: element.chartBarColor || '#1f9d6e' }"
            ></div>
            <div v-if="element.chartLabelField" class="chart-preview-label">{{ chartLabelValue(row, element.chartLabelField) }}</div>
          </div>
        </div>
      </template>
      <!-- 'panel' has no content of its own — just the shared color/backgroundColor/
           borderRadius styling applied above on .canvas-element. -->
    </div>
    <div v-if="selected && !autoFitsContent" class="resize-handle" @pointerdown="onResizeStart"></div>
  </div>
</template>

<style scoped>
.canvas-element {
  position: absolute;
  box-sizing: border-box;
  /* outline (not border) — a border adds to the box's own rendered size, so a genuinely
     thin element (e.g. a 1px divider) would look ~4px+ thick, dominated by its own editing
     chrome. outline draws just outside the box without inflating it, so the true size stays
     visible — matching the real PDF, whose compiled .el has no border of its own at all. */
  outline: 2px dashed #a3adc2;
  background: rgba(79, 109, 245, 0.06);
  cursor: move;
  user-select: none;
  overflow: hidden;
}
.canvas-element.selected {
  outline-style: solid;
  outline-color: var(--color-primary);
}
.element-body {
  padding: 2px 4px;
  pointer-events: none;
  height: 100%;
  box-sizing: border-box;
  white-space: nowrap;
}
.table-preview {
  /* Matches the compiled PDF's table styling (template-compiler.ts) — plain black text,
     #ccc borders — rather than the app's theme, since this previews printed paper. */
  white-space: normal;
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85em;
}
.table-preview th,
.table-preview td {
  border: 1px solid #ccc;
  padding: 2px 4px;
  text-align: left;
}
.no-padding {
  padding: 0;
}
.image-preview {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.image-placeholder {
  /* Editor-only affordance (never appears in the real PDF) but still lives on the white
     canvas, so it needs a fixed color rather than the app's theme. */
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 0.85em;
}
.chart-preview {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  width: 100%;
  height: 100%;
}
.chart-preview-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
}
.chart-preview-bar {
  width: 100%;
  min-height: 2px;
  border-radius: 3px 3px 0 0;
}
.chart-preview-label {
  margin-top: 3px;
  font-size: 0.7em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.chart-preview-empty {
  margin: auto;
  color: #999;
  font-size: 0.85em;
}
.resize-handle {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 10px;
  height: 10px;
  background: var(--color-primary);
  border-radius: 2px;
  cursor: nwse-resize;
}
</style>
