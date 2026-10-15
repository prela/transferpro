import type { MaybeRefOrGetter } from 'vue'

/** The dashboard navbar's h1. The page body does not repeat it (ADR-0038). */
export function useScreenTitle() {
  return useState('screen-title', () => '')
}

export function bindScreenTitle(title: MaybeRefOrGetter<string>) {
  const screen = useScreenTitle()
  watchEffect(() => {
    screen.value = toValue(title)
  })
}
