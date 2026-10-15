/** The day list stores ids. The screen shows the name, never the id. */
export function driverDisplayName(
  drivers: readonly { id: string, name: string }[],
  id: string | null,
  unknownLabel: string,
): string {
  if (id === null)
    return ''
  return drivers.find(driver => driver.id === id)?.name ?? unknownLabel
}
