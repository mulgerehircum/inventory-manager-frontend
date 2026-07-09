<script setup lang="ts">
import AppSelect from '~/components/AppSelect.vue'
import type { PublicTemplateSummary } from '~/composables/useTemplatesApi'

const { theme, toggleTheme } = useTheme()
// Matches the theme-specific colors baked into each SVG (see public/pdfloom-logo*.svg) --
// they're not currentColor-driven, so the right file has to be picked per theme rather than
// relying on CSS to recolor a single asset.
const logoSrc = computed(() => (theme.value === 'light' ? '/pdfloom-logo-light.svg' : '/pdfloom-logo.svg'))

const { fetchFontOptions, fetchPublicTemplates, publicTemplatePreviewImageUrl } = useTemplatesApi()

// Names used by the scripted title-styling demo below — fixed regardless of what the backend
// returns, since that demo isn't user-controlled and all four are in play at some point.
const scriptedFontFamilies = ['Playfair Display', 'JetBrains Mono', 'Space Grotesk', 'Poppins']

// Backs the tooltip's real "Font" picker — same source of truth (GET /templates/fonts, see
// google-fonts.ts on the backend) as templates/[id].vue's fontOptions, so the mockup offers
// the same choices the real editor would. Falls back to the scripted set (non-fatal, same
// reasoning as templates/[id].vue's own fetch) so the picker still has something to show if
// the backend is unreachable.
const fontOptions = ref<string[]>(scriptedFontFamilies)
fetchFontOptions()
  .then((fonts) => (fontOptions.value = fonts))
  .catch(() => {})

// Stylesheets for both the fixed scripted set and whatever the backend actually returns —
// deduped, and reactive so a font picked from the fetched list (once it loads in) still
// renders correctly instead of falling back to the browser default.
const headFontFamilies = computed(() => [...new Set([...scriptedFontFamilies, ...fontOptions.value])])

useHead({
  title: 'PDFloom — PDF Template Designer for Inventory Reports',
  meta: [
    {
      name: 'description',
      content:
        'PDFloom is a drag-and-drop PDF template editor for inventory reports, invoices, and packing slips. Bind tables to live inventory data, pick your own fonts and colors, and preview the real PDF instantly — no signup required to try.'
    }
  ],
  link: () =>
    headFontFamilies.value.map((name) => ({
      key: `google-font-${name}`,
      rel: 'stylesheet',
      href: `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}&display=swap`
    }))
})

// Element refs (editor section, reveal targets) are set by Vue during the DOM patch, which
// happens before this component's own onMounted fires — so anything a ref callback depends on
// has to be ready eagerly, not deferred into onMounted, or the first (and only, thanks to the
// dataset guard below) call ends up reading it before it exists.
const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------- Header shadow-on-scroll ----------
const scrolled = ref(false)

// ---------- Mobile nav menu (< 900px) ----------
const mobileMenuOpen = ref(false)
const MOBILE_BREAKPOINT = 900
// Starts false (desktop-safe default) rather than reading window.innerWidth eagerly here —
// this runs during SSR too, where there's no window, and eagerly reading the real client
// viewport would desync from the SSR-rendered markup and trigger a hydration mismatch. Gets
// corrected to the real value once onMounted's onWindowResize() call fires, client-only.
const isMobileViewport = ref(false)
function onWindowResize() {
  isMobileViewport.value = window.innerWidth < MOBILE_BREAKPOINT
  // Auto-closes if the viewport crosses back to desktop width while open, rather than leaving
  // a stale open panel that only a phone-width layout was ever meant to show.
  if (!isMobileViewport.value && mobileMenuOpen.value) {
    mobileMenuOpen.value = false
  }
}
// True once the editor section's own top has reached the viewport top — i.e. we've scrolled
// past the hero into the pinned demo — so the large hero-sized logo can shrink back to a
// normal compact nav-bar mark rather than eating space in the sticky header for the rest of
// the scroll.
const inEditorSection = ref(false)

// ---------- Scroll-pinned editor centerpiece ----------
const editorSectionEl = ref<HTMLElement | null>(null)
const editorStep = ref(0)
const editorProgress = ref(0)

const navSteps = [
  { title: 'Header & fields', desc: 'Bind text elements to your organization name and report title.' },
  { title: 'Data-bound tables & badges', desc: 'Wire columns to live inventory fields, with status pills that update automatically.' },
  { title: 'Live summary stats, any font', desc: 'Rollups like total value calculate automatically. Style them in any Google Font.' },
  { title: 'Multi-page layouts', desc: 'Reports spanning multiple pages, each with its own background and layout.' }
]

let ticking = false
function onScroll() {
  scrolled.value = window.scrollY > 8

  const el = editorSectionEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  inEditorSection.value = rect.top <= 0
  const vh = window.innerHeight
  const total = rect.height - vh
  let progress = total > 0 ? -rect.top / total : 0
  progress = Math.max(0, Math.min(1, progress))

  const steps = 4
  let step = Math.floor(progress * steps)
  if (step >= steps) step = steps - 1
  if (step < 0) step = 0

  editorStep.value = step
  editorProgress.value = progress
}

function requestScrollUpdate() {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    ticking = false
    onScroll()
  })
}

function scrollToStep(idx: number) {
  const el = editorSectionEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const vh = window.innerHeight
  const total = rect.height - vh
  if (total <= 0) return
  const targetProgress = (idx + 0.5) / 4
  const targetScrollY = window.scrollY + rect.top + targetProgress * total
  window.scrollTo({ top: targetScrollY, behavior: prefersReduced ? 'auto' : 'smooth' })
}

// ---------- Mock document ----------
// A static, hand-styled illustration of the editor's output — not the real TemplateCanvasElement
// (that's the actual editor's job); this is marketing chrome demonstrating the same ideas
// (data-bound fields, per-element fonts, swappable page styles) without depending on the
// backend or the real canvas coordinate system.
interface SummaryFont {
  fontFamily: string
  color: string
  fontStyle?: string
  textDecoration?: string
}
const summaryFonts: SummaryFont[] = [
  { fontFamily: 'Georgia, serif', color: 'var(--color-text)' },
  { fontFamily: "'Courier New', monospace", color: 'var(--color-primary)' },
  { fontFamily: 'var(--font-sans)', color: 'var(--color-danger)', fontStyle: 'italic', textDecoration: 'underline' }
]
// Step 2 ("Live summary stats, any font") auto-cycles through the 3 font swatches as you
// scroll through its own quarter of the section — same "manual overrides scripted,
// permanently" pattern as step 3's page-style cycling and the other steps' tooltips.
const manualSelectedFont = ref<number | null>(null)
const step2Progress = computed(() => {
  if (editorStep.value > 2) return 1
  if (editorStep.value < 2) return 0
  return Math.max(0, Math.min(1, (editorProgress.value - 0.5) / 0.25))
})
const scriptedSelectedFont = computed(() => Math.min(2, Math.floor(step2Progress.value * 3)))
const selectedFont = computed(() => manualSelectedFont.value ?? scriptedSelectedFont.value)
function selectFont(idx: number) {
  manualSelectedFont.value = idx
}
// The font swatch's color/family override the active page-skin's own number color (matching
// the handoff's inline-style ordering, where the font-preview style is applied after the
// skin's) — background/padding/border-radius from the skin still apply underneath.
const summaryFontStyle = computed(() => {
  const f = summaryFonts[selectedFont.value]!
  return { fontFamily: f.fontFamily, color: f.color, fontStyle: f.fontStyle ?? 'normal', textDecoration: f.textDecoration ?? 'none' }
})

const summaryStats = [
  { label: 'Total value', value: '$749.37' },
  { label: 'Avg. price', value: '$14.99' },
  { label: 'Low stock', value: '1' }
]

