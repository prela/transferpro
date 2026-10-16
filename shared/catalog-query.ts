/**
 * Case-insensitive substring over the text already on a catalog row.
 * A blank query keeps every row. The list is the one the screen loaded;
 * this does not ask the server again (ADR-0038).
 */
export function catalogSearchMatches(query: string, fields: readonly string[]): boolean {
  const needle = query.trim().toLocaleLowerCase('hr')
  if (needle === '')
    return true
  return fields.some(field => field.toLocaleLowerCase('hr').includes(needle))
}
