import type { AddressSuggestion, LocationKind, LocationPlace } from '../../shared'
import { fillLocationFromPick, LOCATION_SUGGEST_MIN_LENGTH, locationNameMaySuggest, suggestAddressesResponseSchema } from '../../shared'

/**
 * One field waits this long after the last key so a lookup is one request
 * per pause, not one per character. The quota is per request (ADR-0061).
 */
const SUGGEST_PAUSE_MS = 300

type PlaceSuggestionOutcome = 'ok' | 'unavailable'

/**
 * Suggestions for one field. The session token, the pause, the late answer,
 * the list, the attribution, and the unavailable flag belong to this field
 * and are never shared with the other (ADR-0061). A token is created on the
 * first lookup and dropped on a pick.
 */
function usePlaceFieldSuggestions(
  readText: () => string,
  onSettled: (outcome: PlaceSuggestionOutcome) => void,
) {
  const suggestions = ref<AddressSuggestion[]>([])
  const attribution = ref<string | null>(null)
  const unavailable = ref(false)
  const items = computed(() => suggestions.value.map(suggestion => suggestion.label))
  let sessionToken: string | null = null
  let timer = 0
  let generation = 0
  let controller: AbortController | null = null

  /**
   * Forget a lookup that is waiting or already in flight. Aborting the
   * fetch drops the request. A late answer sees a newer generation, or an
   * aborted signal, and does not fill the list or the notice.
   */
  function dropInFlight() {
    generation += 1
    window.clearTimeout(timer)
    controller?.abort()
    controller = null
    suggestions.value = []
    attribution.value = null
  }

  /** A new form starts with no token and no notice of its own. */
  function reset() {
    dropInFlight()
    sessionToken = null
    unavailable.value = false
  }

  /**
   * The typed text is a pick when it is a suggestion's label. Anything else,
   * including Enter after the list was closed, is not a pick. A pick ends
   * this field's session so the next typing run is a new one.
   */
  function match(next: string): AddressSuggestion | null {
    const found = suggestions.value.find(suggestion => suggestion.label === next) ?? null
    if (found === null)
      return null
    sessionToken = null
    dropInFlight()
    return found
  }

  function schedule() {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      void lookup()
    }, SUGGEST_PAUSE_MS)
  }

  async function lookup() {
    const text = readText().trim()
    if (text.length < LOCATION_SUGGEST_MIN_LENGTH) {
      dropInFlight()
      return
    }
    if (sessionToken === null)
      sessionToken = crypto.randomUUID()
    const token = sessionToken
    const current = ++generation
    const attempt = new AbortController()
    controller = attempt
    try {
      const result = suggestAddressesResponseSchema.parse(await $fetch('/api/locations/suggestions', {
        method: 'POST',
        body: { text, sessionToken: token },
        signal: attempt.signal,
      }))
      if (current !== generation || attempt.signal.aborted)
        return
      if (!result.available) {
        suggestions.value = []
        attribution.value = null
        unavailable.value = true
        onSettled('unavailable')
        return
      }
      unavailable.value = false
      suggestions.value = [...result.suggestions]
      attribution.value = result.suggestions.length > 0 ? result.attribution : null
      onSettled('ok')
    }
    catch {
      if (current !== generation || attempt.signal.aborted)
        return
      suggestions.value = []
      attribution.value = null
      unavailable.value = true
      onSettled('unavailable')
    }
  }

  onUnmounted(() => {
    window.clearTimeout(timer)
    controller?.abort()
  })

  return { items, attribution, unavailable, match, schedule, dropInFlight, reset }
}

function textOf(value: string | number | null | undefined): string {
  return value == null ? '' : String(value)
}

/**
 * The suggestion rules for one Location form. The panel and the quick add
 * both call this, so the fill, the kind gate, the session, and the notice
 * exist once (ADR-0061).
 */