interface PageSkin {
  name: string
  docTitle: string
  docBadge: string
  accent: string
  // Ring color for the active page-thumbnail's box-shadow — the accent's own -soft token
  // rather than an alpha-blended accent, so it stays valid CSS regardless of whether the
  // accent is a hex value or (as here) a var() reference.
  ringColor: string
  paper: string
  headerStyle: Record<string, string>
  titleStyle: Record<string, string>
  badgeStyle: Record<string, string>
  dateStyle: Record<string, string>
  tableHeaderStyle: Record<string, string>
  rowStyle: (rowIndex: number) => Record<string, string>
  numberStyle: Record<string, string>
}
const pageSkins: PageSkin[] = [
  {
    name: 'Business Invoice',
    docTitle: 'Business Invoice',
    docBadge: 'INV-1042',
    accent: 'var(--color-primary)',
    ringColor: 'var(--color-primary-soft)',
    paper: 'var(--color-bg)',
    headerStyle: { background: 'var(--color-primary-soft)', borderRadius: '10px' },
    titleStyle: { color: 'var(--color-text)' },
    badgeStyle: { border: '1px dashed var(--color-primary)', background: 'transparent', color: 'var(--color-primary)' },
    dateStyle: { color: 'var(--color-text-muted)' },
    tableHeaderStyle: {},
    rowStyle: (i) => (i === 0 ? { padding: '9px 0', borderBottom: '1px solid var(--color-border)' } : { padding: '9px 0' }),
    numberStyle: { color: 'var(--color-text)', background: 'none', padding: '0', borderRadius: '0' }
  },
  {
    name: 'Monthly Statement',
    docTitle: 'Monthly Statement',
    docBadge: 'STM-0417',
    accent: 'var(--color-warning)',
    ringColor: 'var(--color-warning-soft)',
    paper: 'var(--color-warning-soft)',
    headerStyle: {
      background: 'transparent',
      borderLeft: '4px solid var(--color-warning)',
      borderRadius: '2px',
      paddingLeft: 'var(--space-4)'
    },
    titleStyle: { color: 'var(--color-text)' },
    badgeStyle: { border: '1px solid var(--color-warning)', background: 'var(--color-warning-soft)', color: 'var(--color-warning)' },
    dateStyle: { color: 'var(--color-text-muted)' },
    tableHeaderStyle: {},
    rowStyle: (i) =>
      i === 1 ? { padding: '9px 10px', background: 'var(--color-warning-soft)', borderRadius: '6px' } : { padding: '9px 10px' },
    numberStyle: {
      color: 'var(--color-warning)',
      background: 'none',
      padding: '0 0 4px',
      borderBottom: '2px solid var(--color-warning)',
      borderRadius: '0',
      display: 'inline-block'
    }
  },
  {
    name: 'Packing Slip',
    docTitle: 'Packing Slip',
    docBadge: 'PKG-0289',
    accent: 'var(--color-success)',
    ringColor: 'var(--color-success-soft)',
    paper: 'var(--color-success-soft)',
    headerStyle: { background: 'var(--color-success)', borderRadius: '10px' },
    titleStyle: { color: '#ffffff' },
    badgeStyle: { background: 'var(--color-bg)', color: 'var(--color-success)', border: 'none' },
    dateStyle: { color: '#ffffff', opacity: '0.8' },
    tableHeaderStyle: { opacity: '0.7' },
    rowStyle: (i) => ({
      padding: '10px 12px',
      background: 'var(--color-success-soft)',
      border: '1px solid var(--color-border)',
      borderRadius: '10px',
      marginBottom: i === 0 ? '8px' : '0'
    }),
    numberStyle: { color: 'var(--color-success)', background: 'var(--color-success-soft)', padding: '5px 10px', borderRadius: '8px', display: 'inline-block' }
  }
]
// Step 3 ("Multi-page layouts") auto-cycles through the 3 page-style presets as you scroll
// through its own quarter of the section — demonstrating "3 pages, one template" by actually
// paging through them, rather than requiring a click to see anything beyond the default.
// Same "manual overrides scripted, permanently" pattern as the other steps' tooltips: clicking
// a thumbnail for real takes precedence from then on rather than snapping back on next scroll.
const manualActivePage = ref<number | null>(null)
const step3Progress = computed(() => {
  if (editorStep.value > 3) return 1
  if (editorStep.value < 3) return 0
  return Math.max(0, Math.min(1, (editorProgress.value - 0.75) / 0.25))
})
const scriptedActivePage = computed(() => Math.min(2, Math.floor(step3Progress.value * 3)))
const activePage = computed(() => manualActivePage.value ?? scriptedActivePage.value)
function selectActivePage(idx: number) {
  manualActivePage.value = idx
}
const currentSkin = computed(() => pageSkins[activePage.value]!)
function thumbRingStyle(idx: number) {
  if (activePage.value !== idx) return {}
  const skin = pageSkins[idx]!
  return { borderColor: skin.accent, boxShadow: `0 0 0 3px ${skin.ringColor}` }
}

// ---------- Step 0 storyboard: type the title, style it via a real tooltip ----------
// A scripted mini-sequence scrubbed by how far scroll has moved through just step 0's own
// quarter of the section (not wall-clock time), so it plays forward/backward with the user
// exactly like everything else here rather than autoplaying once and being done.
const step0Progress = computed(() => {
  if (editorStep.value > 0) return 1
  if (editorStep.value < 0) return 0
  return Math.max(0, Math.min(1, editorProgress.value / 0.25))
})
const titleTypedText = computed(() => {
  const full = currentSkin.value.docTitle
  const typingProgress = Math.max(0, Math.min(1, step0Progress.value / 0.4))
  const count = Math.round(typingProgress * full.length)
  return full.slice(0, count)
})
// Gated on editorStep === 0 specifically — step0Progress locks at 1 once you've scrolled past
// step 0, so a plain ">0.6" check would leave the tooltip stuck visible for the rest of the
// section. The title's applied color/font are meant to persist past step 0 (like a real edit
// would); the tooltip is transient UI chrome for demonstrating that edit.
const showTooltip = computed(() => editorStep.value === 0 && step0Progress.value > 0.6)

// Normalized progress across just the tooltip-visible window (0 the instant it appears, 1 by
// the end of step 0) — the scripted cursor/dropdown/color-and-font-change choreography below
// is all keyed off this single timeline instead of raw step0Progress, so the "cursor arrives,
// clicks, thing changes" beats stay in sync with each other by construction.
const cursorPhase = computed(() => Math.max(0, Math.min(1, (step0Progress.value - 0.6) / 0.4)))
const colorChanged = computed(() => cursorPhase.value > 0.33)
const fontChanged = computed(() => cursorPhase.value > 0.85)

const primaryHex = computed(() => (theme.value === 'light' ? '#0f7d70' : '#2bb4a8'))

// Same shape as templates/[id].vue's fontSelectOptions ([{value:'',label:'Default'}, ...fonts]).
const tooltipFontOptions = computed(() => [
  { value: '', label: 'Default' },
  ...fontOptions.value.map((name) => ({ value: name, label: name }))
])
// The scripted cursor's default target is the first real font in the list rather than a
// hardcoded name — the fetched backend list's order/length varies by environment, so
// hardcoding e.g. "Poppins" could put the click target far down a long dropdown, off past
// what the scrollable list even shows without scrolling it first.
const scriptedTargetFont = computed(() => tooltipFontOptions.value[1]?.value ?? '')

// The tooltip is a real, clickable control — once a visitor touches either field, their
// choice overrides the scripted scroll-driven value for good, rather than snapping back the
// next time editorProgress recomputes. The scripted cursor keeps running either way (see
// effectiveTargetFont below) rather than switching off — it just starts aiming at whatever
// the visitor actually picked instead of the scripted default.
const manualTooltipFont = ref<string | null>(null)
const manualTooltipColor = ref<string | null>(null)
const tooltipFontValue = computed(() => manualTooltipFont.value ?? (fontChanged.value ? scriptedTargetFont.value : ''))
const tooltipColorValue = computed(() => manualTooltipColor.value ?? (colorChanged.value ? primaryHex.value : undefined))
function onTooltipFontInput(value: string) {
  manualTooltipFont.value = value
}
function onTooltipColorInput(value: string | undefined) {
  manualTooltipColor.value = value ?? ''
}

// The title's rendered style layers the tooltip's font/color choice on top of the active page
// skin's own title color — a per-element override, same as a real editor would apply one.
const titleRenderStyle = computed(() => ({
  ...currentSkin.value.titleStyle,
  color: tooltipColorValue.value || currentSkin.value.titleStyle.color,
  fontFamily: tooltipFontValue.value || undefined
}))

