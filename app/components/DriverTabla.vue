<script setup lang="ts">
import { fittedMeetSign } from '../../shared'

const props = defineProps<{
  /** Meet-sign text. Blank lines never reach this component. */
  tabla: string
}>()

const { t } = useI18n()
const open = ref(false)
const frame = ref<HTMLElement | null>(null)
const sign = ref<HTMLElement | null>(null)
// The list stays where the Driver left it. The dialog locks body scroll.
let savedScroll = 0

useMeetSignWakeLock(open)

watch(open, (isOpen) => {
  if (!import.meta.client || !isOpen)
    return
  savedScroll = window.scrollY
  // The dialog may still be entering. Fit again on after:enter.
  void nextTick(() => fitSign())
})

/** The dialog unlocks body scroll as it leaves. Put the list back. */
function restoreScroll() {
  if (!import.meta.client)
    return
  window.scrollTo({ top: savedScroll, left: 0 })
}

/**
 * Shrink the type until the whole sign sits in the frame. A sign that still
 * overflows at the minimum scrolls inside the frame instead of being clipped.
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

onMounted(() => window.addEventListener('resize', onResize))
onScopeDispose(() => {
  if (import.meta.client)
    window.removeEventListener('resize', onResize)
})
</script>

<template>
  <!--
    Full-screen meet sign (ADR-0038). UModal is the Reka dialog. The content
    slot is the sign itself: text on the working surface, one close control.
  -->
  <UModal
    v-model:open="open"
    fullscreen
    :title="t('transfers.tabla')"
    :description="props.tabla"
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
</template>
