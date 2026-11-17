<script setup lang="ts">
const { t } = useI18n()

/**
 * The hash is in the markup so the link still points at the main landmark
 * before hydration. preventDefault keeps that hash out of the address:
 * Ride filters live in the query, and a hash would scroll the shell.
 */
function focusMain(event: MouseEvent) {
  const main = document.getElementById('main-content')
  if (!(main instanceof HTMLElement))
    return
  event.preventDefault()
  main.focus()
}
</script>

<template>
  <!--
    Visible only while focused, and fixed above the top bar, the phone
    bar, and the new-transfer button (WCAG 2.4.11). The ring is the same
    primary outline as the other keyboard controls (ADR-0040).
  -->
  <a
    href="#main-content"
    class="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-default focus:px-3 focus:py-2 focus:text-default focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary print:hidden"
    @click="focusMain"
  >
    {{ t('shell.skipToContent') }}
  </a>
</template>