// ---------- Scripted cursor: a fake "click" demoing the tooltip's own controls ----------
// Positions are plain pixels relative to .mock-header-zone (position:relative) — measured
// against the tooltip's actual rendered layout. Nothing here scales or moves with drag (unlike
// the old canvas-based mockup), so these can be fixed constants rather than computed.
const CURSOR_REST = { x: 83, y: 20 }
const CURSOR_TRIGGER = { x: 94, y: 173 }
// Targets the hex text field, not the swatch — the swatch is a native <input type=color>, and
// browsers only open that picker on a genuine, trusted user gesture (no API opens it from
// script), so it can't be part of a scroll-driven scripted demo. The text field is a normal
// text input a script can legitimately click/fill, so that's what the cursor "edits" instead.
const CURSOR_TEXT_FIELD = { x: 108, y: 222 }
// Whatever font is actually in play right now (a visitor's own pick once they've made one,
// otherwise the scripted default) — so the cursor always clicks the option that's genuinely
// selected instead of a stale hardcoded one once a real choice has been made.
const effectiveTargetFont = computed(() => manualTooltipFont.value ?? scriptedTargetFont.value)
// list-top and per-row height are measured against the dropdown's actual rendered layout — rows
// are uniform height (single-line labels, fixed font-size/padding), so a row's position is just
// its index times this constant rather than needing to measure every option every time.
const OPTION_LIST_TOP = 194
const OPTION_ROW_HEIGHT = 31.5
const cursorFontOptionPos = computed(() => {
  const idx = tooltipFontOptions.value.findIndex((o) => o.value === effectiveTargetFont.value)
  return { x: 94, y: OPTION_LIST_TOP + (Math.max(idx, 0) + 0.5) * OPTION_ROW_HEIGHT }
})
const cursorKeyframes = computed(() => [
  { at: 0.0, pos: CURSOR_REST },
  { at: 0.05, pos: CURSOR_REST },
  { at: 0.3, pos: CURSOR_TEXT_FIELD },
  { at: 0.36, pos: CURSOR_TEXT_FIELD },
  { at: 0.58, pos: CURSOR_TRIGGER },
  { at: 0.63, pos: CURSOR_TRIGGER },
  { at: 0.82, pos: cursorFontOptionPos.value },
  { at: 0.88, pos: cursorFontOptionPos.value },
  { at: 1.0, pos: CURSOR_REST }
])
function interpolateCursorPos(phase: number, keyframes: { at: number; pos: { x: number; y: number } }[]) {
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]!
    const b = keyframes[i + 1]!
    if (phase >= a.at && phase <= b.at) {
      const t = b.at === a.at ? 0 : (phase - a.at) / (b.at - a.at)
      // A quadratic bezier through an offset control point rather than straight-line lerp — a
      // real cursor arcs slightly between two points instead of tracking dead straight. The
      // control point is offset perpendicular to the A→B line, scaled to the hop's own length
      // (capped) so short hops curve subtly and long ones don't balloon into an exaggerated
      // swing.
      const dx = b.pos.x - a.pos.x
      const dy = b.pos.y - a.pos.y
      const dist = Math.hypot(dx, dy)
      const curve = Math.min(dist * 0.18, 40)
      const px = dist === 0 ? 0 : -dy / dist
      const py = dist === 0 ? 0 : dx / dist
      const cx = (a.pos.x + b.pos.x) / 2 + px * curve
      const cy = (a.pos.y + b.pos.y) / 2 + py * curve
      const u = 1 - t
      return {
        x: u * u * a.pos.x + 2 * u * t * cx + t * t * b.pos.x,
        y: u * u * a.pos.y + 2 * u * t * cy + t * t * b.pos.y
      }
    }
  }
  return keyframes[keyframes.length - 1]!.pos
}
// Click pulses: the hex text field (colorChanged flipping), then the Font trigger (opens the
// dropdown), then its target option (fontChanged flipping, closes it). Deliberately NOT "is
// cursorPhase currently inside this narrow band" — a real scroll gesture moves in large, uneven
// jumps (one wheel/trackpad tick can easily cover more scroll distance than a whole band is
// wide), so a band check reliably got skipped over both edges at once and the ripple just never
// fired. A `watch` on the underlying boolean fires on the transition itself regardless of how
// big the jump that caused it was, so it can't be skipped — and firing a fixed-duration,
// wall-clock pulse (rather than tying the ripple's visibility to scroll position too) means it
// always plays out fully once triggered. Factored out since the step-1 "add column" storyboard
// below needs its own independent cursor/pulse pair.
function useClickPulse() {
  const isClicking = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  function pulse() {
    if (timer) clearTimeout(timer)
    isClicking.value = false
    // Restart the CSS animation even if a previous pulse is still fading — needs a tick between
    // removing and re-adding the class, or the browser treats it as never having left.
    requestAnimationFrame(() => {
      isClicking.value = true
      timer = setTimeout(() => {
        isClicking.value = false
      }, 500)
    })
  }
  return { isClicking, pulse }
}
const { isClicking: cursorIsClicking, pulse: pulseCursorClick } = useClickPulse()
watch(colorChanged, () => pulseCursorClick())
watch(fontChanged, () => pulseCursorClick())

const cursorOpacity = computed(() => {
  if (!showTooltip.value) return 0
  if (cursorPhase.value < 0.04) return cursorPhase.value / 0.04
  if (cursorPhase.value > 0.94) return Math.max(0, (1 - cursorPhase.value) / 0.06)
  return 1
})
const cursorStyle = computed(() => {
  const pos = interpolateCursorPos(cursorPhase.value, cursorKeyframes.value)
  return { left: `${pos.x}px`, top: `${pos.y}px`, opacity: cursorOpacity.value }
})

// Drives the real AppSelect the same way an actual click would (see its exposed open/close),
// rather than faking a separate popup — open right after the trigger's click-pulse, close
// right after the option's. Same reasoning as above: a boolean-flip watch, not a band check.
const tooltipSelectRef = ref<InstanceType<typeof AppSelect> | null>(null)
const dropdownScriptedOpen = computed(() => cursorPhase.value > 0.58 && cursorPhase.value < 0.88)
// flush: 'post' — waits for the DOM update before running, so a scroll that jumps straight
// into this window (skipping the earlier ticks a gradual scroll would've passed through) still
// finds the ref populated rather than firing before Vue's mounted it.
watch(
  dropdownScriptedOpen,
  (isOpen) => {
    if (isOpen) {
      tooltipSelectRef.value?.open()
      pulseCursorClick()
    } else {
      tooltipSelectRef.value?.close()
    }
  },
  { flush: 'post' }
)

// ---------- Step 1 storyboard: add a table column via a real mini-tooltip ----------
// Mirrors the real editor's own "Columns" panel (see templates/[id].vue's addColumn/columns
// list — an Add Column button that appends a column, which you then retarget via its own Data
// key picker) rather than inventing a new pattern. Unlike the real editor (which has no
// pre-existing columns to clash with), this mock table already has a fixed Product/SKU/Qty —
// so the addable fields exclude sku entirely and default to the first one that doesn't
// duplicate an existing column, rather than reproducing the real editor's generic 'sku'
// default that would be nonsensical here (a second identical SKU column).
interface ColumnFieldOption {
  value: string
  label: string
  values: [string, string]
}
const columnFieldOptions: ColumnFieldOption[] = [
  { value: 'category', label: 'Category', values: ['Accessories', 'Accessories'] },
  { value: 'unitPrice', label: 'Unit price', values: ['$19.99', '$9.99'] },
  { value: 'value', label: 'Value', values: ['$59.97', '$419.58'] }
]

