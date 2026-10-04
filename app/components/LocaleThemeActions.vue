<script setup lang="ts">
const emit = defineEmits<{
  choose: [locale: 'hr' | 'en']
}>()

const { t, locale } = useI18n()
const { toggle } = useThemeToggle()

function chooseOther() {
  emit('choose', locale.value === 'hr' ? 'en' : 'hr')
}
</script>

<template>
  <!-- contents: these buttons share the parent's flex row with Sign out. -->
  <div class="contents">
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      class="flex-1 basis-32 justify-center"
      @click="chooseOther"
    >
      {{ locale === 'hr' ? t('locale.en') : t('locale.hr') }}
    </UButton>
    <!--
      Both labels stay in the DOM. The color-mode class hides one before paint,
      so the label does not flash and does not mismatch hydration.
    -->
    <UButton
      type="button"
      color="neutral"
      variant="outline"
      size="xl"
      class="flex-1 basis-32 justify-center"
      @click="toggle"
    >
      <span class="hidden dark:inline">{{ t('theme.useLight') }}</span>
      <span class="inline dark:hidden">{{ t('theme.useDark') }}</span>
    </UButton>
  </div>
</template>
