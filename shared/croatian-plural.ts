/**
 * Croatian plural categories (CLDR `hr`), in catalog order: one, few, other.
 *
 * one is 1, 21, 31, … and not 11. few is 2–4, 22–24, … and not 12–14.
 * Everything else, including 0 and 5–20, is other.
 *
 * A three-form message uses that order. A two-form message stays one |
 * other, so an existing catalog that only has those two keeps its text.
 * A message with no plural form is its only choice.
 */
export function croatianPluralIndex(choice: number, choicesLength: number): number {
  if (choicesLength <= 1)
    return 0
  const count = Math.floor(Math.abs(choice))
  const mod10 = count % 10
  const mod100 = count % 100
  const one = mod10 === 1 && mod100 !== 11
  if (choicesLength === 2)
    return one ? 0 : 1
  const few = mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
  if (one)
    return 0
  if (few)
    return Math.min(1, choicesLength - 1)
  return Math.min(2, choicesLength - 1)
}
