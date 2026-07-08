<script setup lang="ts">
export interface SelectOption {
  value: string
  label: string
}

const props = defineProps<{
  modelValue: string
  options: (string | SelectOption)[]
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
}>()

function normalize(opt: string | SelectOption): SelectOption {
  return typeof opt === 'string' ? { value: opt, label: opt } : opt
}

const normalizedOptions = computed(() => props.options.map(normalize))
const selectedIndex = computed(() => normalizedOptions.value.findIndex((o) => o.value === props.modelValue))
const selectedLabel = computed(() => normalizedOptions.value[selectedIndex.value]?.label ?? '')

const isOpen = ref(false)
const activeIndex = ref(0)
const rootEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const optionId = (i: number) => `app-select-opt-${instanceId}-${i}`
const instanceId = Math.random().toString(36).slice(2, 8)

function open() {
  if (isOpen.value) return
  activeIndex.value = selectedIndex.value === -1 ? 0 : selectedIndex.value
  isOpen.value = true
  nextTick(() => {
    const activeEl = listEl.value?.querySelector(`#${optionId(activeIndex.value)}`) as HTMLElement | null
    activeEl?.scrollIntoView({ block: 'nearest' })
  })
}

function close() {
  isOpen.value = false
}

function toggle() {
  isOpen.value ? close() : open()
}

function choose(index: number) {
  const opt = normalizedOptions.value[index]
  if (!opt) return
  emit('update:modelValue', opt.value)
  close()
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
    event.preventDefault()
    if (!isOpen.value) {
      open()
      return
    }
  }
  if (!isOpen.value) return
  if (event.key === 'ArrowDown') {
    activeIndex.value = Math.min(activeIndex.value + 1, normalizedOptions.value.length - 1)
    scrollActiveIntoView()
  } else if (event.key === 'ArrowUp') {
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
    scrollActiveIntoView()
  } else if (event.key === 'Enter' || event.key === ' ') {
    choose(activeIndex.value)
  } else if (event.key === 'Escape') {
    close()
  }
}

function scrollActiveIntoView() {
  nextTick(() => {
    const activeEl = listEl.value?.querySelector(`#${optionId(activeIndex.value)}`) as HTMLElement | null
    activeEl?.scrollIntoView({ block: 'nearest' })
  })
}

function onClickOutside(event: MouseEvent) {
  if (!rootEl.value?.contains(event.target as Node)) close()
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))

// Lets a parent drive the dropdown open/closed programmatically — e.g. landing.vue's scripted
// cursor demo, which opens/closes this same way a real click would rather than faking its own
// popup.
defineExpose({ open, close })
</script>

<template>
  <div ref="rootEl" class="app-select" :class="{ open: isOpen }">
    <button
      type="button"
      class="app-select-trigger"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="app-select-label">{{ selectedLabel }}</span>
      <svg class="app-select-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
        <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <Transition name="app-select-pop">
      <ul v-if="isOpen" ref="listEl" class="app-select-list" role="listbox">
        <li
          v-for="(opt, index) in normalizedOptions"
          :id="optionId(index)"
          :key="opt.value"
          role="option"
          :aria-selected="opt.value === modelValue"
          class="app-select-option"
          :class="{ active: index === activeIndex, selected: opt.value === modelValue }"
          @mousemove="activeIndex = index"
          @click="choose(index)"
        >
          {{ opt.label }}
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.app-select {
  position: relative;
  display: inline-block;
}
.app-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  font-family: inherit;
  font-size: var(--text-sm);
  /* Matches .field-input's padding so it sits at the same height as sibling inputs by
     default; the compact tooltip context overrides this back down (see templates/[id].vue). */
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.app-select-trigger:hover {
  border-color: var(--color-primary);
}
.app-select-trigger:focus-visible {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-soft);
}
.app-select.open .app-select-trigger {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-soft);
}
.app-select-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-select-chevron {
  flex-shrink: 0;
  color: var(--color-text-muted);
  transition: transform 0.15s ease;
}
.app-select.open .app-select-chevron {
  transform: rotate(180deg);
  color: var(--color-primary);
}
.app-select-list {
  position: absolute;
  z-index: 60;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  max-height: 220px;
  overflow-y: auto;
  margin: 0;
  padding: var(--space-1);
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  transform-origin: top center;

  /* Minimal scrollbar: a thin, muted accent-colored hairline at rest, brightening to the
     full accent on hover — rather than a thick/rounded "custom scrollbar tutorial" thumb. */
  scrollbar-width: thin;
  scrollbar-color: var(--color-primary-faint) transparent;
  transition: scrollbar-color 0.15s ease;
}
.app-select-list:hover {
  scrollbar-color: var(--color-primary-hover) transparent;
}
.app-select-list::-webkit-scrollbar {
  width: 4px;
}
.app-select-list::-webkit-scrollbar-track {
  background: transparent;
}
.app-select-list::-webkit-scrollbar-thumb {
  background: var(--color-primary-faint);
  border-radius: 0;
}
.app-select-list:hover::-webkit-scrollbar-thumb {
  background: var(--color-primary-hover);
}
/* Some Windows browsers render small clickable up/down arrows at the ends of the
   scrollbar track by default — hide them so it's just the thin thumb. */
.app-select-list::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}
.app-select-option {
  padding: 6px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  white-space: nowrap;
  cursor: pointer;
}
.app-select-option.active {
  background: var(--color-bg);
}
.app-select-option.selected {
  color: var(--color-primary);
  font-weight: 600;
}
.app-select-pop-enter-active,
.app-select-pop-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.app-select-pop-enter-from,
.app-select-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.97);
}
@media (prefers-reduced-motion: reduce) {
  .app-select-pop-enter-active,
  .app-select-pop-leave-active {
    transition: none;
  }
}
</style>
