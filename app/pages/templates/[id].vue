<script setup lang="ts">
import type { BackgroundFill, GradientStop, ReportContext, ReportFieldSchema, TemplateElement } from '~/composables/useTemplatesApi'

const route = useRoute()
const router = useRouter()
const {
  fetchTemplate,
  createTemplate,
  updateTemplate,
  previewPdf,
  fetchReportContext,
  fetchReportFields,
  fetchFontOptions,
  uploadImage,
  fetchSharedTemplateContent
} = useTemplatesApi()
const { isLoggedIn, logout } = useAuthApi()

async function handleLogout() {
  logout()
  await router.push('/')
}

const reportContext = ref<ReportContext | null>(null)
fetchReportContext()
  .then((context) => (reportContext.value = context))
  .catch(() => {
    // Non-fatal — field elements just fall back to showing the raw {{ fieldPath }} placeholder.
  })

// Backs the 'field' and table-column pickers below — sourced from the backend (see
// ReportsService.getFieldSchema) instead of a hardcoded list, so a field added there shows
// up here automatically instead of silently drifting out of sync.
const reportFieldSchema = ref<ReportFieldSchema | null>(null)
fetchReportFields()
  .then((schema) => (reportFieldSchema.value = schema))
  .catch(() => {
    // Non-fatal — pickers just show no options until this loads (existing fieldPath values
    // on already-placed elements are unaffected either way).
  })

// Backs the "Font" picker below — see GOOGLE_FONTS on the backend (google-fonts.ts), the
// single source of truth for what's selectable, validated, and actually linked in the PDF.
const fontOptions = ref<string[]>([])
fetchFontOptions()
  .then((fonts) => (fontOptions.value = fonts))
  .catch(() => {
    // Non-fatal — the picker just shows no options; an element with a fontFamily already set
    // still renders correctly, this only affects choosing/changing it.
  })

const isNew = route.params.id === 'new'
const templateId = ref<string>(isNew ? '' : (route.params.id as string))

const PAGE_WIDTH = 794
const PAGE_HEIGHT = 1123
const CANVAS_GUTTER = 24
const PAGE_THUMB_WIDTH = 64
const pageThumbScale = PAGE_THUMB_WIDTH / PAGE_WIDTH
const PAGE_THUMB_HEIGHT = PAGE_HEIGHT * pageThumbScale
const PREVIEW_DEBOUNCE_MS = 600

const name = ref('Untitled template')
// Gallery opt-in + freemium tier — like `name`, these aren't part of canvas undo/redo history,
// just the save payload and dirty-tracking snapshot.
const shared = ref(false)
const tier = ref<'free' | 'premium'>('free')
const pageBackgroundColor = ref<string | undefined>(undefined)
const pageBackgroundFill = ref<BackgroundFill | undefined>(undefined)
const pageGradientStops = ref<GradientStop[] | undefined>(undefined)
const pageGradientAngle = ref<number | undefined>(undefined)
const showPageBgPanel = ref(false)
// Mirrors elementBackground in TemplateCanvasElement.vue / compileBackground on the backend
// — see app/utils/gradientBackground.ts for the shared fill/stops -> CSS logic.
const pageBackgroundStyle = computed(() =>
  computeBackground(pageBackgroundFill.value, pageGradientStops.value, pageGradientAngle.value, pageBackgroundColor.value)
)
const elements = ref<TemplateElement[]>([])
const pageCount = ref(1)
const currentPage = ref(0)
// Only what's on the page being edited is ever shown/interacted with — cross-page elements
// share the same x/y coordinate space (each page is its own 0..PAGE_WIDTH/HEIGHT box), so
// mixing them into the canvas or alignment-guide math would be visually wrong.
const elementsOnCurrentPage = computed(() => elements.value.filter((el) => (el.page ?? 0) === currentPage.value))

// Loads whichever Google Fonts are actually used anywhere in the template (not just the
// current page, so switching pages never flashes unstyled text) — mirrors what
// template-compiler.ts does for the exported PDF, so the canvas actually matches it instead
// of just setting a font-family the browser has no font file for. Google Fonts CSS2 API
// wants '+' for spaces in the family param; every curated name here is plain words, so a
// simple space replace matches the encoding exactly (see google-fonts.ts on the backend).
const usedFontFamilies = computed(() => [...new Set(elements.value.map((el) => el.fontFamily).filter((f): f is string => !!f))])
useHead({
  link: computed(() =>
    usedFontFamilies.value.map((name) => ({
      key: `google-font-${name}`,
      rel: 'stylesheet',
      href: `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}&display=swap`
    }))
  )
})

// For the page-thumbnail sidebar — a live (read-only) mini render of each page's own
// content, reusing the same TemplateCanvasElement the main canvas uses, just tiny.
function elementsForPage(pageIndex: number) {
  return elements.value.filter((el) => (el.page ?? 0) === pageIndex)
}
const selectedId = ref<string | null>(null)
const isSaving = ref(false)
const saveError = ref('')
const loadError = ref('')

const previewCanvasEl = ref<HTMLCanvasElement | null>(null)
const hasRenderedPreview = ref(false)
const previewError = ref('')
let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null
// Guards against an older, slower-to-resolve preview request overwriting a newer one.
let previewRequestId = 0
const { renderToCanvas: renderPdfToCanvas, destroy: destroyPdfPreview } = usePdfPreview()
// The last-fetched PDF, kept around so a pure container resize can re-fit the preview
// without re-hitting the backend for unchanged content. Cached as a Blob, not an
// ArrayBuffer — pdfjs-dist transfers (detaches) the ArrayBuffer it's given to its worker,
// so a single ArrayBuffer can only ever be handed to getDocument() once; Blob.arrayBuffer()
// produces a fresh, non-detached copy on every call.
let lastPreviewBlob: Blob | null = null

const previewWrapperEl = ref<HTMLElement | null>(null)
const previewWrapperSize = reactive({ width: 0, height: 0 })
let previewResizeObserver: ResizeObserver | null = null

// Fits the preview to its box the same way the editable canvas fits its own (see
// computeCanvasScale) — the canvas otherwise renders at the PDF's true 1:1 size, which
// overflows a smaller preview panel instead of shrinking to fit like the old
// <iframe src="blob:...#view=Fit"> did automatically.
const previewScale = computed(() =>
  computeCanvasScale({
    wrapperWidth: previewWrapperSize.width,
    wrapperHeight: previewWrapperSize.height,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT
  })
)

onMounted(() => {
  if (!previewWrapperEl.value) return
  previewResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (!entry) return
    previewWrapperSize.width = entry.contentRect.width
    previewWrapperSize.height = entry.contentRect.height
  })
  previewResizeObserver.observe(previewWrapperEl.value)
})

onBeforeUnmount(() => {
  previewResizeObserver?.disconnect()
})

const selectedElement = computed(() => elementsOnCurrentPage.value.find((el) => el.id === selectedId.value) ?? null)

const canvasWrapperEl = ref<HTMLElement | null>(null)
const wrapperSize = reactive({ width: 0, height: 0 })
let resizeObserver: ResizeObserver | null = null

// See app/utils/templateEditorMath.ts for the scale calculation itself (unit tested there).
const canvasScale = computed(() =>
  computeCanvasScale({
    wrapperWidth: wrapperSize.width,
    wrapperHeight: wrapperSize.height,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT
  })
)

