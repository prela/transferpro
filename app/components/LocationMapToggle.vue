<script setup lang="ts">
import { commandControlClass, commandControlSize } from '../ride-detail'

const props = defineProps<{
  /** The Embed URL from the last office read. The frame exists only while open. */
  embedUrl: string
  /** The Location's name, used in the frame title. */
  name: string
  /** Phone uses the large target. The office desktop uses the small size. */
  phone: boolean
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const { t } = useI18n()
const mapFrameId = useId()

/**
 * The press opens Google's frame. Focus stays on this button so a keyboard
 * user is not dropped into that frame (ADR-0052).
 */
async function toggle(event: MouseEvent) {
  emit('update:open', !props.open)
  const button = event.currentTarget
  await nextTick()
  if (button instanceof HTMLElement)
    button.focus()
}
</script>

<template>
  <div>
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      :size="commandControlSize(phone)"
      class="w-full justify-center sm:w-auto"
      :class="commandControlClass(phone)"
      :aria-expanded="open"
      :aria-controls="mapFrameId"
      @click="toggle"
    >
      {{ open ? t('locations.hideMap') : t('locations.showMap') }}
    </UButton>
    <!--
      The frame exists only after the press, so nothing is sent before
      then. No sandbox: Google's scripts and its larger-map link must run.
      allow grants nothing. The border is the theme token. The map is not
      restyled, cropped, or credited again. The src is the current Embed
      URL, so a replaced reference reloads this same frame once.
    -->
    <iframe
      v-if="open"
      :id="mapFrameId"
      :src="embedUrl"
      :title="t('locations.mapTitle', { name })"
      class="mt-2 block h-[240px] w-full border border-default"
      referrerpolicy="strict-origin-when-cross-origin"
      allow=""
    />
  </div>
</template>