const step1Progress = computed(() => {
  if (editorStep.value > 1) return 1
  if (editorStep.value < 1) return 0
  return Math.max(0, Math.min(1, (editorProgress.value - 0.25) / 0.25))
})
// Reveal threshold is lower (and the phase window wider) than it first was — three clicks
// (add button, field trigger, field option) packed into too little scroll distance made the
// sequence feel like it was firing out of order, even though it never actually was; more
// scroll runway per beat gives a normal scroll speed time to actually register each one.
const showColumnTooltip = computed(() => editorStep.value === 1 && step1Progress.value > 0.35)
const columnCursorPhase = computed(() => Math.max(0, Math.min(1, (step1Progress.value - 0.35) / 0.65)))
// Simulated hover — the cursor is a decorative div (pointer-events: none), so the button's own
// CSS :hover never triggers during the scripted demo; this drives the same look via a class so
// the "about to click" moment reads the same way a real cursor hovering it would.
const addButtonHovered = computed(() => columnCursorPhase.value > 0.2 && columnCursorPhase.value < 0.3)

// Same "manual overrides scripted, scripted keeps animating toward whatever's actually
// selected" pattern as the step-0 tooltip above.
const manualColumnAdded = ref(false)
const manualColumnField = ref<string | null>(null)
const columnAdded = computed(() => manualColumnAdded.value || columnCursorPhase.value > 0.27)
const scriptedColumnField = computed(() => (columnCursorPhase.value > 0.82 ? 'unitPrice' : 'category'))
const selectedColumnField = computed(() => manualColumnField.value ?? scriptedColumnField.value)
const extraTableColumn = computed(() =>
  columnAdded.value ? columnFieldOptions.find((f) => f.value === selectedColumnField.value) ?? columnFieldOptions[0]! : null
)
function onAddColumnClick() {
  manualColumnAdded.value = true
}
function onColumnFieldInput(value: string) {
  manualColumnField.value = value
}

interface MockTableColumn {
  label: string
  width: string
  values: [string, string]
  muted?: boolean
}
const baseTableColumns: MockTableColumn[] = [
  { label: 'Product', width: '2.2fr', values: ['Wireless Mouse', 'USB-C Cable'] },
  { label: 'SKU', width: '1fr', values: ['WID-2', 'CAB-14'], muted: true },
  { label: 'Qty', width: '0.7fr', values: ['3', '42'] }
]
const tableColumns = computed<MockTableColumn[]>(() => {
  const extra = extraTableColumn.value
  if (!extra) return baseTableColumns
  return [...baseTableColumns, { label: extra.label, width: '1fr', values: extra.values, muted: true }]
})
// Status gets a bit more than a plain 1fr share — "Low stock" doesn't fit in an equal share
// once a 5th column exists (it was squeezing down to where the pill's own text wrapped).
const tableGridTemplate = computed(() => [...tableColumns.value.map((c) => c.width), '1.3fr'].join(' '))

// Waypoints relative to .mock-table-zone (position:relative), same reasoning as the step-0
// cursor above: nothing here scales or drags, so fixed constants suffice. REST sits near the
// tooltip's own header rather than off in the table's top-right corner — that first hop used
// to cover ~350px (vs. ~200px for the equivalent step-0 hop), so at the same scroll speed it
// visibly covered far more ground per pixel scrolled, reading as "too fast".
const COLUMN_CURSOR_REST = { x: 40, y: 142 }
const COLUMN_CURSOR_ADD_BUTTON = { x: 102, y: 212 }
const COLUMN_CURSOR_FIELD_TRIGGER = { x: 102, y: 254 }
const COLUMN_FIELD_OPTION_LIST_TOP = 275
const COLUMN_FIELD_OPTION_ROW_HEIGHT = 31.5
const effectiveColumnField = computed(() => manualColumnField.value ?? scriptedColumnField.value)
const columnFieldOptionPos = computed(() => {
  const idx = columnFieldOptions.findIndex((f) => f.value === effectiveColumnField.value)
  return { x: 102, y: COLUMN_FIELD_OPTION_LIST_TOP + (Math.max(idx, 0) + 0.5) * COLUMN_FIELD_OPTION_ROW_HEIGHT }
})
const columnCursorKeyframes = computed(() => [
  { at: 0.0, pos: COLUMN_CURSOR_REST },
  { at: 0.06, pos: COLUMN_CURSOR_REST },
  { at: 0.24, pos: COLUMN_CURSOR_ADD_BUTTON },
  { at: 0.3, pos: COLUMN_CURSOR_ADD_BUTTON },
  { at: 0.5, pos: COLUMN_CURSOR_FIELD_TRIGGER },
  { at: 0.56, pos: COLUMN_CURSOR_FIELD_TRIGGER },
  { at: 0.78, pos: columnFieldOptionPos.value },
  { at: 0.86, pos: columnFieldOptionPos.value },
  { at: 1.0, pos: COLUMN_CURSOR_REST }
])
const { isClicking: columnCursorIsClicking, pulse: pulseColumnCursorClick } = useClickPulse()
watch(columnAdded, () => pulseColumnCursorClick())
watch(scriptedColumnField, () => pulseColumnCursorClick())

const columnCursorOpacity = computed(() => {
  if (!showColumnTooltip.value) return 0
  if (columnCursorPhase.value < 0.04) return columnCursorPhase.value / 0.04
  if (columnCursorPhase.value > 0.94) return Math.max(0, (1 - columnCursorPhase.value) / 0.06)
  return 1
})
const columnCursorStyle = computed(() => {
  const pos = interpolateCursorPos(columnCursorPhase.value, columnCursorKeyframes.value)
  return { left: `${pos.x}px`, top: `${pos.y}px`, opacity: columnCursorOpacity.value }
})

const columnFieldSelectRef = ref<InstanceType<typeof AppSelect> | null>(null)
const columnDropdownScriptedOpen = computed(() => columnCursorPhase.value > 0.5 && columnCursorPhase.value < 0.86)
// flush: 'post' — this AppSelect only exists once columnAdded flips true (v-if), which can
// happen in the very same reactive tick as this scripted-open flag if a scroll jumps straight
// into both windows at once (skipping the earlier ticks a gradual scroll would pass through
// first) — waiting for the DOM update means the ref is always populated by the time this runs.
watch(
  columnDropdownScriptedOpen,
  (isOpen) => {
    if (isOpen) {
      columnFieldSelectRef.value?.open()
      pulseColumnCursorClick()
    } else {
      columnFieldSelectRef.value?.close()
    }
  },
  { flush: 'post' }
)

// ---------- Example templates ----------
// Real templates pulled from the public gallery (GET /templates/public) rather than
// hand-drawn placeholders — these three (by name) span a deliberately different look each,
// and their preview images come straight from the backend's own PDF render (GET
// /reports/public/:id/preview-image), not a hand-drawn "template preview" placeholder.
const EXAMPLE_TEMPLATE_NAMES = ['Neo-brutalist', 'Editorial Press', 'Swiss / International Typographic']
const publicTemplates = ref<PublicTemplateSummary[]>([])
fetchPublicTemplates()
  .then((templates) => (publicTemplates.value = templates))
  .catch(() => {})
const exampleTemplates = computed(() =>
  EXAMPLE_TEMPLATE_NAMES.map((name) => publicTemplates.value.find((t) => t.name === name)).filter(
    (t): t is PublicTemplateSummary => !!t
  )
)

// ---------- Scroll reveals ----------
const revealed = reactive({ tmpl0: false, tmpl1: false, tmpl2: false, cta: false })
const revealKeys = ['tmpl0', 'tmpl1', 'tmpl2', 'cta'] as const
let observer: IntersectionObserver | null = null
// Lazily constructed on first use rather than in onMounted — element refs are set by Vue's
// DOM patch, which runs before this component's own onMounted, so an observer that only
// existed from onMounted onward would miss every ref callback that fires ahead of it.
function getObserver(): IntersectionObserver {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const key = (entry.target as HTMLElement).dataset.revealKey as (typeof revealKeys)[number] | undefined
            if (key) revealed[key] = true
            observer?.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12 }
    )
  }
  return observer
}

function observeReveal(key: (typeof revealKeys)[number]) {
  return (el: Element | null) => {
    if (!el || !(el instanceof HTMLElement)) return
    if (prefersReduced) {
      revealed[key] = true
      return
    }
    if (el.dataset.observed) return
    el.dataset.observed = '1'
    el.dataset.revealKey = key
    getObserver().observe(el)
  }
}

