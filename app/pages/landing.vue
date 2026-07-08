<script setup lang="ts">
const { theme, toggleTheme } = useTheme()
// Matches the theme-specific colors baked into each SVG (see public/pdfloom-logo*.svg) --
// they're not currentColor-driven, so the right file has to be picked per theme rather than
// relying on CSS to recolor a single asset.
const logoSrc = computed(() => (theme.value === 'light' ? '/pdfloom-logo-light.svg' : '/pdfloom-logo.svg'))

useHead({
  title: 'PDFloom — PDF Template Designer for Inventory Reports',
  meta: [
    {
      name: 'description',
      content:
        'PDFloom is a drag-and-drop PDF template editor for inventory reports, invoices, and packing slips. Bind tables to live inventory data, pick your own fonts and colors, and preview the real PDF instantly — no signup required to try.'
    }
  ]
})

// Element refs (editor section, reveal targets) are set by Vue during the DOM patch, which
// happens before this component's own onMounted fires — so anything a ref callback depends on
// has to be ready eagerly, not deferred into onMounted, or the first (and only, thanks to the
// dataset guard below) call ends up reading it before it exists.
const prefersReduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------- Header shadow-on-scroll ----------
const scrolled = ref(false)

// ---------- Scroll-pinned editor centerpiece ----------
const editorSectionEl = ref<HTMLElement | null>(null)
const editorStep = ref(0)
const editorProgress = ref(0)

const navSteps = [
  { title: 'Header & fields', desc: 'Bind text elements to your organization name and report title.' },
  { title: 'Data-bound tables & badges', desc: 'Wire columns to live inventory fields, with status pills that update automatically.' },
  { title: 'Any font, any color', desc: 'Any Google Font per element, with custom text and background colors.' },
  { title: 'Multi-page layouts', desc: 'Reports spanning multiple pages, each with its own background and layout.' }
]

let ticking = false
function onScroll() {
  scrolled.value = window.scrollY > 8

  const el = editorSectionEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
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

// ---------- Gradient background, driven by the pinned section's overall scroll progress ----------
// One preset per editor step (same 4-way granularity as the rest of the mockup) rather than a
// continuously-interpolated gradient — CSS can't smoothly tween between two arbitrary gradients,
// so snapping in step with everything else it already snaps with (nav/toolbar/zone) reads as
// intentional instead of janky. Stays within the app's own background/soft tones (never a
// saturated hue) so zone text sitting on top never loses contrast.
const pageGradients = [
  'linear-gradient(135deg, var(--color-bg) 0%, var(--color-bg) 100%)',
  'linear-gradient(135deg, var(--color-bg) 30%, var(--color-primary-soft) 100%)',
  'linear-gradient(50deg, var(--color-primary-soft) 0%, var(--color-bg) 55%, var(--color-primary-soft) 100%)',
  'linear-gradient(200deg, var(--color-bg) 0%, var(--color-surface) 60%, var(--color-bg) 100%)'
]
const editorPageStyle = computed(() => ({ background: pageGradients[editorStep.value] }))

// ---------- Font-cycling fields ----------
// Several small "elements" that each cycle through the same font presets as scroll advances,
// phase-shifted per field so they cascade instead of flipping in lockstep — demonstrates
// per-element font choice more vividly than one line a visitor has to click to see change.
const fonts = [
  { family: 'Georgia, serif', color: 'var(--color-text)', fontStyle: 'normal', decoration: 'none' },
  { family: "'Courier New', monospace", color: 'var(--color-primary)', fontStyle: 'normal', decoration: 'none' },
  { family: 'var(--font-sans)', color: 'var(--color-danger)', fontStyle: 'italic', decoration: 'underline' }
]
const fontFields = ['Product', 'SKU-1042', '$24.99', '8 in stock']
const fieldPhaseOffset = 0.18

function fontStyleForField(i: number) {
  const phase = (editorProgress.value + i * fieldPhaseOffset) % 1
  const font = fonts[Math.floor(phase * fonts.length) % fonts.length]!
  return {
    fontFamily: font.family,
    color: font.color,
    fontStyle: font.fontStyle,
    textDecoration: font.decoration
  }
}

// ---------- Example templates ----------
const templates = [
  {
    title: 'Low Stock Report',
    description: 'Table of SKUs under reorder threshold',
    pillClass: 'badge-danger',
    pillLabel: 'Low stock',
    bullets: ['SKU & product name', 'Quantity on hand', 'Reorder threshold', 'Auto status badge']
  },
  {
    title: 'Invoice',
    description: 'Line items, totals, and payment terms',
    pillClass: 'badge-primary',
    pillLabel: 'Draft',
    bullets: ['Line items & quantities', 'Subtotal, tax & total', 'Payment terms & due date', 'Billing address']
  },
  {
    title: 'Packing Slip',
    description: 'Order contents for warehouse pick lists',
    pillClass: 'badge-success',
    pillLabel: 'In stock',
    bullets: ['Order number & ship date', 'Item list with quantities', 'Warehouse bin locations', 'Ship-to address']
  }
]
const expandedTemplate = ref<number | null>(null)
function toggleTemplate(idx: number) {
  expandedTemplate.value = expandedTemplate.value === idx ? null : idx
}

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
  onScroll()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', requestScrollUpdate)
  observer?.disconnect()
})
</script>