onMounted(() => {
  if (!canvasWrapperEl.value) return
  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (!entry) return
    wrapperSize.width = entry.contentRect.width
    wrapperSize.height = entry.contentRect.height
  })
  resizeObserver.observe(canvasWrapperEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

const TOOLTIP_GAP = 8
const tooltipEl = ref<HTMLElement | null>(null)
const tooltipSize = reactive({ width: 0, height: 0 })
let tooltipResizeObserver: ResizeObserver | null = null

// The tooltip is created/destroyed each time selection changes (v-if), so re-attach the
// observer whenever the underlying element changes rather than once in onMounted.
watch(tooltipEl, (el) => {
  tooltipResizeObserver?.disconnect()
  tooltipResizeObserver = null
  if (!el) return
  tooltipResizeObserver = new ResizeObserver(() => {
    // Use offsetWidth/Height (border-box, matching the element's real on-screen footprint)
    // rather than contentRect (excludes padding/border) — clamping needs the true footprint.
    tooltipSize.width = el.offsetWidth
    tooltipSize.height = el.offsetHeight
  })
  tooltipResizeObserver.observe(el)
})

onBeforeUnmount(() => {
  tooltipResizeObserver?.disconnect()
})

// See app/utils/templateEditorMath.ts for the flip/clamp logic itself (unit tested there).
const tooltipStyle = computed(() => {
  if (!selectedElement.value) return {}

  const { left, top } = computeTooltipPosition({
    elementX: selectedElement.value.x,
    elementY: selectedElement.value.y,
    elementHeight: selectedElement.value.height,
    canvasScale: canvasScale.value,
    tooltipWidth: tooltipSize.width,
    tooltipHeight: tooltipSize.height,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    gap: TOOLTIP_GAP
  })

  return { left: `${left}px`, top: `${top}px` }
})

// Canva-style smart alignment guides: while dragging/resizing, snap to other elements'
// edges/centers and show a line at the snapped position. See app/utils/alignmentGuides.ts
// for the math (unit tested there).
const SNAP_THRESHOLD_PX = 6
const activeGuideX = ref<number | null>(null)
const activeGuideY = ref<number | null>(null)

function otherRects(id: string) {
  return elementsOnCurrentPage.value
    .filter((el) => el.id !== id)
    .map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height }))
}

function handleMove(pos: { x: number; y: number }) {
  if (!selectedElement.value) return
  const threshold = SNAP_THRESHOLD_PX / canvasScale.value
  const moving = { x: pos.x, y: pos.y, width: selectedElement.value.width, height: selectedElement.value.height }
  const { dx, dy, verticalGuideX, horizontalGuideY } = computeMoveSnap(moving, otherRects(selectedElement.value.id), threshold)
  activeGuideX.value = verticalGuideX
  activeGuideY.value = horizontalGuideY
  // Keeps the element's edges within the page on both axes — otherwise a fast drag could
  // park it partway or fully off the printable canvas.
  const maxX = Math.max(0, PAGE_WIDTH - moving.width)
  const maxY = Math.max(0, PAGE_HEIGHT - moving.height)
  updateSelected({
    x: Math.min(Math.max(0, pos.x + dx), maxX),
    y: Math.min(Math.max(0, pos.y + dy), maxY)
  })
}

function handleResize(size: { width: number; height: number }) {
  if (!selectedElement.value) return
  const threshold = SNAP_THRESHOLD_PX / canvasScale.value
  const moving = { x: selectedElement.value.x, y: selectedElement.value.y, width: size.width, height: size.height }
  const { dWidth, dHeight, verticalGuideX, horizontalGuideY } = computeResizeSnap(moving, otherRects(selectedElement.value.id), threshold)
  activeGuideX.value = verticalGuideX
  activeGuideY.value = horizontalGuideY
  // Same bound as handleMove on both axes — resizing grows from the fixed top-left corner,
  // so cap width/height at whatever room is left before the page's right/bottom edge. Floor
  // of 1 (not some larger minimum) so a hairline divider/border panel stays draggable down to
  // its real 1px size instead of snapping back up.
  const maxWidth = Math.max(1, PAGE_WIDTH - selectedElement.value.x)
  const maxHeight = Math.max(1, PAGE_HEIGHT - selectedElement.value.y)
  updateSelected({
    width: Math.min(Math.max(1, size.width + dWidth), maxWidth),
    height: Math.min(Math.max(1, size.height + dHeight), maxHeight)
  })
}

function clearGuides() {
  activeGuideX.value = null
  activeGuideY.value = null
}

// Same clamp as handleMove's drag path — typed X/Y shouldn't be able to push the element
// off the page any more than dragging can.
function updatePositionX(value: number) {
  if (!selectedElement.value) return
  const maxX = Math.max(0, PAGE_WIDTH - selectedElement.value.width)
  updateSelected({ x: Math.min(Math.max(0, value), maxX) })
}

function updatePositionY(value: number) {
  if (!selectedElement.value) return
  const maxY = Math.max(0, PAGE_HEIGHT - selectedElement.value.height)
  updateSelected({ y: Math.min(Math.max(0, value), maxY) })
}

function addPage() {
  pageCount.value += 1
  goToPage(pageCount.value - 1)
}

function goToPage(index: number) {
  if (index === currentPage.value) return
  currentPage.value = index
  // The previous selection (if any) belongs to whatever page we're leaving — its tooltip
  // would otherwise keep floating over a canvas that no longer shows that element.
  selectedId.value = null
  clearGuides()
}

function removePage(index: number) {
  if (pageCount.value <= 1) return
  const elementsOnPage = elements.value.filter((el) => (el.page ?? 0) === index)
  if (elementsOnPage.length > 0) {
    const noun = elementsOnPage.length === 1 ? 'element' : 'elements'
    if (!confirm(`Remove page ${index + 1}? This also deletes its ${elementsOnPage.length} ${noun}.`)) return
  }

  // Drop this page's elements and shift every later page's elements down by one, keeping
  // page numbers contiguous (0..pageCount-2) rather than leaving a gap where index used to be.
  elements.value = elements.value
    .filter((el) => (el.page ?? 0) !== index)
    .map((el) => ((el.page ?? 0) > index ? { ...el, page: (el.page ?? 0) - 1 } : el))
  pageCount.value -= 1

  if (currentPage.value > index) {
    currentPage.value -= 1
  } else if (currentPage.value === index) {
    currentPage.value = Math.min(index, pageCount.value - 1)
  }
  selectedId.value = null
  clearGuides()
}

function duplicatePage(index: number) {
  const newPageIndex = index + 1
  // Make room right after the source page by pushing every later page back by one, then
  // deep-clone (JSON round-trip, same technique undo/redo uses) the source page's elements
  // onto that new slot — a shallow spread would leave the clone's table columns/etc sharing
  // the same nested arrays as the original, so editing one would silently edit both.
  const shifted = elements.value.map((el) => ((el.page ?? 0) > index ? { ...el, page: (el.page ?? 0) + 1 } : el))
  const sourceElements = elements.value.filter((el) => (el.page ?? 0) === index)
  const cloned: TemplateElement[] = JSON.parse(JSON.stringify(sourceElements)).map((el: TemplateElement) => ({
    ...el,
    id: makeId(),
    page: newPageIndex
  }))
  elements.value = [...shifted, ...cloned]
  pageCount.value += 1
  goToPage(newPageIndex)
}

// Drag-to-reorder pages, driven from the thumbnail's drag-handle icon. Pointer-based (not
// native HTML5 drag-and-drop) for consistency with how the canvas's own drag/resize already
// works elsewhere in this file, and to avoid native DnD's ghost-image/dragover boilerplate.
const draggingPageIndex = ref<number | null>(null)
const dragOverPageIndex = ref<number | null>(null)