onMounted(() => {
  window.addEventListener('scroll', requestScrollUpdate, { passive: true })
  window.addEventListener('resize', onWindowResize, { passive: true })
  onScroll()
  onWindowResize()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', requestScrollUpdate)
  window.removeEventListener('resize', onWindowResize)
  observer?.disconnect()
})
</script>

<template>
  <div class="landing">
    <header class="landing-header" :class="{ scrolled }">
      <div class="landing-header-row">
        <NuxtLink to="/" class="brand">
          <img :src="logoSrc" alt="PDFloom" class="brand-logo" :class="{ 'is-compact': inEditorSection }" />
        </NuxtLink>
        <div class="header-actions">
          <NuxtLink to="/login" class="signin-link">Sign in</NuxtLink>
          <button class="theme-toggle" type="button" @click="toggleTheme($event)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            {{ theme === 'dark' ? 'Light' : 'Dark' }}
          </button>
        </div>
        <button
          class="mobile-menu-toggle"
          type="button"
          :class="{ 'is-open': mobileMenuOpen }"
          :aria-expanded="mobileMenuOpen"
          aria-label="Toggle menu"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <span class="mobile-menu-bar" />
          <span class="mobile-menu-bar" />
          <span class="mobile-menu-bar" />
        </button>
      </div>
      <div class="mobile-menu-panel" :class="{ 'is-open': mobileMenuOpen }">
        <NuxtLink to="/login" class="signin-link" @click="mobileMenuOpen = false">Sign in</NuxtLink>
        <button class="theme-toggle" type="button" @click="toggleTheme($event); mobileMenuOpen = false">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
          {{ theme === 'dark' ? 'Light' : 'Dark' }}
        </button>
      </div>
    </header>

    <section class="hero">
      <!-- Real semantic heading for a11y/SEO — the animation below is purely decorative
           kinetic typography of this same text, so it's marked aria-hidden. -->
      <h1 class="sr-only">Design your own PDF reports — visually.</h1>
      <div class="hero-canvas-panel">
        <div class="hero-canvas-grid" />
        <div class="hero-anim-container" aria-hidden="true">
          <ClientOnly>
            <HeroTextAnimation />
          </ClientOnly>
        </div>
      </div>
      <div class="hero-content">
        <p class="hero-subhead">
          Drag fields, tables, and images onto a page. Bind them to your live inventory data — no Handlebars, no PDF
          library, no template stuck in someone else's codebase.
        </p>
        <div class="hero-ctas">
          <NuxtLink to="/templates/new" class="btn btn-primary btn-lg">Start designing</NuxtLink>
          <a href="#examples" class="btn btn-secondary btn-lg">View example templates</a>
        </div>
        <p class="hero-microcopy">Free to design. Sign in only to save.</p>
      </div>
      <div class="scroll-cue">
        <span>Scroll to see it in action</span>
        <span class="scroll-cue-arrow">&darr;</span>
      </div>
    </section>

    <section ref="editorSectionEl" class="editor-section">
      <div class="editor-sticky">
        <div class="editor-nav">
          <div class="editor-nav-eyebrow">The editor</div>
          <div class="editor-nav-list">
            <div
              class="editor-nav-progress"
              :style="isMobileViewport ? { width: editorProgress * 100 + '%' } : { height: editorProgress * 100 + '%' }"
            />

            <button
              v-for="(step, idx) in navSteps"
              :key="step.title"
              class="editor-nav-item"
              :class="{ 'is-active': editorStep === idx }"
              type="button"
              @click="scrollToStep(idx)"
            >
              <div class="editor-nav-title">{{ step.title }}</div>
              <div class="editor-nav-desc">{{ step.desc }}</div>
            </button>
          </div>
        </div>

        <div class="editor-mockup">
          <div class="editor-toolbar">
            <div class="editor-tool" :class="{ 'is-active': editorStep === 0 }">T</div>
            <div class="editor-tool" :class="{ 'is-active': editorStep === 1 }">&#9638;</div>
            <div class="editor-tool" :class="{ 'is-active': editorStep === 2 }">Aa</div>
            <div class="editor-tool" :class="{ 'is-active': editorStep === 3 }">&#9636;</div>
          </div>

          <div class="editor-canvas-area">
            <div class="mock-page" :style="{ background: currentSkin.paper }">
              <!-- Header zone -->
              <div class="mock-zone mock-header-zone" :class="{ 'is-active': editorStep === 0 }" :style="currentSkin.headerStyle">
                <div class="mock-header-row">
                  <div class="mock-title" :style="titleRenderStyle">{{ titleTypedText }}</div>
                  <div class="mock-badge" :style="currentSkin.badgeStyle">{{ currentSkin.docBadge }}</div>
                </div>
                <div class="mock-date" :style="currentSkin.dateStyle">Jul 8, 2026, 9:00 AM</div>

                <!-- Step-0 storyboard: a real, clickable tooltip demonstrating per-element
                     font/color styling on the title, plus a scripted cursor showing where
                     it's about to click before it actually does. -->
                <div class="mini-tooltip" :class="{ 'is-visible': showTooltip }">
                  <div class="mini-tooltip-header">
                    <span class="mini-tooltip-badge">text</span>
                  </div>
                  <div class="mini-tooltip-row">
                    <span class="mini-tooltip-row-label">Font</span>
                    <AppSelect
                      ref="tooltipSelectRef"
                      class="mini-tooltip-select"
                      :model-value="tooltipFontValue"
                      :options="tooltipFontOptions"
                      @update:model-value="onTooltipFontInput"
                    />
                  </div>
                  <div class="mini-tooltip-row">
                    <span class="mini-tooltip-row-label">Text</span>
                    <AppColorInput :model-value="tooltipColorValue" placeholder="default" @update:model-value="onTooltipColorInput" />
                  </div>
                </div>
                <div class="mini-cursor" :class="{ 'is-clicking': cursorIsClicking }" :style="cursorStyle" />
              </div>

              <!-- Table zone -->
              <div class="mock-zone mock-table-zone" :class="{ 'is-active': editorStep === 1 }">
                <div class="mock-table-header" :style="[currentSkin.tableHeaderStyle, { gridTemplateColumns: tableGridTemplate }]">
                  <span v-for="col in tableColumns" :key="col.label">{{ col.label }}</span>
                  <span>Status</span>
                </div>
                <div class="mock-table-row" :style="[currentSkin.rowStyle(0), { gridTemplateColumns: tableGridTemplate }]">
                  <span v-for="col in tableColumns" :key="col.label" :class="{ 'mock-muted': col.muted }">{{ col.values[0] }}</span>
                  <span class="mock-status-pill mock-status-danger">Low stock</span>
                </div>
                <div class="mock-table-row" :style="[currentSkin.rowStyle(1), { gridTemplateColumns: tableGridTemplate }]">
                  <span v-for="col in tableColumns" :key="col.label" :class="{ 'mock-muted': col.muted }">{{ col.values[1] }}</span>
                  <span class="mock-status-pill mock-status-success">In stock</span>
                </div>

                <!-- Step-1 storyboard: a real, clickable "Columns" tooltip mirroring the real
                     editor's own Add Column panel, plus a scripted cursor demoing it. -->
                <div class="mini-tooltip mini-columns-tooltip" :class="{ 'is-visible': showColumnTooltip }">
                  <div class="mini-tooltip-header">
                    <span class="mini-tooltip-badge">table</span>
                  </div>
                  <div class="mini-columns-list">
                    <span v-for="col in tableColumns" :key="col.label" class="mini-column-chip">{{ col.label }}</span>
                  </div>
                  <div v-if="columnAdded" class="mini-tooltip-row">
                    <span class="mini-tooltip-row-label">Data key</span>
                    <AppSelect
                      ref="columnFieldSelectRef"
                      class="mini-tooltip-select"
                      :model-value="selectedColumnField"
                      :options="columnFieldOptions.map((f) => ({ value: f.value, label: f.label }))"
                      @update:model-value="onColumnFieldInput"
                    />
                  </div>
                  <button
                    type="button"
                    class="mini-add-column-button"
                    :class="{ 'is-hovered': addButtonHovered }"
                    @click="onAddColumnClick"
                  >
                    + Add column
                  </button>
                </div>
                <div class="mini-cursor" :class="{ 'is-clicking': columnCursorIsClicking }" :style="columnCursorStyle" />
              </div>

              <!-- Summary zone -->
              <div class="mock-zone" :class="{ 'is-active': editorStep === 2 }">
                <div class="mock-summary-header">
                  <div class="mock-summary-label">Inventory summary</div>
                  <div class="font-swatches">
                    <button
                      v-for="(f, i) in summaryFonts"
                      :key="i"
                      type="button"
                      class="font-swatch"
                      :class="{ 'is-selected': selectedFont === i }"
                      :style="{ fontFamily: f.fontFamily, color: f.color, fontStyle: f.fontStyle ?? 'normal', textDecoration: f.textDecoration ?? 'none' }"
                      @click="selectFont(i)"
                    >
                      Aa
                    </button>
                  </div>
                </div>
                <div class="mock-summary-grid">
                  <div v-for="stat in summaryStats" :key="stat.label">
                    <div class="mock-stat-label">{{ stat.label }}</div>
                    <div class="mock-stat-value" :style="[currentSkin.numberStyle, summaryFontStyle]">{{ stat.value }}</div>
                  </div>
                </div>
              </div>

              <!-- Pages zone -->
              <div class="mock-zone mock-pages-zone" :class="{ 'is-active': editorStep === 3 }">
                <div class="page-thumbs">
                  <button
                    type="button"
                    class="page-thumb page-thumb-invoice"
                    :class="{ 'is-active': activePage === 0 }"
                    :style="thumbRingStyle(0)"
                    title="Business Invoice"
                    @click="selectActivePage(0)"
                  >
                    <div class="thumb-bar" /><div class="thumb-bar" /><div class="thumb-bar" /><div class="thumb-bar" />
                  </button>
                  <button
                    type="button"
                    class="page-thumb page-thumb-statement"
                    :class="{ 'is-active': activePage === 1 }"
                    :style="thumbRingStyle(1)"
                    title="Monthly Statement"
                    @click="selectActivePage(1)"
                  >
                    <div class="thumb-bar" /><div class="thumb-bar" /><div class="thumb-bar" /><div class="thumb-bar" />
                  </button>
                  <button
                    type="button"
                    class="page-thumb page-thumb-slip"
                    :class="{ 'is-active': activePage === 2 }"
                    :style="thumbRingStyle(2)"
                    title="Packing Slip"
                    @click="selectActivePage(2)"
                  >
                    <div class="thumb-bar" /><div class="thumb-bar" /><div class="thumb-bar" /><div class="thumb-bar" />
                  </button>
                </div>
                <div class="pages-caption">Multiple styles, same data — styled as <span class="pages-caption-name">{{ currentSkin.name }}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="examples" class="examples">
      <h2>Start from an example</h2>
      <div class="examples-grid">
        <div
          v-for="(tmpl, idx) in exampleTemplates"
          :key="tmpl._id"
          :ref="observeReveal(revealKeys[idx]!)"
          class="example-card card"
          :class="{ 'is-revealed': revealed[revealKeys[idx]!] }"
          :style="{ transitionDelay: idx * 0.08 + 's' }"
        >
          <div class="example-preview" :style="{ aspectRatio: `${tmpl.pageWidth} / ${tmpl.pageHeight}` }">
            <img :src="publicTemplatePreviewImageUrl(tmpl._id, 480)" :alt="`${tmpl.name} template preview`" loading="lazy" />
          </div>
          <div class="example-body">
            <h3>{{ tmpl.name }}</h3>
            <p>{{ tmpl.elementCount }} elements</p>
            <span class="badge" :class="tmpl.tier === 'premium' ? 'badge-warning' : 'badge-primary'">
              {{ tmpl.tier === 'premium' ? 'Premium' : 'Free' }}
            </span>
            <NuxtLink :to="`/templates/new?from=${tmpl._id}`" class="example-cta">Use this template</NuxtLink>
          </div>
        </div>
      </div>
    </section>

    <section class="final-cta">
      <div :ref="observeReveal('cta')" class="final-cta-inner" :class="{ 'is-revealed': revealed.cta }">
        <h2>Stop hand-coding report layouts.</h2>
        <p class="final-cta-eyebrow">PDFloom</p>
        <p class="body">Design your first PDF template in the browser — free, and no account needed to start.</p>
        <NuxtLink to="/templates/new" class="btn btn-primary btn-lg">Start designing</NuxtLink>
      </div>
    </section>

    <footer class="landing-footer">
      <span>&copy; 2026 PDFloom</span>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  min-height: 100vh;
}

