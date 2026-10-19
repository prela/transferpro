/**
 * The form's version is not the stored one. Nothing is written and no audit
 * entry is appended. The body stays the ADR-0012 shape: this name is not a
 * person's name. ADR-0046. Shared so Transfers and Clients throw the same
 * error without Clients importing Transfers (ADR-0018).
 */
export class StaleSaveError extends Error {
  readonly statusCode = 409
  readonly code = 'stale_save'

  constructor() {
    super('Conflict')
    this.name = 'StaleSaveError'
  }
}

/**
 * Who last changed a Transfer or a Client, for the refusal after 409 `stale_save`.
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
