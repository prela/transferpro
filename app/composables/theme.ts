const storageKey = 'transferpro-theme'

/**
 * System preference until the user toggles. The choice is stored on this device.
 * An inline script in the document head applies a stored choice before paint.
 */
export function useThemeToggle() {
  function current(): 'light' | 'dark' {
    const set = document.documentElement.dataset.theme
    if (set === 'light' || set === 'dark')
      return set
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function toggle() {
    const next = current() === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem(storageKey, next)
  }

  onMounted(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored === 'light' || stored === 'dark')
      document.documentElement.dataset.theme = stored
  })

  return { toggle }
}