<template>
  <div class="landing">
    <header class="landing-header" :class="{ scrolled }">
      <NuxtLink to="/landing" class="brand">
        <img :src="logoSrc" alt="PDFloom" class="brand-logo" />
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
    </header>

    <section class="hero">
      <div class="hero-orb" />
      <div class="hero-content">
        <div class="eyebrow-pill">Introducing PDFloom</div>
        <h1>Design your own PDF reports — visually.</h1>
        <p class="hero-subhead">
          Drag fields, tables, and images onto a page. Bind them to your live inventory data. No Handlebars, no PDF
          library, no template stuck in someone else's codebase.
        </p>
        <div class="hero-ctas">
          <NuxtLink to="/templates/new" class="btn btn-primary btn-lg">Start designing</NuxtLink>
          <a href="#examples" class="btn btn-secondary btn-lg">View example templates</a>
        </div>
        <p class="hero-microcopy">Free to design. Sign in only to save.</p>
        <div class="scroll-cue">
          <span>Scroll to see it in action</span>
          <span class="scroll-cue-arrow">&darr;</span>
        </div>
      </div>
    </section>

    <section ref="editorSectionEl" class="editor-section">
      <div class="editor-sticky">
        <div class="editor-nav">
          <div class="editor-nav-eyebrow">The editor</div>
          <div class="editor-nav-list">
            <div class="editor-nav-progress" :style="{ height: editorProgress * 100 + '%' }" />

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
            <div class="editor-page" :style="editorPageStyle">
              <div class="editor-zone" :class="{ 'is-active': editorStep === 0 }">
                <div class="zone-bar-title" />
                <div class="zone-bar-subtitle" />
              </div>

              <div class="editor-zone" :class="{ 'is-active': editorStep === 1 }">
                <div class="zone-row"><span>Wireless Mouse</span><span class="badge badge-danger">Low</span></div>
                <div class="zone-row"><span>USB-C Cable</span><span class="badge badge-success">In stock</span></div>
                <div class="zone-row"><span>HDMI Adapter</span><span class="badge badge-success">In stock</span></div>
              </div>

              <div class="editor-zone" :class="{ 'is-active': editorStep === 2 }">
                <div class="font-fields">
                  <span v-for="(field, i) in fontFields" :key="field" class="font-chip" :style="fontStyleForField(i)">{{ field }}</span>
                </div>
              </div>

              <div class="editor-zone pages-zone" :class="{ 'is-active': editorStep === 3 }">
                <div class="pages-thumbs">
                  <div class="page-thumb is-first" />
                  <div class="page-thumb" />
                  <div class="page-thumb" />
                </div>
                <div class="pages-caption">3 pages, one template</div>
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
          v-for="(tmpl, idx) in templates"
          :key="tmpl.title"
          :ref="observeReveal(revealKeys[idx]!)"
          class="example-card card"
          :class="{ 'is-revealed': revealed[revealKeys[idx]!] }"
          :style="{ transitionDelay: idx * 0.08 + 's' }"
        >
          <div class="example-preview"><span>template preview</span></div>
          <div class="example-body">
            <h3>{{ tmpl.title }}</h3>
            <p>{{ tmpl.description }}</p>
            <span class="badge" :class="tmpl.pillClass">{{ tmpl.pillLabel }}</span>
            <button class="included-toggle" :class="{ 'is-open': expandedTemplate === idx }" type="button" @click="toggleTemplate(idx)">
              <span>What's included</span>
              <span class="included-chevron">&#9662;</span>
            </button>
            <div class="included-detail" :class="{ 'is-open': expandedTemplate === idx }">
              <ul>
                <li v-for="bullet in tmpl.bullets" :key="bullet">{{ bullet }}</li>
              </ul>
            </div>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1120px;
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
.brand {
  display: flex;
  align-items: center;
}
.brand-logo {
  display: block;
  height: 32px;
  width: auto;
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
  max-width: 840px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-5) var(--space-6);
  text-align: center;
  position: relative;
}
.hero-orb {
  position: absolute;
  top: -40px;
  left: 50%;
  width: 520px;
  height: 320px;
  margin-left: -260px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--color-primary-soft), transparent 70%);
  opacity: 0.8;
  pointer-events: none;
  z-index: 0;
  animation: floatOrb 9s ease-in-out infinite;
}
@keyframes floatOrb {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-14px, 18px); }
}
@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.hero-content {
  position: relative;
  z-index: 1;
}
.eyebrow-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: var(--text-xs);
  font-weight: 600;
  margin-bottom: var(--space-5);
}
.hero h1 {
  margin: 0 0 var(--space-4);
  font-size: calc(var(--text-2xl) * 2);
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.02em;
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
  margin-top: var(--space-6);
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
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 var(--space-5);
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
  flex: 1;
  display: flex;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  height: min(600px, 78vh);
}
.editor-toolbar {
  width: 52px;
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
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--color-text-muted);
  background: transparent;
  transition: background-color 0.3s ease, color 0.3s ease;
}
.editor-tool.is-active {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}
.editor-canvas-area {
  flex: 1;
  padding: var(--space-6);
  display: flex;
  align-items: center;
  justify-content: center;
  background-image: repeating-linear-gradient(0deg, transparent, transparent 27px, var(--color-border) 27px, var(--color-border) 28px),
    repeating-linear-gradient(90deg, transparent, transparent 27px, var(--color-border) 27px, var(--color-border) 28px);
  background-size: 28px 28px;
}
.editor-page {
  width: 100%;
  max-width: 340px;
  aspect-ratio: 8.5 / 11;
  background: var(--color-bg);
  border: 1px solid var(--color-border-strong);
  transition: background 0.5s ease;
  border-radius: 4px;
  box-shadow: var(--shadow-md);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.editor-zone {
  border-radius: 8px;
  padding: var(--space-2);
  opacity: 0.35;
  box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
  background: transparent;
  transition: opacity 0.4s ease, box-shadow 0.4s ease, background-color 0.4s ease;
}
.editor-zone.is-active {
  opacity: 1;
  box-shadow: 0 0 0 3px var(--color-primary);
  background: var(--color-primary-soft);
}
.zone-bar-title {
  background: var(--color-text);
  border-radius: 2px;
  height: 14px;
  width: 55%;
  margin-bottom: 8px;
}
.zone-bar-subtitle {
  background: var(--color-text-muted);
  opacity: 0.5;
  border-radius: 2px;
  height: 8px;
  width: 35%;
}
.zone-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}
.zone-row:last-child {
  margin-bottom: 0;
}
.font-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.font-chip {
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  transition: color 0.3s ease, font-style 0.3s ease;
}
.pages-zone {
  margin-top: auto;
}
.pages-thumbs {
  display: flex;
  gap: 8px;
}
.page-thumb {
  width: 34px;
  height: 44px;
  border-radius: 3px;
  background: var(--color-bg);
  border: 1px solid var(--color-border-strong);
}
.page-thumb.is-first {
  background: var(--color-primary-soft);
  border-color: var(--color-primary);
}
.pages-caption {
  font-size: 10px;
  color: var(--color-text-faint);
  margin-top: 6px;
}

