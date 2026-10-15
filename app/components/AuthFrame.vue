<script setup lang="ts">
const emit = defineEmits<{
  choose: [locale: 'hr' | 'en']
}>()

const { t } = useI18n()
</script>

<template>
  <!--
    Sign-in and the invitation screen share this frame (ADR-0038).
    The card stays at most 28rem on the frame surface. The mark is the
    only h1, so a later logo can replace that element and the form stays put.
    Language and theme stay small and in the top-right, before any session.
  -->
  <div class="flex min-h-dvh flex-col items-center bg-[var(--tp-frame)]">
    <div class="flex w-full flex-wrap justify-end gap-2 p-4">
      <LocaleThemeActions
        size="sm"
        @choose="emit('choose', $event)"
      />
    </div>
    <main class="mx-auto flex w-full max-w-md flex-1 items-center px-4 pb-8">
      <UCard
        variant="outline"
        class="w-full bg-[var(--tp-panel)]"
      >
        <template #header>
          <h1 class="text-xl font-semibold text-highlighted">
            {{ t('signIn.mark') }}
          </h1>
          <p class="mt-1 text-sm text-muted">
            {{ t('signIn.subtitle') }}
          </p>
        </template>
        <slot />
      </UCard>
    </main>
  </div>
</template>