/* ---------- Header ---------- */
.landing-header {
  max-width: 1360px;
  margin: 0 auto;
  padding: var(--space-4) var(--space-5);
  position: sticky;
  top: 0;
  z-index: 50;
  background: transparent;
  transition: background-color 0.3s ease, box-shadow 0.3s ease, backdrop-filter 0.3s ease;
}
.landing-header.scrolled {
  background: var(--color-bg);
  box-shadow: 0 1px 0 var(--color-border), 0 10px 30px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.landing-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
/* Hidden on desktop — the inline .header-actions group is what shows instead (see the
   max-width:900px media query at the bottom of this file). */
.mobile-menu-toggle {
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 40px;
  height: 40px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.mobile-menu-bar {
  width: 18px;
  height: 2px;
  background: var(--color-text);
  border-radius: 1px;
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.mobile-menu-toggle.is-open .mobile-menu-bar:nth-child(1) {
  transform: translateY(6px) rotate(45deg);
}
.mobile-menu-toggle.is-open .mobile-menu-bar:nth-child(2) {
  opacity: 0;
}
.mobile-menu-toggle.is-open .mobile-menu-bar:nth-child(3) {
  transform: translateY(-6px) rotate(-45deg);
}
.mobile-menu-panel {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  transition: max-height 0.25s ease, opacity 0.25s ease;
}
.mobile-menu-panel.is-open {
  max-height: 160px;
  opacity: 1;
  margin-top: var(--space-4);
}
.brand {
  display: flex;
  align-items: center;
}
.brand-logo {
  display: block;
  height: 96px;
  width: auto;
  transition: height 0.25s ease;
}
.brand-logo.is-compact {
  height: 32px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.signin-link {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  text-decoration: none;
  transition: color 0.15s ease;
}
.signin-link:hover {
  color: var(--color-text);
}
.theme-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  transition: border-color 0.15s ease, transform 0.1s ease;
}
.theme-toggle:hover {
  border-color: var(--color-primary);
}
.theme-toggle:active {
  transform: scale(0.94);
}

/* ---------- Hero ---------- */
.hero {
  max-width: 1360px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-5) var(--space-7);
  text-align: center;
  position: relative;
  /* min-height + flex column, with .scroll-cue's margin-top:auto below, lands the cue at the
     bottom of the viewport on first load while staying in normal flow (no absolute/fixed) —
     it still scrolls away with the rest of the page like any other in-flow element. 128px
     accounts for the sticky header above (96px logo + space-4 padding top/bottom), which
     still occupies its own space in normal flow despite being sticky. */
  min-height: calc(100vh - 128px);
  display: flex;
  flex-direction: column;
}
@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.hero-canvas-panel {
  position: relative;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
  padding: var(--space-7) var(--space-5) var(--space-6);
  overflow: hidden;
}
/* Faint page/graph-paper grid backdrop — decorative, a visual nod to the page-design canvas
   that's the product's own core metaphor. */
.hero-canvas-grid {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(0deg, transparent, transparent 33px, var(--color-border) 33px, var(--color-border) 34px),
    repeating-linear-gradient(90deg, transparent, transparent 33px, var(--color-border) 33px, var(--color-border) 34px);
  background-size: 34px 34px;
  opacity: 0.5;
  pointer-events: none;
}
.hero-anim-container {
  position: relative;
  max-width: 900px;
  margin: 0 auto;
}
.hero-content {
  position: relative;
  z-index: 1;
  margin-top: var(--space-6);
}
.hero-subhead {
  margin: 0 auto var(--space-6);
  max-width: 560px;
  font-size: var(--text-lg);
  line-height: 1.55;
  color: var(--color-text-muted);
}
.hero-ctas {
  display: flex;
  gap: var(--space-3);
  justify-content: center;
  flex-wrap: wrap;
}
.btn-lg {
  padding: var(--space-3) var(--space-5);
  font-size: var(--text-md);
}
.hero-microcopy {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.scroll-cue {
  /* Pushes itself to the bottom of .hero's flex column — see the min-height:100vh comment
     on .hero above. */
  margin-top: auto;
  padding-top: var(--space-6);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.scroll-cue-arrow {
  animation: livePulse 1.8s ease-in-out infinite;
}

/* ---------- Scroll-pinned editor centerpiece ---------- */
.editor-section {
  position: relative;
  height: calc(100vh * 4);
}
.editor-sticky {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  align-items: center;
  gap: var(--space-7);
  max-width: 1360px;
  margin: 0 auto;
  padding: 0 var(--space-5);
  box-sizing: border-box;
}
.editor-nav {
  flex: 0 0 280px;
}
.editor-nav-eyebrow {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-primary);
  margin-bottom: var(--space-5);
}
.editor-nav-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding-left: var(--space-4);
  border-left: 2px solid var(--color-border);
}
.editor-nav-progress {
  position: absolute;
  left: -2px;
  top: 0;
  width: 2px;
  background: var(--color-primary);
  height: 0%;
  transition: height 0.08s linear;
}
.editor-nav-item {
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  display: block;
  font-family: inherit;
}
.editor-nav-title {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--color-text);
  transition: color 0.3s ease;
}
.editor-nav-item.is-active .editor-nav-title {
  color: var(--color-primary);
}
.editor-nav-desc {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-top: 4px;
  line-height: 1.5;
}
.editor-mockup {
  flex: 1.25;
  display: flex;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  height: min(760px, 86vh);
}
.editor-toolbar {
  width: 58px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-bg);
}
.editor-tool {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  background: transparent;
  transition: background-color 0.3s ease, color 0.3s ease;
}
.editor-tool:nth-child(1),
.editor-tool:nth-child(3) {
  font-size: var(--text-md);
  font-weight: 700;
}
.editor-tool:nth-child(2),
.editor-tool:nth-child(4) {
  font-size: var(--text-lg);
}
.editor-tool.is-active {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}
.editor-canvas-area {
  flex: 1;
  /* Without this, a flex item's default min-width:auto floors it at its content's intrinsic
     width — the mock page's grid/flex children refuse to shrink below their natural size,
     so on narrow viewports this area (and everything in it) overflows instead of scaling down. */
  min-width: 0;
  padding: var(--space-7);
  display: flex;
  align-items: center;
  justify-content: center;
  background-image: repeating-linear-gradient(0deg, transparent, transparent 27px, var(--color-border) 27px, var(--color-border) 28px),
    repeating-linear-gradient(90deg, transparent, transparent 27px, var(--color-border) 27px, var(--color-border) 28px);
  background-size: 28px 28px;
}

