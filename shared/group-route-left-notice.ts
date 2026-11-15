/**
 * The office notice when a route correction is not applied to the group's
 * unfinished extra vehicles.
 *
 * The vehicle phrase is one plural message. Croatian therefore follows the
 * plural rule registered for `hr` (one / few / other). English keeps
 * vue-i18n's own rule, one vehicle against the rest.
 *
 * The pronoun is not that category. Exactly one vehicle is "njega" / "it".
 * Every other count, including 21 and 31, is "njih" / "them": those counts
 * are still the one category for the noun, and the pronoun is plural.
 */
export type GroupRouteLeftTranslate = (
  key: string,
  named?: Record<string, string | number>,
  choice?: number,
) => string

export function groupRouteLeftNotice(translate: GroupRouteLeftTranslate, count: number): string {
  const vehicle = translate('transfers.groupRouteLeftVehicle', { count }, count)
  const whom = translate(count === 1 ? 'transfers.groupRouteLeftIt' : 'transfers.groupRouteLeftThem')
  return translate('transfers.groupRouteLeft', { vehicle, whom })
}
