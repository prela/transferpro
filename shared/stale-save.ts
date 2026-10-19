/**
 * Who last changed a Transfer, for the refusal after 409 `stale_save`.
 * ADR-0046 keeps the name off the error body. The day read joins it, and a
 * member who has left leaves that name null while the time stays. A row that
 * has not been changed since the column arrived has neither. A name without
 * a time cannot fill "u {vrijeme}", so it uses the same sentence.
 */
export type StaleSaveNotice
  = { kind: 'named', name: string, at: string }
    | { kind: 'former', at: string }
    | { kind: 'unknown' }

export function staleSaveNotice(changedByName: string | null, changedAt: string | null): StaleSaveNotice {
  const name = changedByName?.trim() ?? ''
  if (changedAt !== null && name !== '')
    return { kind: 'named', name, at: changedAt }
  if (changedAt !== null)
    return { kind: 'former', at: changedAt }
  return { kind: 'unknown' }
}