/* ---------- Mock document ---------- */
.mock-page {
  width: 100%;
  max-width: 520px;
  aspect-ratio: 8.5 / 11;
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
  box-shadow: var(--shadow-md);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  box-sizing: border-box;
  transition: background-color 0.3s ease;
}
.mock-zone {
  border-radius: 10px;
  padding: var(--space-3);
  border: 1.5px dashed transparent;
  opacity: 0.45;
  transition: opacity 0.4s ease, box-shadow 0.4s ease, border-color 0.4s ease, background-color 0.3s ease;
}
.mock-zone.is-active {
  opacity: 1;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-soft);
}
.mock-header-zone {
  position: relative;
  padding: var(--space-4);
}
.mock-table-zone {
  position: relative;
}
.mock-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}
.mock-title {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.01em;
  transition: color 0.3s ease;
}
.mock-badge {
  flex-shrink: 0;
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 700;
  transition: all 0.3s ease;
}
.mock-date {
  margin-top: 8px;
  font-size: 13px;
  transition: color 0.3s ease;
}
.mock-table-header {
  display: grid;
  grid-template-columns: 2.2fr 1fr 0.7fr 1fr;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-faint);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}
.mock-table-row {
  display: grid;
  grid-template-columns: 2.2fr 1fr 0.7fr 1fr;
  gap: 6px;
  align-items: center;
  font-size: 14px;
  color: var(--color-text);
  transition: background-color 0.3s ease, border-radius 0.3s ease;
}
.mock-muted {
  color: var(--color-text-muted);
}
.mock-status-pill {
  justify-self: start;
  border-radius: 8px;
  padding: 2px 9px;
  font-weight: 700;
  font-size: 12px;
  white-space: nowrap;
}
.mock-status-danger {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
.mock-status-success {
  background: var(--color-success-soft);
  color: var(--color-success);
}
.mock-summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.mock-summary-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
}
.font-swatches {
  display: flex;
  gap: 8px;
}
.font-swatch {
  cursor: pointer;
  font-size: 15px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 6px;
  background: none;
  border: none;
  transition: box-shadow 0.2s ease;
}
.font-swatch.is-selected {
  box-shadow: 0 0 0 2px var(--color-primary);
}
.mock-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
}
.mock-stat-label {
  font-size: 11px;
  color: var(--color-text-faint);
  margin-bottom: 4px;
}
.mock-stat-value {
  font-size: 26px;
  font-weight: 700;
  transition: all 0.3s ease;
}
.mock-pages-zone {
  margin-top: auto;
}
.page-thumbs {
  display: flex;
  gap: 10px;
}
.page-thumb {
  cursor: pointer;
  width: 46px;
  height: 60px;
  border-radius: 4px;
  padding: 5px 4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-strong);
  transition: border-color 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
}
.page-thumb:hover {
  transform: translateY(-2px);
}
.thumb-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--color-border-strong);
}
.thumb-bar:first-child {
  height: 10px;
}
.page-thumb-invoice .thumb-bar:first-child {
  background: var(--color-primary-soft);
  border: 1px dashed var(--color-primary);
}
.page-thumb-invoice .thumb-bar:nth-child(3) {
  width: 70%;
}
.page-thumb-invoice .thumb-bar:nth-child(4) {
  width: 85%;
}
.page-thumb-statement .thumb-bar:first-child {
  background: transparent;
  border-left: 2px solid var(--color-warning);
  padding-left: 2px;
}
.page-thumb-statement .thumb-bar:nth-child(3) {
  background: var(--color-warning-soft);
  border: 1px solid var(--color-warning);
  width: 85%;
}
.page-thumb-statement .thumb-bar:nth-child(4) {
  width: 70%;
}
.page-thumb-slip .thumb-bar:first-child {
  background: var(--color-success);
}
.page-thumb-slip .thumb-bar:nth-child(2) {
  background: var(--color-success-soft);
  border: 1px solid var(--color-success);
}
.page-thumb-slip .thumb-bar:nth-child(3) {
  background: var(--color-success-soft);
  border: 1px solid var(--color-success);
  width: 80%;
}
.page-thumb-slip .thumb-bar:nth-child(4) {
  width: 60%;
}
.pages-caption {
  font-size: 12px;
  color: var(--color-text-faint);
  margin-top: 8px;
}
.pages-caption-name {
  color: var(--color-text-muted);
  font-weight: 600;
}

/* ---------- Step-0 tooltip + scripted cursor ---------- */
.mini-tooltip {
  position: absolute;
  left: 17px;
  top: 103px;
  width: 152px;
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  opacity: 0;
  transform: translateY(6px) scale(0.95);
  transition: opacity 0.35s ease, transform 0.35s ease;
  z-index: 5;
}
.mini-tooltip.is-visible {
  opacity: 1;
  transform: none;
}
/* Invisible (opacity: 0, mid-transition) states still shouldn't intercept clicks meant for
   the mockup underneath — only the fully visible tooltip becomes a real control surface. */
