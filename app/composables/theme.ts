/**
 * Light, dark, or follow the device. The choice is stored on this device
 * under `transferpro-theme`. `@nuxtjs/color-mode` reads that key and applies
 * it before paint. Follow the device is the default for every role (ADR-0040).
 */
export type ThemeChoice = 'light' | 'dark' | 'system'

export function useThemeChoice() {
  const colorMode = useColorMode()

  function choose(choice: ThemeChoice) {
    colorMode.preference = choice
  }

  const preference = computed(() => colorMode.preference as ThemeChoice)

  return { choose, preference }
}
