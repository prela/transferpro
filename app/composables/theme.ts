/**
 * System preference until the user toggles. The choice is stored on this device
 * under `transferpro-theme`. `@nuxtjs/color-mode` reads that key and applies it
 * before paint (ADR-0016). A toggle stores only light or dark, never system.
 */
export function useThemeToggle() {
  const colorMode = useColorMode()

  function toggle() {
    colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
  }

  return { toggle }
}