function onPageHandlePointerDown(index: number, startEvent: PointerEvent) {
  startEvent.stopPropagation() // don't let this bubble into the thumb's own @click (goToPage)
  draggingPageIndex.value = index
  dragOverPageIndex.value = index

  function onMove(moveEvent: PointerEvent) {
    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null
    // data-page-index now lives on .page-row (thumb + its offset action column), not just
    // the thumb itself, so dragging over either part of a row still tracks correctly.
    const rowEl = target?.closest('.page-row') as HTMLElement | null
    if (!rowEl?.dataset.pageIndex) return
    dragOverPageIndex.value = Number(rowEl.dataset.pageIndex)
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (draggingPageIndex.value !== null && dragOverPageIndex.value !== null && dragOverPageIndex.value !== draggingPageIndex.value) {
      reorderPage(draggingPageIndex.value, dragOverPageIndex.value)
    }
    draggingPageIndex.value = null
    dragOverPageIndex.value = null
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// See app/utils/templateEditorMath.ts for computePageReorderMap (unit tested there).
function reorderPage(fromIndex: number, toIndex: number) {
  const map = computePageReorderMap(pageCount.value, fromIndex, toIndex)
  elements.value = elements.value.map((el) => ({ ...el, page: map[el.page ?? 0] }))
  currentPage.value = map[currentPage.value]
  selectedId.value = null
  clearGuides()
}

const pagesRailEl = ref<HTMLElement | null>(null)

// The rail itself is the only tab stop (each thumb is tabindex="-1", not independently
// tabbable) — arrow keys just scroll it by one row rather than moving focus between pages,
// matching a simple "scrollable list" rather than full roving-tabindex listbox semantics.
function handleRailKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const rowHeight = PAGE_THUMB_HEIGHT + 10 // thumbnail height + the rail's row gap
  pagesRailEl.value?.scrollBy({ top: event.key === 'ArrowDown' ? rowHeight : -rowHeight, behavior: 'smooth' })
}

// Sourced from the backend's field schema (see reportFieldSchema above) rather than
// hardcoded, so these stay in sync with whatever ReportsService actually exposes.
const scalarFieldOptions = computed(() => reportFieldSchema.value?.scalarFields ?? [])
const productColumnOptions = computed(() => reportFieldSchema.value?.productFields ?? [])

// '' maps to "no fontFamily set" (falls back to the page's default sans-serif) — see the
// updateSelected call above, which turns an empty string back into undefined before saving.
const fontSelectOptions = computed(() => [{ value: '', label: 'Default' }, ...fontOptions.value])

// Chart labels are optional (a chart can just show unlabeled bars) — '' maps to "no
// chartLabelField set", same undefined-on-clear convention as the font picker above.
const chartLabelOptions = computed(() => [{ value: '', label: 'None' }, ...productColumnOptions.value])

async function renderCurrentPreview() {
  if (!previewCanvasEl.value || !lastPreviewBlob) return
  const arrayBuffer = await lastPreviewBlob.arrayBuffer()
  // Renders onto the existing <canvas> in place — unlike an <iframe src="blob:...">,
  // this doesn't force the browser's native PDF viewer (and its own toolbar UI) to
  // fully reload on every keystroke-triggered preview update. pdfjs pages are 1-indexed,
  // so the editor's 0-indexed currentPage needs +1 — this always shows whichever page is
  // currently being edited, not just the document's first page.
  await renderPdfToCanvas(previewCanvasEl.value, arrayBuffer, PAGE_WIDTH * previewScale.value, currentPage.value + 1)
  hasRenderedPreview.value = true
}

async function refreshPreview() {
  const requestId = ++previewRequestId
  previewError.value = ''
  try {
    const blob = await previewPdf({
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
      pageBackgroundColor: pageBackgroundColor.value,
      pageBackgroundFill: pageBackgroundFill.value,
      pageGradientStops: pageGradientStops.value,
      pageGradientAngle: pageGradientAngle.value,
      pageCount: pageCount.value,
      elements: elements.value
    })
    if (requestId !== previewRequestId) return // a newer request already started

    lastPreviewBlob = blob
    await renderCurrentPreview()
  } catch (err) {
    if (requestId === previewRequestId) previewError.value = 'Could not render the preview.'
  }
}

function schedulePreview() {
  if (previewDebounceTimer) clearTimeout(previewDebounceTimer)
  previewDebounceTimer = setTimeout(refreshPreview, PREVIEW_DEBOUNCE_MS)
}

// Re-fits the already-fetched preview when the available space changes (e.g. a window
// resize) without re-hitting the backend for unchanged content.
watch(previewScale, () => {
  renderCurrentPreview().catch(() => {
    previewError.value = 'Could not render the preview.'
  })
})

// Switching pages re-renders the already-fetched PDF at the new page index — the content
// hasn't changed, just which page is being looked at, so no need to re-hit the backend.
watch(currentPage, () => {
  renderCurrentPreview().catch(() => {
    previewError.value = 'Could not render the preview.'
  })
})

watch(elements, schedulePreview, { deep: true })
// Page background/gradient changes are compiled into the PDF just like element styling, so
// they need the same debounced re-fetch — this was previously missing entirely (only
// history tracked these refs), so editing the page background never updated the live PDF
// preview, only the on-canvas CSS approximation.
watch([pageBackgroundColor, pageBackgroundFill, pageGradientStops, pageGradientAngle], schedulePreview, { deep: true })
// Unlike element edits, adding a page changes the document's actual page structure, so the
// backend needs to recompile it — refetch immediately rather than debouncing (it's a
// discrete, infrequent action, not a rapid-fire edit like typing or dragging).
watch(pageCount, refreshPreview)

onBeforeUnmount(() => {
  if (previewDebounceTimer) clearTimeout(previewDebounceTimer)
  destroyPdfPreview()
})

// Undo/redo for the canvas (elements + page background, not the template name). Snapshot-
// based: the whole state is JSON-cloned onto a history stack, debounced the same way the
// preview is — a burst of changes (typing, a drag, a resize) coalesces into a single undo
// step once the user pauses, rather than one step per keystroke or per dragged pixel.
const HISTORY_DEBOUNCE_MS = 500
const HISTORY_LIMIT = 50
interface HistoryState {
  elements: TemplateElement[]
  pageBackgroundColor?: string
  pageBackgroundFill?: BackgroundFill
  pageGradientStops?: GradientStop[]
  pageGradientAngle?: number
}
const history = ref<string[]>([])
const historyIndex = ref(-1)
let historyDebounceTimer: ReturnType<typeof setTimeout> | null = null
// Stops the deep watcher below from recording undo/redo's own restore as a brand-new step.
let isApplyingHistory = false

const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(() => historyIndex.value < history.value.length - 1)

function currentHistorySnapshot() {
  return JSON.stringify({
    elements: elements.value,
    pageBackgroundColor: pageBackgroundColor.value,
    pageBackgroundFill: pageBackgroundFill.value,
    pageGradientStops: pageGradientStops.value,
    pageGradientAngle: pageGradientAngle.value
  } satisfies HistoryState)
}

function commitHistory() {
  const snapshot = currentHistorySnapshot()
  if (history.value[historyIndex.value] === snapshot) return // nothing actually changed
  history.value = history.value.slice(0, historyIndex.value + 1) // drop the old redo branch
  history.value.push(snapshot)
  if (history.value.length > HISTORY_LIMIT) history.value.shift()
  historyIndex.value = history.value.length - 1
}

function scheduleHistoryCommit() {
  if (isApplyingHistory) return
  if (historyDebounceTimer) clearTimeout(historyDebounceTimer)
  historyDebounceTimer = setTimeout(commitHistory, HISTORY_DEBOUNCE_MS)
}

function applyHistoryAt(index: number) {
  isApplyingHistory = true
  historyIndex.value = index
  const restored = JSON.parse(history.value[index]) as HistoryState
  elements.value = restored.elements
  pageBackgroundColor.value = restored.pageBackgroundColor
  pageBackgroundFill.value = restored.pageBackgroundFill
  pageGradientStops.value = restored.pageGradientStops
  pageGradientAngle.value = restored.pageGradientAngle
  // Keep the current selection if that element still exists at this point in history
  // (e.g. undoing a move just moves it back); otherwise there's nothing sensible to select.
  if (!restored.elements.some((el) => el.id === selectedId.value)) selectedId.value = null
  nextTick(() => {
    isApplyingHistory = false
  })
}

function undo() {
  if (!canUndo.value) return
  if (historyDebounceTimer) {
    clearTimeout(historyDebounceTimer)
    historyDebounceTimer = null
  }
  commitHistory() // flush any pending (not-yet-debounced) edit as its own step before stepping back
  applyHistoryAt(historyIndex.value - 1)
}

function redo() {
  if (!canRedo.value) return
  applyHistoryAt(historyIndex.value + 1)
}

function handleUndoRedoKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  // Let native undo work inside text inputs/selects rather than hijacking it for canvas history.
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
  event.preventDefault()
  if (event.shiftKey) redo()
  else undo()
}

onMounted(() => window.addEventListener('keydown', handleUndoRedoKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleUndoRedoKeydown))

watch([elements, pageBackgroundColor, pageBackgroundFill, pageGradientStops, pageGradientAngle], scheduleHistoryCommit, { deep: true })

onBeforeUnmount(() => {
  if (historyDebounceTimer) clearTimeout(historyDebounceTimer)
})

