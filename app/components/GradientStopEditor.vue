<script setup lang="ts">
import type { BackgroundFill, GradientStop } from '~/composables/useTemplatesApi'

const props = defineProps<{
  fill?: BackgroundFill
  stops?: GradientStop[]
  angle?: number
  solidColor?: string
  solidPlaceholder?: string
}>()

const emit = defineEmits<{
  'update:fill': [BackgroundFill]
  'update:stops': [GradientStop[]]
  'update:angle': [number]
  'update:solidColor': [string | undefined]
}>()

const isGradient = computed(() => !!props.fill && props.fill !== 'solid')
// Angle is meaningful for linear (line direction) and conic (start angle) but not radial,
// which is always centered — see compileBackground on the backend.
const showAngle = computed(() => props.fill === 'linear' || props.fill === 'conic')

function onFillChange(value: string) {
  const fill = value as BackgroundFill
  emit('update:fill', fill)
  // Switching solid -> gradient with no stops yet would render nothing (compileBackground
  // needs >=2 stops) — seed two sensible defaults so the switch is visibly a gradient right away.
  if (fill !== 'solid' && (!props.stops || props.stops.length < 2)) {
    emit('update:stops', [
      { color: props.solidColor || '#2bb4a8', position: 0 },
      { color: '#0f7d70', position: 100 }
    ])
  }
}

function updateStop(index: number, patch: Partial<GradientStop>) {
  const next = (props.stops ?? []).map((s, i) => (i === index ? { ...s, ...patch } : s))
  emit('update:stops', next)
}

function addStop() {
  const stops = props.stops ?? []
  // Interpolates a new stop between the two highest-position existing stops (or duplicates
  // the last one at 100% if there's nothing sensible to interpolate between) — never just
  // drops a same-position duplicate on top of an existing stop.
  const last = stops[stops.length - 1]
  const secondLast = stops[stops.length - 2]
  const position = secondLast ? Math.round((secondLast.position + last.position) / 2) : Math.min(100, (last?.position ?? 0) + 50)
  emit('update:stops', [...stops, { color: last?.color ?? '#2bb4a8', position }])
}

function removeStop(index: number) {
  const stops = props.stops ?? []
  if (stops.length <= 2) return // a gradient needs >=2 stops
  emit(
    'update:stops',
    stops.filter((_, i) => i !== index)
  )
}

const previewBackground = computed(() => computeBackground(props.fill, props.stops, props.angle, props.solidColor))
</script>

<template>
  <div class="gradient-editor">
    <div class="style-row">
      <span class="style-row-label">Fill</span>
      <AppSelect
        class="style-row-select"
        :model-value="fill ?? 'solid'"
        :options="BACKGROUND_FILL_OPTIONS"
        @update:model-value="onFillChange"
      />
    </div>

    <div v-if="!isGradient" class="style-row">
      <span class="style-row-label"></span>
      <AppColorInput :model-value="solidColor" :placeholder="solidPlaceholder ?? 'none'" @update:model-value="(v) => emit('update:solidColor', v)" />
    </div>

    <template v-else>
      <div class="gradient-preview" :style="{ background: previewBackground }"></div>

      <div v-if="showAngle" class="style-row">
        <span class="style-row-label">Angle</span>
        <input
          type="number"
          class="field-input gradient-angle-input"
          title="Gradient angle (degrees)"
          :value="angle ?? 135"
          @input="emit('update:angle', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <div class="gradient-stops">
        <div v-for="(stop, index) in stops ?? []" :key="index" class="gradient-stop-row">
          <AppColorInput class="gradient-stop-swatch-input" :model-value="stop.color" @update:model-value="(v) => updateStop(index, { color: v || stop.color })" />
          <input
            type="number"
            class="gradient-stop-position"
            :value="stop.position"
            min="0"
            max="100"
            @input="updateStop(index, { position: Math.min(100, Math.max(0, Number(($event.target as HTMLInputElement).value))) })"
          />
          <button
            type="button"
            class="gradient-stop-remove"
            :disabled="(stops ?? []).length <= 2"
            title="Remove stop"
            @click="removeStop(index)"
          >
            &#10005;
          </button>
        </div>
      </div>
      <button type="button" class="gradient-add-stop" @click="addStop">+ Add stop</button>
    </template>
  </div>
</template>

<style scoped>
.gradient-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.style-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.style-row-label {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.style-row-select {
  max-width: 160px;
}
.gradient-preview {
  width: 100%;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}
.gradient-angle-input {
  width: 56px;
}
.gradient-stops {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gradient-stop-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.gradient-stop-swatch-input {
  flex: 1;
  min-width: 0;
}
.gradient-stop-position {
  width: 44px;
  flex-shrink: 0;
  font-family: ui-monospace, Menlo, monospace;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  text-align: center;
  padding: 4px 2px;
  border: 1px solid var(--color-border-strong);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text);
}
.gradient-stop-remove {
  flex-shrink: 0;
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
.gradient-stop-remove:hover:not(:disabled) {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
.gradient-stop-remove:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.gradient-add-stop {
  width: 100%;
  padding: 6px;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  background: none;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.gradient-add-stop:hover {
  color: var(--color-primary);
  border-color: var(--color-primary);
}
</style>
