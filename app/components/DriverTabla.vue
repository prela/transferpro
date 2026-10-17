<script setup lang="ts">
import { fittedMeetSign } from '../../shared'

const props = defineProps<{
  /** Meet-sign text. Blank lines never reach this component. */
  tabla: string
}>()

const { t } = useI18n()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const frame = ref<HTMLElement | null>(null)
const sign = ref<HTMLElement | null>(null)
// Captured before the dialog locks the body. Reading scrollY after open is 0.
let savedScroll = 0

useMeetSignWakeLock(open)

watch(open, (isOpen) => {
  if (!import.meta.client || !isOpen)
    return
  // The dialog may still be entering. Fit again on after:enter.
  void nextTick(() => fitSign())
})

/**
 * Capture phase, so this runs before the dialog trigger opens and locks
 * scroll. A read inside the open watch is already 0.
 */
function rememberScroll(event: Event) {
  const host = root.value
  if (!host || open.value || !(event.target instanceof Node) || !host.contains(event.target))
    return
  savedScroll = window.scrollY
}

/**
 * The lock releases as the dialog unmounts and writes its own scroll
 * position after after:leave. Put the list back on the following frames.
 */
function restoreScroll() {
  if (!import.meta.client)
    return
  const top = savedScroll
  const apply = () => window.scrollTo(0, top)
  void nextTick(() => {
    requestAnimationFrame(() => {
      apply()
      requestAnimationFrame(apply)
    })
  })
}

onMounted(() => {
  document.addEventListener('pointerdown', rememberScroll, true)
  document.addEventListener('keydown', rememberScroll, true)
  window.addEventListener('resize', onResize)
})
onScopeDispose(() => {
  if (!import.meta.client)
    return
  document.removeEventListener('pointerdown', rememberScroll, true)
  document.removeEventListener('keydown', rememberScroll, true)
  window.removeEventListener('resize', onResize)
})

/**
 * Shrink the type until the whole sign sits in the frame, but not below
 * 28px. A sign that still overflows scrolls inside the frame.
 * Rotation changes the frame, so this runs again on resize (ADR-0038).
 */
function fitSign() {
  const box = frame.value
  const text = sign.value
  if (!box || !text)
    return
  const start = Math.floor(Math.min(box.clientWidth, box.clientHeight) * 0.45)
  const fit = fittedMeetSign(start, (size) => {
    text.style.fontSize = `${size}px`
    return text.scrollHeight <= box.clientHeight && text.scrollWidth <= box.clientWidth
  })
  text.style.fontSize = `${fit.sizePx}px`
  text.style.maxHeight = '100%'
  // Scrolling keeps a 200-character sign readable. Clipping would hide it.
  text.style.overflowY = fit.scrolls ? 'auto' : 'hidden'
}

function onResize() {
  if (open.value)
    fitSign()
}
</script>

<template>
  <!--
    Full-screen meet sign (ADR-0038). UModal is the Reka dialog. The content
    slot is the sign itself. The description is a fixed sentence: with the
    content slot, Nuxt UI puts it in VisuallyHidden, so it must not repeat
    the tabla or the screen reader and the e2e locator see the text twice.
  -->
  <div
    ref="root"
    class="contents"
  >
    <UModal
      v-model:open="open"
      fullscreen
      :title="t('transfers.tabla')"
      :description="t('driverRides.tablaDescription')"
      :close="false"
      :ui="{ content: 'bg-default text-highlighted' }"
      @after:enter="fitSign"
      @after:leave="restoreScroll"
    >
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="xl"
        class="mt-3 min-h-12 w-full justify-center"
      >
        {{ t('driverRides.showTabla') }}
      </UButton>
      <template #content>
        <div class="flex h-full min-h-0 flex-1 flex-col bg-default text-highlighted">
          <div
            ref="frame"
            class="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden px-4"
          >
            <p
              ref="sign"
              class="w-full text-center font-semibold leading-tight break-words whitespace-pre-wrap"
            >
              {{ props.tabla }}
            </p>
          </div>
          <div class="p-4">
            <UButton
              type="button"
              size="xl"
              class="min-h-12 w-full justify-center"
              @click="open = false"
            >
              {{ t('driverRides.closeTabla') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