// Warns before losing in-progress template edits, whether the user closes/refreshes the tab
// or navigates elsewhere in the app. lastSavedSnapshot is set once after initial load and
// again after every successful save; anything that changes the current state relative to
// that baseline counts as "unsaved".
function snapshotCurrent() {
  return JSON.stringify({
    name: name.value,
    shared: shared.value,
    tier: tier.value,
    pageBackgroundColor: pageBackgroundColor.value,
    pageBackgroundFill: pageBackgroundFill.value,
    pageGradientStops: pageGradientStops.value,
    pageGradientAngle: pageGradientAngle.value,
    pageCount: pageCount.value,
    elements: elements.value
  })
}

const lastSavedSnapshot = ref('')
const isDirty = computed(() => lastSavedSnapshot.value !== '' && snapshotCurrent() !== lastSavedSnapshot.value)
// Only true once the template actually has a saved copy on the backend (templateId set)
// AND nothing has changed since — a brand-new, never-saved template must still be savable
// even with zero edits (e.g. an intentionally empty template), so it's excluded here.
const hasNoUnsavedChanges = computed(() => !!templateId.value && !isDirty.value)

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload))

onBeforeRouteLeave(() => {
  if (!isDirty.value) return true
  return confirm('You have unsaved changes to this template. Leave without saving?')
})

// Pre-fills a brand-new (still unsaved) editor session from a shared gallery template — see
// templates/index.vue's handleUseTemplate, which routes here with ?from=<id> instead of
// requiring login just to start editing a free template. Deliberately does NOT set
// templateId, so hitting Save still goes through createTemplate (a real, auth-gated save),
// not an update to the source template.
async function loadFromShared(sourceId: string) {
  loadError.value = ''
  try {
    const content = await fetchSharedTemplateContent(sourceId)
    name.value = `${content.name} (Copy)`
    elements.value = content.elements
    pageCount.value = content.pageCount ?? 1
    pageBackgroundColor.value = content.pageBackgroundColor
    pageBackgroundFill.value = content.pageBackgroundFill
    pageGradientStops.value = content.pageGradientStops
    pageGradientAngle.value = content.pageGradientAngle
    currentPage.value = 0
  } catch (err: any) {
    loadError.value = err?.data?.message?.toString() ?? 'Could not load this template.'
  }
}

async function loadExisting() {
  if (isNew) return
  loadError.value = ''
  try {
    const template = await fetchTemplate(templateId.value)
    name.value = template.name
    shared.value = template.shared ?? false
    tier.value = template.tier ?? 'free'
    elements.value = template.elements
    pageCount.value = template.pageCount ?? 1
    pageBackgroundColor.value = template.pageBackgroundColor
    pageBackgroundFill.value = template.pageBackgroundFill
    pageGradientStops.value = template.pageGradientStops
    pageGradientAngle.value = template.pageGradientAngle
    currentPage.value = 0
  } catch (err: any) {
    // Templates are private to their creator — surfaces the backend's actual reason
    // ("Unauthorized" when logged out, "You do not own this template" otherwise) rather
    // than a generic message, since those are two different, actionable situations.
    loadError.value = err?.data?.message?.toString() ?? 'Could not load this template.'
  }
}

onMounted(async () => {
  const sharedFromId = isNew && typeof route.query.from === 'string' ? route.query.from : null
  if (sharedFromId) {
    await loadFromShared(sharedFromId)
  } else {
    await loadExisting()
  }
  // loadExisting()/loadFromShared() reassign `elements`, which the deep watchers above also react to;
  // cancel those scheduled duplicates so the initial preview/history entry aren't doubled.
  if (previewDebounceTimer) clearTimeout(previewDebounceTimer)
  if (historyDebounceTimer) clearTimeout(historyDebounceTimer)
  refreshPreview()
  // Baseline for dirty-tracking — anything changed after this point (including on a brand
  // new template with zero elements) counts as an unsaved change.
  lastSavedSnapshot.value = snapshotCurrent()
  // Starting point for undo/redo — "undo" from the very first edit returns here.
  history.value = [currentHistorySnapshot()]
  historyIndex.value = 0
})

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

// See app/utils/templateEditorMath.ts for computeStagger (unit tested there). Counts only
// the current page's elements so staggering restarts fresh on each new page rather than
// picking up wherever the last page's count left off.
function nextStagger() {
  return computeStagger(elementsOnCurrentPage.value.length)
}

function addElement(type: 'text' | 'field' | 'table' | 'panel' | 'chart') {
  const stagger = nextStagger()
  const base = { id: makeId(), x: 40 + stagger, y: 40 + stagger, width: 160, height: 24, fontSize: 12, page: currentPage.value }

  if (type === 'text') {
    elements.value.push({ ...base, type, content: 'Label' })
  } else if (type === 'field') {
    elements.value.push({ ...base, type, fieldPath: 'totalValue' })
  } else if (type === 'panel') {
    // Sized/colored to be visible immediately — an empty, invisible rect would be
    // indistinguishable from a failed click.
    elements.value.push({ ...base, type, width: 200, height: 400, backgroundColor: '#e2e8f0' })
  } else if (type === 'chart') {
    elements.value.push({
      ...base,
      type,
      width: 320,
      height: 160,
      itemsPath: 'products',
      chartValueField: 'quantity',
      chartBarColor: '#1f9d6e'
    })
  } else {
    elements.value.push({
      ...base,
      type,
      width: 320,
      height: 120,
      itemsPath: 'products',
      columns: []
    })
  }

  selectedId.value = base.id
}

const imageInputEl = ref<HTMLInputElement | null>(null)
const imageUploadError = ref('')
// Distinguishes "adding a brand-new image element" from "replacing the selected element's
// image" — both reuse the same hidden <input type="file">.
let imageUploadTargetId: string | null = null

function triggerAddImage() {
  imageUploadTargetId = null
  imageInputEl.value?.click()
}

function triggerReplaceImage() {
  if (!selectedId.value) return
  imageUploadTargetId = selectedId.value
  imageInputEl.value?.click()
}

async function handleImageFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-selecting the same file later
  if (!file) return

  imageUploadError.value = ''
  try {
    const { dataUri } = await uploadImage(file)

    if (imageUploadTargetId) {
      const target = elements.value.find((el) => el.id === imageUploadTargetId)
      if (target) target.imageData = dataUri
    } else {
      const stagger = nextStagger()
      const id = makeId()
      elements.value.push({
        id,
        type: 'image',
        x: 40 + stagger,
        y: 40 + stagger,
        width: 160,
        height: 120,
        page: currentPage.value,
        imageData: dataUri
      })
      selectedId.value = id
    }
  } catch (err: any) {
    imageUploadError.value = err?.data?.message?.toString() ?? 'Failed to upload image'
  }
}

function selectElement(id: string) {
  selectedId.value = id
}

function updateSelected(patch: Partial<TemplateElement>) {
  if (!selectedElement.value) return
  Object.assign(selectedElement.value, patch)
}

function removeSelected() {
  if (!selectedId.value) return
  elements.value = elements.value.filter((el) => el.id !== selectedId.value)
  selectedId.value = null
}

function addColumn() {
  // A non-empty default — the backend's TableColumn schema requires a non-empty label, so a
  // freshly-added column saved without being touched (e.g. renamed) shouldn't fail to save.
  selectedElement.value?.columns?.push({ label: 'SKU', fieldPath: 'sku' })
}

function removeColumn(index: number) {
  selectedElement.value?.columns?.splice(index, 1)
}

const columnCountLabel = computed(() => {
  const count = selectedElement.value?.columns?.length ?? 0
  return count === 1 ? '1 column' : `${count} columns`
})