/* ---------- Example templates ---------- */
.examples {
  max-width: 1120px;
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
  aspect-ratio: 4 / 3;
  background: repeating-linear-gradient(135deg, var(--color-border) 0px, var(--color-border) 1px, transparent 1px, transparent 12px), var(--color-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.example-preview span {
  font-family: ui-monospace, monospace;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
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
.included-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border: none;
  border-top: 1px solid var(--color-border);
  background: none;
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-muted);
  cursor: pointer;
  padding-left: 0;
  padding-right: 0;
}
.included-chevron {
  display: inline-block;
  transition: transform 0.25s ease;
}
.included-toggle.is-open .included-chevron {
  transform: rotate(180deg);
}
.included-detail {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  margin-top: 0;
  transition: max-height 0.3s ease, opacity 0.3s ease, margin-top 0.3s ease;
}
.included-detail.is-open {
  max-height: 170px;
  opacity: 1;
  margin-top: 10px;
}
.included-detail ul {
  margin: 0;
  padding-left: 18px;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  line-height: 1.7;
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
  max-width: 1120px;
  margin: 0 auto;
  padding: var(--space-5);
  color: var(--color-text-faint);
  font-size: var(--text-xs);
}

@media (max-width: 860px) {
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
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--space-4);
    border-left: none;
    padding-left: 0;
  }
  .editor-nav-progress {
    display: none;
  }
  .editor-mockup {
    height: min(480px, 55vh);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-orb,
  .scroll-cue-arrow {
    animation: none !important;
  }
}
</style>