export function useLocationPlaceForm(fields: {
  name: () => string
  setName: (value: string) => void
  kind: () => LocationKind | undefined
  address: () => string
  setAddress: (value: string) => void
  setPlace: (place: LocationPlace | null) => void
  /** The address after a keystroke or a pick. The panel uses it to hide the map. */
  onAddressText?: (next: string) => void
}) {
  const suggestionNotice = ref<'name' | 'address' | null>(null)
  let fillingPick = false
  /**
   * The name text already on screen. A menu that echoes it on mount, and a
   * kind change, are not keystrokes, so they do not look the name up.
   */
  let seenName = ''
  /** The address that still belongs to the stored place. A different one clears it. */
  let pickedAddress: string | null = null

  function noteSuggestion(field: 'name' | 'address', outcome: PlaceSuggestionOutcome) {
    suggestionNotice.value = outcome === 'ok' ? null : field
  }

  const nameField = usePlaceFieldSuggestions(() => fields.name(), outcome => noteSuggestion('name', outcome))
  const addressField = usePlaceFieldSuggestions(() => fields.address(), outcome => noteSuggestion('address', outcome))
  const nameMaySuggest = computed(() => locationNameMaySuggest(fields.kind()))

  /**
   * Changing the kind to address, or to none, closes the name list and drops
   * a lookup that is already in flight. The name, the address, and the place
   * stay (ADR-0061).
   */
  watch(() => fields.kind(), (kind) => {
    seenName = fields.name()
    if (!locationNameMaySuggest(kind))
      nameField.dropInFlight()
  })

  function reset() {
    suggestionNotice.value = null
    pickedAddress = null
    seenName = fields.name()
    nameField.reset()
    addressField.reset()
  }

  /**
   * Remember the address that belongs to a place already on the form.
   * Opening an edit does this so typing that same address does not clear it.
   */
  function keepPlaceAddress(address: string | null) {
    pickedAddress = address
  }

  /**
   * A pick writes the suggestion's name and address, not the list label.
   * The flag ignores the model update that write causes, so it is not a
   * second keystroke and does not clear the place just stored.
   */
  function applyPick(field: 'name' | 'address', suggestion: AddressSuggestion) {
    const filled = fillLocationFromPick(field, suggestion, {
      name: fields.name(),
      address: fields.address(),
    })
    fillingPick = true
    fields.setName(filled.name)
    fields.setAddress(filled.address)
    fields.setPlace(filled.place)
    pickedAddress = filled.address
    seenName = filled.name
    fields.onAddressText?.(filled.address)
    if (field === 'name')
      addressField.dropInFlight()
    else
      nameField.dropInFlight()
    void nextTick(() => {
      fillingPick = false
    })
  }

  function onNameInput(value: string | number | null | undefined) {
    if (fillingPick)
      return
    const next = textOf(value)
    const match = nameField.match(next)
    if (match) {
      applyPick('name', match)
      return
    }
    // A hand edit of the name keeps the place. Only the address clears it.
    if (next === seenName)
      return
    seenName = next
    // The menu can still emit after the kind has become address. That text
    // must not be sent.
    if (!locationNameMaySuggest(fields.kind())) {
      nameField.dropInFlight()
      return
    }
    nameField.schedule()
  }

  function onAddressInput(value: string | number | null | undefined) {
    if (fillingPick)
      return
    const next = textOf(value)
    fields.onAddressText?.(next)
    const match = addressField.match(next)
    if (match) {
      applyPick('address', match)
      return
    }
    if (next !== pickedAddress)
      fields.setPlace(null)
    addressField.schedule()
  }

  /** Enter submits the typed text. It must not store the highlighted row. */
  function closeSuggestionsForSubmit() {
    nameField.dropInFlight()
    addressField.dropInFlight()
  }

  return {
    nameMaySuggest,
    suggestionNotice,
    nameSuggestionItems: nameField.items,
    nameAttribution: nameField.attribution,
    nameSuggestionsUnavailable: nameField.unavailable,
    addressSuggestionItems: addressField.items,
    addressAttribution: addressField.attribution,
    addressSuggestionsUnavailable: addressField.unavailable,
    onNameInput,
    onAddressInput,
    closeSuggestionsForSubmit,
    reset,
    keepPlaceAddress,
  }
}