async function handleSave() {
  if (!isLoggedIn.value) {
    saveError.value = 'Log in to save this template.'
    return
  }

  isSaving.value = true
  saveError.value = ''
  try {
    const payload = {
      name: name.value,
      shared: shared.value,
      tier: tier.value,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
      pageBackgroundColor: pageBackgroundColor.value,
      pageBackgroundFill: pageBackgroundFill.value,
      pageGradientStops: pageGradientStops.value,
      pageGradientAngle: pageGradientAngle.value,
      pageCount: pageCount.value,
      elements: elements.value
    }
    if (isNew || !templateId.value) {
      const created = await createTemplate(payload)
      templateId.value = created._id
      // Reset the dirty baseline before navigating so the route-leave guard doesn't
      // mistake this save-triggered redirect for an attempt to abandon unsaved changes.
      lastSavedSnapshot.value = snapshotCurrent()
      await router.replace(`/templates/${created._id}`)
    } else {
      await updateTemplate(templateId.value, payload)
      lastSavedSnapshot.value = snapshotCurrent()
    }
  } catch (err: any) {
    saveError.value = err?.data?.message?.toString() ?? 'Failed to save template'
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <main class="editor">
    <header class="toolbar card">
      <NuxtLink class="btn btn-secondary" to="/templates">&larr; Templates</NuxtLink>
      <input v-model="name" class="field-input name-input" placeholder="Template name" />
      <div class="page-bg-control">
        <button class="btn btn-secondary btn-sm" title="Page background (applies to every page)" @click="showPageBgPanel = !showPageBgPanel">
          Page background
        </button>
        <div v-if="showPageBgPanel" class="page-bg-panel card">
          <div class="page-bg-panel-header">
            <span class="page-bg-label">Page background</span>
            <button class="btn-icon-close" title="Close" @click="showPageBgPanel = false">&#10005;</button>
          </div>
          <GradientStopEditor
            :fill="pageBackgroundFill"
            :stops="pageGradientStops"
            :angle="pageGradientAngle"
            :solid-color="pageBackgroundColor"
            solid-placeholder="white"
            @update:fill="(v) => (pageBackgroundFill = v)"
            @update:stops="(v) => (pageGradientStops = v)"
            @update:angle="(v) => (pageGradientAngle = v)"
            @update:solidColor="(v) => (pageBackgroundColor = v)"
          />
        </div>
      </div>
      <button class="btn btn-secondary" :disabled="!canUndo" title="Undo (Ctrl+Z)" @click="undo">&#8630; Undo</button>
      <button class="btn btn-secondary" :disabled="!canRedo" title="Redo (Ctrl+Shift+Z)" @click="redo">&#8631; Redo</button>
      <label class="page-bg-gradient-toggle" title="List this template in the public gallery for anyone to preview and clone">
        <input type="checkbox" v-model="shared" />
        Share in gallery
      </label>
      <AppSelect
        v-if="shared"
        class="tier-select"
        :model-value="tier"
        :options="[{ value: 'free', label: 'Free' }, { value: 'premium', label: 'Premium' }]"
        @update:model-value="(v) => (tier = v as 'free' | 'premium')"
      />
      <button class="btn btn-primary" :disabled="isSaving || hasNoUnsavedChanges" @click="handleSave">
        {{ isSaving ? 'Saving…' : hasNoUnsavedChanges ? 'Saved!' : 'Save' }}
      </button>
      <span v-if="!isLoggedIn" class="hint-text">Log in (top right) to save — you can still design and preview without an account</span>
      <span v-else-if="!templateId" class="hint-text">Not saved yet — the preview still reflects your current edits</span>
      <button v-if="isLoggedIn" class="btn btn-secondary auth-toolbar-button" @click="handleLogout">Log out</button>
      <NuxtLink v-else class="btn btn-secondary auth-toolbar-button" to="/login">Log in</NuxtLink>
    </header>

    <p v-if="saveError" class="error-text">{{ saveError }}</p>
    <p v-if="loadError" class="error-text">{{ loadError }}</p>

    <div class="workspace">
      <aside class="editor-sidebar card">
        <p class="sidebar-section-title">Pages</p>
        <div
          ref="pagesRailEl"
          class="pages-rail"
          role="listbox"
          aria-label="Pages"
          tabindex="0"
          @keydown="handleRailKeydown"
        >
          <div
            v-for="pageNumber in pageCount"
            :key="pageNumber"
            class="page-row"
            :class="{
              dragging: draggingPageIndex === pageNumber - 1,
              'drag-over': dragOverPageIndex === pageNumber - 1 && draggingPageIndex !== pageNumber - 1
            }"
            :data-page-index="pageNumber - 1"
          >
            <div
              class="page-thumb"
              :class="{ active: pageNumber - 1 === currentPage }"
              :style="{ width: `${PAGE_THUMB_WIDTH}px`, height: `${PAGE_THUMB_HEIGHT}px` }"
              role="option"
              :aria-selected="pageNumber - 1 === currentPage"
              tabindex="-1"
              @click="goToPage(pageNumber - 1)"
            >
              <div
                class="page-thumb-canvas"
                :style="{
                  width: `${PAGE_WIDTH}px`,
                  height: `${PAGE_HEIGHT}px`,
                  transform: `scale(${pageThumbScale})`,
                  '--thumb-border-width': `${2 / pageThumbScale}px`,
                  background: pageBackgroundStyle
                }"
              >
                <TemplateCanvasElement
                  v-for="el in elementsForPage(pageNumber - 1)"
                  :key="el.id"
                  :element="el"
                  :selected="false"
                  :scale="pageThumbScale"
                  :report-context="reportContext"
                />
              </div>
              <span class="page-thumb-number">{{ pageNumber }}</span>
            </div>

            <div class="page-thumb-actions">
              <span
                class="page-thumb-handle"
                title="Drag to reorder"
                @pointerdown="onPageHandlePointerDown(pageNumber - 1, $event)"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                  <circle cx="4" cy="3" r="1.3" />
                  <circle cx="10" cy="3" r="1.3" />
                  <circle cx="4" cy="7" r="1.3" />
                  <circle cx="10" cy="7" r="1.3" />
                  <circle cx="4" cy="11" r="1.3" />
                  <circle cx="10" cy="11" r="1.3" />
                </svg>
              </span>
              <button
                class="page-thumb-icon-button"
                aria-label="Duplicate page"
                title="Duplicate page"
                @click.stop="duplicatePage(pageNumber - 1)"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
                  <rect x="1" y="1" width="8" height="8" rx="1.2" />
                  <rect x="5" y="5" width="8" height="8" rx="1.2" />
                </svg>
              </button>
              <button
                v-if="pageCount > 1"
                class="page-thumb-icon-button danger"
                aria-label="Remove page"
                title="Remove this page"
                @click.stop="removePage(pageNumber - 1)"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
                  <path d="M2 3.5h10" stroke-linecap="round" />
                  <path d="M5 3.5v-1a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
                  <path d="M3.2 3.5l0.5 8a1 1 0 0 0 1 0.9h4.6a1 1 0 0 0 1-0.9l0.5-8" />
                  <path d="M5.5 6v4M8.5 6v4" stroke-linecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div class="page-row">
            <button
              class="page-add-button"
              :style="{ width: `${PAGE_THUMB_WIDTH}px`, height: `${PAGE_THUMB_HEIGHT}px` }"
              @click="addPage"
            >
              <span class="page-add-icon">+</span>
              <span class="page-add-label">Add page</span>
            </button>
            <div class="page-actions-spacer"></div>
          </div>
        </div>

        <div class="sidebar-divider"></div>

        <p class="sidebar-section-title">Add element</p>

        <button class="element-button" @click="addElement('text')">
          <svg class="element-button-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <path d="M2 4h12" />
            <path d="M2 8h12" />
            <path d="M2 12h7" />
          </svg>
          Text label
          <span class="element-button-plus">+</span>
        </button>
        <button class="element-button" @click="triggerAddImage">
          <svg class="element-button-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <circle cx="5.2" cy="6" r="1.2" />
            <path d="M2 12l3.5-4 2.5 3 2-2.5L14 12" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Image
          <span class="element-button-plus">+</span>
        </button>
        <button class="element-button" @click="addElement('panel')">
          <svg class="element-button-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
          </svg>
          Panel
          <span class="element-button-plus">+</span>
        </button>

        <p class="palette-group-label">Data-bound</p>

        <button class="element-button" @click="addElement('field')">
          <svg class="element-button-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 2c-1.5 0-2 .8-2 2v2c0 1-.5 1.5-1.5 1.5.9 0 1.5.5 1.5 1.5v2c0 1.2.5 2 2 2" />
            <path d="M10 2c1.5 0 2 .8 2 2v2c0 1 .5 1.5 1.5 1.5-.9 0-1.5.5-1.5 1.5v2c0 1.2-.5 2-2 2" />
          </svg>
          Data field
          <span class="element-button-plus">+</span>
        </button>
        <button class="element-button" @click="addElement('table')">
          <svg class="element-button-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
            <path d="M1.5 6.5h13M1.5 10.5h13M6 2.5v11M10.5 2.5v11" />
          </svg>
          Table
          <span class="element-button-plus">+</span>
        </button>
        <button class="element-button" @click="addElement('chart')">
          <svg class="element-button-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">
            <path d="M2 14V2M2 14h12" />
            <path d="M5 14V9M8.3 14V6M11.6 14v-9" stroke-linecap="butt" />
          </svg>
          Chart
          <span class="element-button-plus">+</span>
        </button>

        <input
          ref="imageInputEl"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          class="hidden-file-input"
          @change="handleImageFileSelected"
        />
        <p v-if="imageUploadError" class="error-text">{{ imageUploadError }}</p>
      </aside>

      <div ref="canvasWrapperEl" class="canvas-wrapper" :style="{ width: `${PAGE_WIDTH + CANVAS_GUTTER * 2}px` }">
        <div class="canvas-scale-box" :style="{ width: `${PAGE_WIDTH * canvasScale}px`, height: `${PAGE_HEIGHT * canvasScale}px` }">
          <div
            class="canvas"
            :style="{
              width: `${PAGE_WIDTH}px`,
              height: `${PAGE_HEIGHT}px`,
              transform: `scale(${canvasScale})`,
              background: pageBackgroundStyle
            }"
            @pointerdown="selectedId = null"
          >
            <TemplateCanvasElement
              v-for="el in elementsOnCurrentPage"
              :key="el.id"
              :element="el"
              :selected="el.id === selectedId"
              :scale="canvasScale"
              :report-context="reportContext"
              @select="selectElement(el.id)"
              @move="handleMove"
              @resize="handleResize"
              @autosize="(size) => updateSelected(size)"
              @interaction-end="clearGuides"
            />
            <div v-if="activeGuideX !== null" class="guide-line guide-vertical" :style="{ left: `${activeGuideX}px` }"></div>
            <div v-if="activeGuideY !== null" class="guide-line guide-horizontal" :style="{ top: `${activeGuideY}px` }"></div>
          </div>

          <div
            v-if="selectedElement"
            ref="tooltipEl"
            class="element-tooltip"
            :style="tooltipStyle"
          >
            <div class="tooltip-header">
              <span class="type-badge">{{ selectedElement.type }}</span>
              <button class="tooltip-delete-button" aria-label="Delete element" title="Delete element" @click="removeSelected">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>
            </div>

            <div v-if="selectedElement.type === 'text'" class="field-group">
              <label>Content</label>
              <input
                :value="selectedElement.content"
                @input="updateSelected({ content: ($event.target as HTMLInputElement).value })"
              />
            </div>

            <div v-else-if="selectedElement.type === 'field'" class="field-group">
              <label>Field</label>
              <AppSelect
                :model-value="selectedElement.fieldPath ?? ''"
                :options="scalarFieldOptions"
                @update:model-value="(v) => updateSelected({ fieldPath: v })"
              />
            </div>

            <template v-else-if="selectedElement.type === 'table'">
              <div class="field-group">
                <div class="columns-section-header">
                  <label>Columns</label>
                  <span class="columns-count">{{ columnCountLabel }}</span>
                </div>

                <div v-if="selectedElement.columns?.length" class="columns-list">
                  <div class="column-row column-row-header">
                    <span class="column-header-label">Label</span>
                    <span class="column-header-label">Data key</span>
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <template v-for="(col, index) in selectedElement.columns" :key="index">
                    <div class="column-row">
                      <input v-model="col.label" placeholder="Label" class="column-label" />
                      <AppSelect v-model="col.fieldPath" class="column-datakey-select" :options="productColumnOptions" />
                      <button
                        type="button"
                        class="column-bold-toggle"
                        :class="{ active: col.bold }"
                        aria-label="Bold"
                        :aria-pressed="col.bold ?? false"
                        title="Bold"
                        @click="col.bold = !col.bold"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        class="column-align-toggle"
                        aria-label="Cycle text alignment"
                        :title="`Align: ${col.align ?? 'left'} (click to change)`"
                        @click="col.align = col.align === 'left' || !col.align ? 'center' : col.align === 'center' ? 'right' : 'left'"
                      >
                        <svg v-if="(col.align ?? 'left') === 'left'" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                          <path d="M1.5 2.5h9M1.5 6h5.5M1.5 9.5h9" />
                        </svg>
                        <svg v-else-if="col.align === 'center'" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                          <path d="M1.5 2.5h9M3.25 6h5.5M1.5 9.5h9" />
                        </svg>
                        <svg v-else width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                          <path d="M1.5 2.5h9M5 6h5.5M1.5 9.5h9" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="column-badge-toggle"
                        :class="{ active: col.badge }"
                        aria-label="Render as true/false badge"
                        :aria-pressed="col.badge ?? false"
                        title="Render as true/false badge"
                        @click="col.badge = !col.badge"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M12 2l2.9 6.3 6.9.8-5 4.8 1.3 6.8L12 17.6 6 20.7l1.3-6.8-5-4.8 6.9-.8z" />
                        </svg>
                      </button>
                      <button class="column-remove-button" aria-label="Remove column" title="Remove column" @click="removeColumn(index)">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <div v-if="col.badge" class="badge-config">
                      <div class="badge-state">
                        <span class="badge-state-heading">True</span>
                        <input v-model="col.badgeTrueLabel" placeholder="Label (e.g. OK)" class="badge-label-input" />
                        <div class="badge-color-row">
                          <AppColorInput :model-value="col.badgeTrueBg" placeholder="bg" @update:model-value="(v) => (col.badgeTrueBg = v)" />
                          <AppColorInput :model-value="col.badgeTrueColor" placeholder="text" @update:model-value="(v) => (col.badgeTrueColor = v)" />
                        </div>
                      </div>
                      <div class="badge-state">
                        <span class="badge-state-heading">False</span>
                        <input v-model="col.badgeFalseLabel" placeholder="Label (e.g. Low stock)" class="badge-label-input" />
                        <div class="badge-color-row">
                          <AppColorInput :model-value="col.badgeFalseBg" placeholder="bg" @update:model-value="(v) => (col.badgeFalseBg = v)" />
                          <AppColorInput :model-value="col.badgeFalseColor" placeholder="text" @update:model-value="(v) => (col.badgeFalseColor = v)" />
                        </div>
                      </div>
                    </div>
                  </template>
                </div>
                <div v-else class="columns-empty">No columns yet</div>

                <button class="add-column-button" @click="addColumn">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add column
                </button>
              </div>
            </template>

            <div v-else-if="selectedElement.type === 'chart'" class="field-group">
              <label>Chart data</label>
              <div class="style-row">
                <span class="style-row-label">Value</span>
                <AppSelect
                  class="style-row-select"
                  :model-value="selectedElement.chartValueField ?? ''"
                  :options="productColumnOptions"
                  @update:model-value="(v) => updateSelected({ chartValueField: v })"
                />
              </div>
              <div class="style-row">
                <span class="style-row-label">Label</span>
                <AppSelect
                  class="style-row-select"
                  :model-value="selectedElement.chartLabelField ?? ''"
                  :options="chartLabelOptions"
                  @update:model-value="(v) => updateSelected({ chartLabelField: v || undefined })"
                />
              </div>
              <div class="style-row">
                <span class="style-row-label">Bar color</span>
                <AppColorInput
                  :model-value="selectedElement.chartBarColor"
                  placeholder="#1f9d6e"
                  @update:model-value="(v) => updateSelected({ chartBarColor: v })"
                />
              </div>
            </div>

            <div v-else-if="selectedElement.type === 'image'" class="field-group">
              <img v-if="selectedElement.imageData" :src="selectedElement.imageData" class="image-thumb" alt="" />
              <button class="btn btn-secondary small-button" @click="triggerReplaceImage">Replace image</button>
            </div>

            <div class="field-group">
              <label>Position (px)</label>
              <div class="dimensions-row">
                <input
                  type="number"
                  aria-label="X (px)"
                  placeholder="X"
                  :value="selectedElement.x"
                  @input="updatePositionX(Number(($event.target as HTMLInputElement).value))"
                />
                <span class="dimensions-separator">,</span>
                <input
                  type="number"
                  aria-label="Y (px)"
                  placeholder="Y"
                  :value="selectedElement.y"
                  @input="updatePositionY(Number(($event.target as HTMLInputElement).value))"
                />
              </div>
            </div>

            <div v-if="selectedElement.type !== 'text' && selectedElement.type !== 'field'" class="field-group">
              <label>Dimensions (px)</label>
              <div class="dimensions-row">
                <input
                  type="number"
                  min="1"
                  aria-label="Width (px)"
                  placeholder="Width"
                  :value="selectedElement.width"
                  @input="updateSelected({ width: Math.max(1, Number(($event.target as HTMLInputElement).value)) })"
                />
                <span class="dimensions-separator">×</span>
                <input
                  type="number"
                  min="1"
                  aria-label="Height (px)"
                  placeholder="Height"
                  :value="selectedElement.height"
                  @input="updateSelected({ height: Math.max(1, Number(($event.target as HTMLInputElement).value)) })"
                />
              </div>
            </div>

            <div class="field-group">
              <label>Style</label>
              <div
                v-if="
                  selectedElement.type === 'text' ||
                  selectedElement.type === 'field' ||
                  selectedElement.type === 'table' ||
                  selectedElement.type === 'chart'
                "
                class="style-row"
              >
                <span class="style-row-label">Font</span>
                <AppSelect
                  class="style-row-select"
                  :model-value="selectedElement.fontFamily ?? ''"
                  :options="fontSelectOptions"
                  @update:model-value="(v) => updateSelected({ fontFamily: v || undefined })"
                />
              </div>
              <div v-if="selectedElement.type === 'text' || selectedElement.type === 'field'" class="style-row">
                <span class="style-row-label">Format</span>
                <div class="format-toggle-group">
                  <button
                    type="button"
                    class="format-toggle-button bold-label"
                    :class="{ active: selectedElement.bold }"
                    title="Bold"
                    aria-label="Bold"
                    :aria-pressed="selectedElement.bold ?? false"
                    @click="updateSelected({ bold: !selectedElement.bold })"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    class="format-toggle-button italic-label"
                    :class="{ active: selectedElement.italic }"
                    title="Italic"
                    aria-label="Italic"
                    :aria-pressed="selectedElement.italic ?? false"
                    @click="updateSelected({ italic: !selectedElement.italic })"
                  >
                    I
                  </button>
                  <button
                    type="button"
                    class="format-toggle-button underline-label"
                    :class="{ active: selectedElement.underline }"
                    title="Underline"
                    aria-label="Underline"
                    :aria-pressed="selectedElement.underline ?? false"
                    @click="updateSelected({ underline: !selectedElement.underline })"
                  >
                    U
                  </button>
                </div>
              </div>
              <div v-if="selectedElement.type === 'text' || selectedElement.type === 'field'" class="style-row">
                <span class="style-row-label">Text</span>
                <AppColorInput
                  :model-value="selectedElement.color"
                  placeholder="default"
                  @update:model-value="(v) => updateSelected({ color: v })"
                />
              </div>
              <div class="field-group">
                <label>Background</label>
                <GradientStopEditor
                  :fill="selectedElement.backgroundFill"
                  :stops="selectedElement.gradientStops"
                  :angle="selectedElement.gradientAngle"
                  :solid-color="selectedElement.backgroundColor"
                  solid-placeholder="none"
                  @update:fill="(v) => updateSelected({ backgroundFill: v })"
                  @update:stops="(v) => updateSelected({ gradientStops: v })"
                  @update:angle="(v) => updateSelected({ gradientAngle: v })"
                  @update:solidColor="(v) => updateSelected({ backgroundColor: v })"
                />
              </div>
              <div class="style-row">
                <span class="style-row-label">Radius</span>
                <input
                  type="number"
                  min="0"
                  class="font-size-input"
                  :value="selectedElement.borderRadius ?? 0"
                  @input="updateSelected({ borderRadius: Number(($event.target as HTMLInputElement).value) })"
                />
              </div>
              <div class="style-row">
                <span class="style-row-label">Shadow</span>
                <input
                  type="text"
                  class="shadow-input"
                  placeholder="e.g. 6px 6px 0 #111"
                  :value="selectedElement.boxShadow ?? ''"
                  @input="updateSelected({ boxShadow: ($event.target as HTMLInputElement).value || undefined })"
                />
              </div>
            </div>

            <div v-if="selectedElement.type !== 'image' && selectedElement.type !== 'panel'" class="field-group">
              <label>Size (px)</label>
              <input
                type="number"
                class="font-size-input"
                :value="selectedElement.fontSize"
                @input="updateSelected({ fontSize: Number(($event.target as HTMLInputElement).value) })"
              />
            </div>

            <div class="autosave-line">
              <div class="autosave-message">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span>Changes save automatically</span>
              </div>
              <button type="button" class="tooltip-close-button" aria-label="Close" title="Close" @click="selectedId = null">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <aside class="preview card" :style="{ width: `${PAGE_WIDTH + CANVAS_GUTTER * 2}px` }">
        <p v-if="previewError" class="error-text preview-message">{{ previewError }}</p>
        <p v-else-if="!hasRenderedPreview" class="hint-text preview-message">Add an element to see a PDF preview here.</p>
        <div ref="previewWrapperEl" class="preview-canvas-scroll" v-show="!previewError && hasRenderedPreview">
          <canvas ref="previewCanvasEl" class="preview-canvas"></canvas>
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.editor {
  padding: var(--space-4);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
}
.name-input {
  flex: 1;
  max-width: 300px;
}
.page-bg-control {
  position: relative;
  flex-shrink: 0;
}
.page-bg-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 60;
  width: 240px;
  padding: var(--space-3);
  box-shadow: var(--shadow-lg);
}
.page-bg-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}
.page-bg-label {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}
.btn-icon-close {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--color-text-faint);
  cursor: pointer;
  font-size: 11px;
}
.btn-icon-close:hover {
  background: var(--color-bg);
  color: var(--color-text);
}
.page-bg-gradient-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
  cursor: pointer;
}
.tier-select {
  width: 110px;
  flex-shrink: 0;
}
.auth-toolbar-button {
  margin-left: auto;
  white-space: nowrap;
}
.element-tooltip {
  /* position/top/left come from the computed tooltipStyle (JS-measured, flips/clamps to
     stay on-canvas) — only cosmetic properties are set here. */
  position: absolute;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  width: 260px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.tooltip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.field-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.element-tooltip label {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
}
.type-badge {
  align-self: flex-start;
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  padding: 3px var(--space-3);
  border-radius: var(--radius-pill);
}
.tooltip-delete-button {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-danger-soft);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-danger);
  cursor: pointer;
}
.tooltip-delete-button:hover {
  background: var(--color-danger-soft);
}
.element-tooltip input,
.element-tooltip select {
  font-family: inherit;
  font-size: var(--text-sm);
  padding: 4px var(--space-2);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  width: 100%;
}
.element-tooltip :deep(.app-select-trigger) {
  padding: 4px var(--space-2);
}
.font-size-input {
  width: 60px !important;
}
.columns-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.columns-count {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.columns-empty {
  padding: var(--space-3) var(--space-2);
  text-align: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 11.5px;
  color: var(--color-text-faint);
}
.columns-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.column-row {
  display: grid;
  grid-template-columns: 1fr 1fr 20px 20px 20px 20px;
  gap: var(--space-1);
  align-items: stretch;
}
.column-row-header {
  padding: 0 var(--space-1);
}
.column-header-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
}
.column-datakey-select :deep(.app-select-trigger) {
  font-family: ui-monospace, Menlo, monospace;
}
.column-bold-toggle,
.column-align-toggle {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-faint);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
.column-bold-toggle:hover,
.column-align-toggle:hover {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.column-bold-toggle.active {
  color: var(--color-primary);
}
.column-remove-button {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-faint);
  cursor: pointer;
}
.column-remove-button:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
.column-badge-toggle {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-faint);
  cursor: pointer;
}
.column-badge-toggle:hover {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.column-badge-toggle.active {
  color: var(--color-primary);
}
.format-toggle-group {
  display: flex;
  gap: 2px;
}
.format-toggle-button {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 700;
  cursor: pointer;
}
.format-toggle-button:hover {
  border-color: var(--color-primary);
}
.format-toggle-button.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
.format-toggle-button.italic-label {
  font-style: italic;
}
.format-toggle-button.underline-label {
  text-decoration: underline;
}
.badge-config {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  margin-top: -2px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
}
.badge-state {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.badge-state-heading {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
}
.badge-label-input {
  width: 100%;
}
.badge-color-row {
  display: flex;
  gap: var(--space-1);
}
.badge-color-row > * {
  flex: 1;
  min-width: 0;
}
.style-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.style-row + .style-row {
  margin-top: var(--space-1);
}
.style-row-label {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.style-row .app-color-input {
  max-width: 160px;
}
.style-row-select {
  max-width: 160px;
}
.shadow-input {
  max-width: 160px;
}
.dimensions-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.dimensions-row input {
  flex: 1;
  min-width: 0;
}
.dimensions-separator {
  flex-shrink: 0;
  color: var(--color-text-faint);
  font-size: var(--text-xs);
}
.add-column-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  margin-top: var(--space-1);
  padding: var(--space-2) 0;
  border: 1px dashed var(--color-border-strong);
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.add-column-button:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.autosave-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--color-primary);
}
.autosave-message {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.autosave-line span {
  font-size: 11.5px;
  color: var(--color-text-faint);
}
.tooltip-close-button {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
.tooltip-close-button:hover {
  background: var(--color-border);
  color: var(--color-text);
}
.editor-sidebar {
  /* Pages and Add element used to be two separate floating cards of mismatched height/width
     — one sidebar with two sections (divided below) reads as one tool instead of two. */
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
}
/* Same weight/size for both section headers — Pages picking matters just as much as Add
   element, so neither should read as the lesser one. */
.sidebar-section-title {
  margin: 0 0 var(--space-1);
  font-weight: 500;
  font-size: var(--text-lg);
  color: var(--color-text);
}
.sidebar-divider {
  border-top: 1px solid var(--color-border);
  margin: var(--space-1) 0 var(--space-2);
}
.pages-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  max-height: 340px;
  overflow-y: auto;
  padding: 4px;
  /* Firefox fallback — Firefox has no ::-webkit-scrollbar support, but does support these. */
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}
.pages-rail::-webkit-scrollbar {
  width: 5px;
}
.pages-rail::-webkit-scrollbar-track {
  background: transparent;
}
.pages-rail::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 3px;
}
.pages-rail:hover::-webkit-scrollbar-thumb {
  background: var(--color-text-faint);
}
.pages-rail:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
.page-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  justify-content: center;
}
.page-row.dragging {
  opacity: 0.4;
}
.page-row.dragging .page-thumb-handle {
  cursor: grabbing;
}
.page-thumb {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
  background: #fff;
  /* Width/style stay fixed across every state below (only color/style change) — the
     thumbnail's own content (.page-thumb-canvas) is absolutely positioned relative to this
     element's padding box, so changing border-width shifts that content by the difference. */
  border: 2.5px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.1s ease;
}
.page-thumb:hover {
  border-color: var(--color-border-strong);
}
.page-thumb.active {
  border-color: var(--color-primary);
}
/* Drop target while dragging a page — dashed, so it's visibly distinct from the active
   page's solid border (this can be the same thumb as the active page). Declared after
   .active so it wins on equal specificity when dragging onto the current page. */