.mini-tooltip:not(.is-visible) {
  pointer-events: none;
}
.mini-tooltip-header {
  margin-bottom: var(--space-2);
}
.mini-tooltip-badge {
  display: inline-flex;
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}
.mini-tooltip-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
  margin-bottom: var(--space-2);
}
.mini-tooltip-row:last-child {
  margin-bottom: 0;
}
.mini-tooltip-row-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
}
.mini-tooltip-select {
  width: 100%;
  font-size: 11px;
  min-width: 0;
}
.mini-tooltip-select :deep(.app-select-trigger) {
  padding: 3px var(--space-2);
}
.mini-tooltip-row :deep(.app-color-text) {
  min-width: 0;
  font-size: 11px;
  padding: 3px var(--space-2);
}
.mini-tooltip-row :deep(.app-color-swatch) {
  width: 24px;
  height: 24px;
}
.mini-columns-tooltip {
  left: 17px;
  top: 130px;
  width: 168px;
}
.mini-columns-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: var(--space-2);
}
.mini-column-chip {
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  border: 1px solid var(--color-border-strong);
  font-size: 10px;
  color: var(--color-text-muted);
}
.mini-add-column-button {
  width: 100%;
  padding: 5px var(--space-2);
  border-radius: var(--radius-sm);
  border: 1px dashed var(--color-border-strong);
  background: transparent;
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.mini-add-column-button:hover,
.mini-add-column-button.is-hovered {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.mini-cursor {
  position: absolute;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  margin-top: -7px;
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-surface), var(--shadow-sm);
  /* No left/top transition — this tracks cursorPhase, which is itself scroll-scrubbed (not
     wall-clock), same as everything else in the storyboard. A slow CSS transition here would
     make the cursor perpetually chase a target that keeps moving on every scroll tick, so it
     would never actually visually land on the dropdown/option before scrolling past them. */
  transition: opacity 0.3s ease;
  pointer-events: none;
  z-index: 6;
}
.mini-cursor.is-clicking {
  animation: mini-cursor-click 0.4s ease;
}
.mini-cursor.is-clicking::before,
.mini-cursor.is-clicking::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid var(--color-primary);
}
.mini-cursor.is-clicking::before {
  background: var(--color-primary);
  animation: mini-cursor-ripple-fill 0.5s ease-out;
}
.mini-cursor.is-clicking::after {
  animation: mini-cursor-ripple-ring 0.55s ease-out;
}
@keyframes mini-cursor-click {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(0.7);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes mini-cursor-ripple-fill {
  0% {
    opacity: 0.45;
    transform: scale(0.3);
  }
  100% {
    opacity: 0;
    transform: scale(1.4);
  }
}
@keyframes mini-cursor-ripple-ring {
  0% {
    opacity: 0.8;
    transform: scale(0.5);
  }
  70% {
    opacity: 0.5;
  }
  100% {
    opacity: 0;
    transform: scale(2.4);
  }
}

/* ---------- Example templates ---------- */
.examples {
  max-width: 1360px;
  margin: 0 auto;
  padding: 0 var(--space-5) var(--space-7);
}
.examples h2 {
  margin: 0 0 var(--space-5);
  font-size: calc(var(--text-2xl) * 1.15);
  text-align: center;
}
.examples-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-4);
}
.example-card {
  overflow: hidden;
  opacity: 0;
  transform: translateY(28px);
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease, opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.example-card.is-revealed {
  opacity: 1;
  transform: none;
}
.example-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
  border-color: var(--color-primary);
}
.example-preview {
  /* Overridden inline per-card to the template's own real pageWidth/pageHeight ratio — this
     4:3 is just a fallback for the instant before that data loads in. */
  aspect-ratio: 4 / 3;
  background: var(--color-bg);
  overflow: hidden;
}
.example-preview img {
  display: block;
  width: 100%;
  height: 100%;
  /* contain, not cover — the container's aspect-ratio matches the real page exactly once
     tmpl.pageWidth/pageHeight loads in, so this only matters for that brief fallback moment,
     and "cover" would crop a full A4 page down to a top sliver rather than showing it whole. */
  object-fit: contain;
}
.example-body {
  padding: var(--space-4);
}
.example-body h3 {
  margin: 0 0 6px;
}
.example-body p {
  margin: 0 0 var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.example-cta {
  display: block;
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-primary);
  text-decoration: none;
}
.example-cta:hover {
  text-decoration: underline;
}

/* ---------- Final CTA ---------- */
.final-cta {
  background: var(--color-primary-soft);
  padding: var(--space-7) var(--space-5);
  text-align: center;
}
.final-cta-inner {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}
.final-cta-inner.is-revealed {
  opacity: 1;
  transform: none;
}
.final-cta h2 {
  margin: 0 0 var(--space-3);
  font-size: calc(var(--text-2xl) * 1.3);
}
.final-cta-eyebrow {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-primary);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.final-cta p.body {
  margin: 0 auto var(--space-5);
  max-width: 480px;
  font-size: var(--text-md);
  color: var(--color-text-muted);
}

/* ---------- Footer ---------- */
.landing-footer {
  max-width: 1360px;
  margin: 0 auto;
  padding: var(--space-5);
  color: var(--color-text-faint);
  font-size: var(--text-xs);
}

@media (max-width: 900px) {
  /* ---------- Nav: hamburger replaces the inline sign-in/theme-toggle group ---------- */
  .header-actions {
    display: none;
  }
  .mobile-menu-toggle {
    display: flex;
  }

  /* Hero needs no mobile-specific stacking rule here — .hero is already a centered flex
     column at every viewport width (it has no row-layout content to un-row on mobile, since
     the handoff's mark-icon-beside-headline treatment is out of scope for this pass). */

  /* ---------- Scroll-pinned editor demo ---------- */
  .editor-sticky {
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: var(--space-5);
  }
  .editor-nav {
    flex: none;
  }
  .editor-nav-list {
    flex-direction: column;
    border-left: none;
    padding-left: 0;
  }
  /* Horizontal bar above the (single, current) step instead of a vertical track beside all
     of them — the template already switches its bound style from height% to width% at this
     same breakpoint (see isMobileViewport), this just repositions/resizes the element itself. */
  .editor-nav-progress {
    position: static;
    width: 0%;
    height: 3px;
    margin-bottom: var(--space-3);
    transition: width 0.08s linear;
  }
  /* Only the current step shows on mobile — swapped instantly as scroll crosses each
     threshold (a plain class toggle, not an animated transition), matching how the desktop
     nav's own active/inactive state changes are likewise instant, not eased. */
  .editor-nav-item {
    display: none;
  }
  .editor-nav-item.is-active {
    display: block;
  }
  .editor-mockup {
    height: min(360px, 46vh);
  }
}

/* Narrow phones: the mock page's grid/flex content (26px stat numbers, a 4-column table) has
   an intrinsic min-width wider than what's left after the toolbar + nav at this width, so it
   needs to shrink its own type scale rather than relying on the flex/grid reflow above alone. */
@media (max-width: 480px) {
  .editor-toolbar {
    width: 44px;
  }
  .editor-tool {
    width: 28px;
    height: 28px;
  }
  .editor-canvas-area {
    padding: var(--space-4);
    /* The mock page's content (4 zones' worth of padding/gaps/text) doesn't reliably fit the
       8.5:11 aspect-ratio's implied height once everything else here has already been shrunk
       as far as it reasonably can be — letting this area scroll internally means nothing is
       ever clipped/inaccessible, instead of silently cutting content off at the mockup's own
       overflow:hidden boundary. align-items switches to flex-start too: centering an
       overflowing flex child pushes its top half above scrollTop:0 (unreachable, since scroll
       can't go negative) — starting it flush at the top keeps the whole thing reachable by
       scrolling down instead. */
    overflow-y: auto;
    align-items: flex-start;
  }
  .mock-page {
    aspect-ratio: auto;
    padding: var(--space-4);
    gap: var(--space-3);
  }
  .mock-title {
    font-size: 17px;
  }
  .mock-table-header,
  .mock-table-row {
    font-size: 11px;
  }
  .mock-stat-value {
    font-size: 18px;
  }
  .mock-summary-grid {
    gap: var(--space-2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .scroll-cue-arrow {
    animation: none !important;
  }
}
</style>
