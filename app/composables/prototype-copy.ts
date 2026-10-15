import { prototypeCopy } from '../prototype/copy'

/** Locale-aware labels for the throwaway screens. */
export function usePrototypeCopy() {
  const { locale, setLocale } = useI18n()
  const copy = computed(() => prototypeCopy(locale.value))
  return { locale, setLocale, copy }
}
