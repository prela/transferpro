<script setup lang="ts">
import type { ThemeChoice } from '../composables/theme'

const props = withDefaults(defineProps<{
  /**
   * Desktop pickers stay small. Phone layouts pass xl so the target is at
   * least 44px (ADR-0038). Sign-in keeps the default: small on every screen.
   */
  size?: 'sm' | 'xl'
}>(), {
  size: 'sm',
})

const emit = defineEmits<{
  choose: [locale: 'hr' | 'en']
}>()

const { t, locale } = useI18n()
const { choose, preference } = useThemeChoice()

// The stored choice is read after mount. Painting aria-pressed from the
// server default would mismatch a device that already picked light or dark.
const ready = ref(false)
onMounted(() => {
  ready.value = true
})

const choices = ['light', 'dark', 'system'] as const

function chooseOther() {
  emit('choose', locale.value === 'hr' ? 'en' : 'hr')
}

function pressed(choice: ThemeChoice): true | undefined {
  if (!ready.value || preference.value !== choice)
    return undefined
  return true
}
</script>

<template>
  <!-- contents: these controls share the parent's flex row with Sign out. -->
  <div class="contents">
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      :size="props.size"
      :class="props.size === 'xl' ? 'min-h-11 flex-1 basis-32 justify-center' : 'justify-center'"
      @click="chooseOther"
    >
      {{ locale === 'hr' ? t('locale.en') : t('locale.hr') }}
    </UButton>
    <div
      class="flex flex-wrap gap-2"
      role="group"
      :aria-label="t('theme.group')"
    >
      <UButton
        v-for="choice in choices"
        :key="choice"
        type="button"
        color="neutral"
        :variant="pressed(choice) ? 'solid' : 'outline'"
        :size="props.size"
        :class="props.size === 'xl' ? 'min-h-11 justify-center' : 'justify-center'"
        :aria-pressed="pressed(choice)"
        @click="choose(choice)"
      >
        {{ t(`theme.${choice}`) }}
      </UButton>
    </div>
  </div>
</template>