.page-row.drag-over .page-thumb {
  border-style: dashed;
  border-color: var(--color-primary);
}
.page-thumb:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.page-thumb-canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  /* Read-only preview — clicks should select the page (via .page-thumb), not drag the
     elements inside it like the real editable canvas does. */
  pointer-events: none;
}
/* At thumbnail scale the real editable canvas's thin dashed border is invisible, and any
   text/table content is too small to read anyway — so each element is shown as a solid
   primary-color block instead, just to indicate where content sits on the page at a glance. */
.page-thumb-canvas :deep(.canvas-element) {
  /* border-width is compensated for the thumbnail's scale-down transform (see the inline
     --thumb-border-width) so it reads as a crisp ~2px line rather than vanishing sub-pixel. */
  border: var(--thumb-border-width, 2px) solid var(--color-primary);
  background: rgba(62, 207, 142, 0.25);
}
.page-thumb-number {
  /* Stays the same muted style regardless of active state — the active page is already
     indicated by the thumbnail's own border color, so the badge doesn't need to double up. */
  position: absolute;
  left: var(--space-1);
  bottom: var(--space-1);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: 600;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}
.page-thumb-actions {
  /* Offset to the side (not overlaid on the thumbnail) — icons stacked vertically in their
     own column, revealed on hover/focus of the whole row rather than just the thumbnail. */
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 20px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.page-row:hover .page-thumb-actions,
.page-row:focus-within .page-thumb-actions {
  opacity: 1;
}
.page-thumb-handle,
.page-thumb-icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--color-border);
  color: var(--color-text);
  cursor: pointer;
}
.page-thumb-handle {
  cursor: grab;
}
.page-thumb-icon-button:hover {
  background: var(--color-border-strong);
}
.page-thumb-icon-button.danger:hover {
  background: var(--color-danger);
  color: #fff;
}
.page-add-button {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  background: transparent;
  border: 1.5px dashed var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  font-family: inherit;
  cursor: pointer;
}
.page-add-label {
  font-size: 10px;
}
.page-add-button:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.page-add-icon {
  font-size: 16px;
  line-height: 1;
}
.page-actions-spacer {
  width: 20px;
  flex-shrink: 0;
}
.workspace {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
  overflow-x: auto;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
}
.palette-group-label {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-faint);
}
.element-button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.element-button:hover {
  border-color: var(--color-primary);
  /* --color-primary-soft is a solid, fairly rich fill (meant for badges/cards) — much
     stronger than the barely-there hover cue this needs, so a low-opacity tint of the same
     primary color is used instead, adapting automatically to either theme's primary hue. */
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}
.element-button-icon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}
.element-button-plus {
  margin-left: auto;
  font-size: var(--text-md);
  color: var(--color-text-faint);
  transition: color 0.12s ease;
}
.element-button:hover .element-button-plus {
  color: var(--color-primary);
}
.preview {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  height: 80vh;
  padding: var(--space-3);
  box-sizing: border-box;
}
.hidden-file-input {
  display: none;
}
.image-thumb {
  max-width: 120px;
  max-height: 80px;
  object-fit: contain;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.canvas-wrapper {
  /* Structural sizing (padding: 24px matches the CANVAS_GUTTER constant used in
     canvasScale's math, height: 80vh matches .preview) — do not change these. Only
     cosmetic properties (border color, radius, shadow) are safe to restyle here. */
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: visible;
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  height: 80vh;
  box-sizing: border-box;
}
.canvas-scale-box {
  position: relative;
  flex-shrink: 0;
}
.canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  /* This is a WYSIWYG preview of the PDF page, not app UI — the compiled PDF has no theme
     and always renders plain black text on white (see template-compiler.ts), so both are
     hardcoded here rather than following --color-bg/--color-text. */
  background: #fff;
  color: #000;
  box-shadow: var(--shadow-md);
}
.guide-line {
  /* Fixed magenta rather than --color-primary — it needs to read as a distinct "alignment
     guide" affordance, not be mistaken for the teal selection outline, against the white
     WYSIWYG page in either theme. */
  position: absolute;
  background: #ff2fb0;
  pointer-events: none;
  z-index: 40;
}
.guide-vertical {
  top: 0;
  bottom: 0;
  width: 1px;
}
.guide-horizontal {
  left: 0;
  right: 0;
  height: 1px;
}
.preview-canvas-scroll {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.preview-canvas {
  display: block;
}
.small-button {
  padding: 4px var(--space-2);
  font-size: var(--text-xs);
}
.preview-message {
  padding: 0 var(--space-2);
}
</style>
