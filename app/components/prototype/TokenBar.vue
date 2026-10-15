<script setup lang="ts">
import { PROTOTYPE_VARIANTS, surfaceContrast, surfaceTokens, variantParts } from '../../prototype/tokens'

const colorMode = useColorMode()
const { copy, locale, setLocale } = usePrototypeCopy()
const { route, variant, query } = usePrototypeQuery()
const mounted = ref(false)

onMounted(() => {
  mounted.value = true
})

const lightTokens = surfaceTokens(variant.value, false)
const darkTokens = computed(() => surfaceTokens(variant.value, true))
const lightRatios = surfaceContrast('adr-36', false).panel
const darkRatios = computed(() => surfaceContrast(variant.value, true).panel)
const row = computed(() => variantParts(variant.value).row)

function picked(name: 'light' | 'dark' | 'system' | 'hr' | 'en'): 'solid' | 'ghost' {
  if (!mounted.value)
    return 'ghost'
  if (name === 'hr' || name === 'en')
    return locale.value === name ? 'solid' : 'ghost'
  return colorMode.preference === name ? 'solid' : 'ghost'
}

function variantTo(name: string) {
  return { path: route.path, query: query({ variant: name }) }
}
</script>

<template>
  <!--
    Stays on screen in every screenshot so the owner can see which variant
    and which token values are in front of them.
  -->
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-muted bg-[var(--tp-panel)] px-3 py-1.5 text-xs text-muted">
    <span class="font-medium text-highlighted">{{ copy.branch }}</span>
    <span>{{ copy.variant }}</span>
    <UButton
      v-for="name in PROTOTYPE_VARIANTS"
      :key="name"
      size="xs"
      color="neutral"
      :variant="name === variant ? 'solid' : 'ghost'"
      :label="name"
      :to="variantTo(name)"
    />
    <span class="tabular-nums">{{ copy.row }} {{ row }} px</span>
    <span class="hidden font-mono lg:inline dark:hidden">
      {{ copy.frame }} {{ lightTokens.frame }}
      · {{ copy.working }} {{ lightTokens.working }}
      · {{ copy.panel }} {{ lightTokens.panel }}
      · {{ copy.hover }} {{ lightTokens.hover }}
    </span>
    <span class="hidden font-mono dark:lg:inline">
      {{ copy.frame }} {{ darkTokens.frame }}
      · {{ copy.working }} {{ darkTokens.working }}
      · {{ copy.panel }} {{ darkTokens.panel }}
      · {{ copy.hover }} {{ darkTokens.hover }}
    </span>
    <span class="hidden font-mono xl:inline dark:hidden">
      {{ copy.secondary }} {{ lightTokens.secondary }}
      · {{ copy.control }} {{ lightTokens.control }}
      · {{ copy.structural }} {{ lightTokens.structural }}
      · {{ copy.contrast }} {{ lightRatios.text }} / {{ lightRatios.control }} / {{ lightRatios.structural }}
    </span>
    <span class="hidden font-mono dark:xl:inline">
      {{ copy.secondary }} {{ darkTokens.secondary }}
      · {{ copy.control }} {{ darkTokens.control }}
      · {{ copy.structural }} {{ darkTokens.structural }}
      · {{ copy.contrast }} {{ darkRatios.text }} / {{ darkRatios.control }} / {{ darkRatios.structural }}
    </span>
    <span class="ml-auto flex items-center gap-1">
      <UButton size="xs" color="neutral" :variant="picked('hr')" label="HR" @click="setLocale('hr')" />
      <UButton size="xs" color="neutral" :variant="picked('en')" label="EN" @click="setLocale('en')" />
      <UButton size="xs" color="neutral" :variant="picked('light')" :label="copy.light" @click="colorMode.preference = 'light'" />
      <UButton size="xs" color="neutral" :variant="picked('dark')" :label="copy.dark" @click="colorMode.preference = 'dark'" />
      <UButton size="xs" color="neutral" :variant="picked('system')" :label="copy.system" @click="colorMode.preference = 'system'" />
    </span>
  </div>
</template>
