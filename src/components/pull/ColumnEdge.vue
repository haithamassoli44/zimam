<script setup lang="ts">
// The edge between the side column and the diff. Dragging it sets the column's width; dragging well past the
// narrowest folds the column away, and dragging back out brings it back. A double click goes back to the first width.
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { COLUMN, columnOpen, columnWidth, setColumn, widest } from '@/components/pull/column'
import { rtl } from '@/locale'

const { t } = useI18n()

const dragging = ref(false)
watch(dragging, (on) => {
  document.documentElement.style.cursor = on ? 'col-resize' : ''
  document.documentElement.style.userSelect = on ? 'none' : ''
})
// Toward the diff widens the column, in either direction of writing.
const towardDiff = () => (rtl.value ? -1 : 1)

function drag(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  const edge = event.currentTarget as HTMLElement
  edge.setPointerCapture(event.pointerId)
  const sign = towardDiff()
  const startX = event.clientX
  const from = columnOpen.value ? columnWidth.value : 0
  const before = columnWidth.value
  dragging.value = true
  let frame = 0
  const move = (moved: PointerEvent) => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const width = from + (moved.clientX - startX) * sign
      columnOpen.value = width >= COLUMN.fold
      if (columnOpen.value) setColumn(width, false)
    })
  }
  const end = () => {
    dragging.value = false
    edge.removeEventListener('pointermove', move)
    edge.removeEventListener('pointerup', end)
    edge.removeEventListener('pointercancel', end)
    // Folded by dragging, it opens again at the width it had.
    setColumn(columnOpen.value ? columnWidth.value : before)
  }
  edge.addEventListener('pointermove', move)
  edge.addEventListener('pointerup', end)
  edge.addEventListener('pointercancel', end)
}

function reset() {
  columnOpen.value = true
  setColumn(COLUMN.start)
}

function nudge(event: KeyboardEvent) {
  const by = (event.shiftKey ? 64 : 16) * towardDiff()
  const width = columnOpen.value ? columnWidth.value : 0
  const moves: Record<string, number> = {
    ArrowRight: width + by,
    ArrowLeft: width - by,
    Home: COLUMN.min,
    End: widest.value,
  }
  const next = moves[event.key] as number | undefined
  if (next === undefined) return
  event.preventDefault()
  columnOpen.value = true
  setColumn(next)
}
</script>

<template>
  <div class="relative z-30 w-0 shrink-0">
    <div
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      :aria-label="t('pull.panel.resize')"
      :aria-valuemin="COLUMN.min"
      :aria-valuemax="widest"
      :aria-valuenow="columnOpen ? columnWidth : COLUMN.min"
      class="group absolute inset-y-0 -start-1 w-2 cursor-col-resize touch-none outline-none"
      @pointerdown="drag"
      @dblclick="reset"
      @keydown="nudge"
    >
      <span
        class="absolute inset-y-0 start-[3px] w-0.5 bg-primary transition-opacity group-focus-visible:opacity-100"
        :class="dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-hover:delay-150'"
      />
    </div>
  </div>
</template>
