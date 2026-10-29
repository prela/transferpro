import type { Buffer } from 'node:buffer'
import type { InvoicingSettings, InvoicingSettingsField, InvoicingSettingsSave } from '../../../../shared'
import type { InvoicingCiphertext } from '../domain/token-cipher'
import { invoicingSettingsChangedFields, invoicingSettingsSchema, StaleSaveError } from '../../../../shared'
import { decryptInvoicingToken, encryptInvoicingToken, InvoicingKeyMissingError, InvoicingTokenDecryptError } from '../domain/token-cipher'

/**
 * Save invoicing settings. The repository is the port: this tier does not
 * import Drizzle. A save that changes nothing returns the current view and
 * asks the repository to write nothing. The token value is not a field of
 * the audit plan.
 */

export interface StoredInvoicingSettings {
  readonly dueDays: number
  readonly vatRate: InvoicingSettings['vatRate']
  readonly lineText: string
  readonly version: number
  readonly ciphertext: Buffer | null
  readonly nonce: Buffer | null
  readonly tokenLastFour: string | null
}

export interface InvoicingSettingsWrite {
  readonly dueDays: number
  readonly vatRate: InvoicingSettings['vatRate']
  readonly lineText: string
  readonly version: number
  /** Null clears nothing: a token write replaces the blob. Absent keeps it. */
  readonly token: InvoicingCiphertext | null
  readonly tokenLastFour: string | null
}

/** What the save asks the database to do. `unchanged` appends no audit entry. */
export type InvoicingSettingsPlan
  = { readonly kind: 'unchanged', readonly view: InvoicingSettings }
    | { readonly kind: 'insert', readonly view: InvoicingSettings, readonly write: InvoicingSettingsWrite, readonly fields: readonly InvoicingSettingsField[] }
    | { readonly kind: 'update', readonly view: InvoicingSettings, readonly write: InvoicingSettingsWrite, readonly fields: readonly InvoicingSettingsField[] }

export interface InvoicingSettingsRepository {
  lock: () => Promise<StoredInvoicingSettings | null>
  insert: (write: InvoicingSettingsWrite) => Promise<void>
  /** False when the version no longer matches. Nothing else was written. */
  update: (write: InvoicingSettingsWrite, version: number) => Promise<boolean>
  audit: (fields: readonly InvoicingSettingsField[]) => Promise<void>
}

function viewOf(stored: StoredInvoicingSettings | null, fallback: InvoicingSettings): InvoicingSettings {
  if (!stored) {
    return invoicingSettingsSchema.parse(fallback)
  }
  return invoicingSettingsSchema.parse({
    dueDays: stored.dueDays,
    vatRate: stored.vatRate,
    lineText: stored.lineText,
    version: stored.version,
    tokenSet: stored.ciphertext !== null,
    tokenLastFour: stored.tokenLastFour,
  })
}

function tokenChanged(stored: StoredInvoicingSettings | null, token: string | undefined, key: Uint8Array | undefined, tenantId: string): boolean {
  if (token === undefined)
    return false
  if (!key)
    throw new InvoicingKeyMissingError()
  if (!stored?.ciphertext || !stored.nonce)
    return true
  try {
    return decryptInvoicingToken(stored.ciphertext, stored.nonce, key, tenantId) !== token
  }
  catch (error) {
    if (error instanceof InvoicingTokenDecryptError)
      return true
    throw error
  }
}

/**
 * Decide the write. A version that is not the stored one is 409, including
 * when the values would not change. The key is required only when a token
 * was typed.
 */
export function planInvoicingSettingsSave(
  stored: StoredInvoicingSettings | null,
  input: InvoicingSettingsSave,
  key: Uint8Array | undefined,
  tenantId: string,
  empty: InvoicingSettings,
): InvoicingSettingsPlan {
  const version = stored?.version ?? 0
  if (input.version !== version)
    throw new StaleSaveError()
  const changed = tokenChanged(stored, input.token, key, tenantId)
  const fields = invoicingSettingsChangedFields(
    stored ?? empty,
    input,
    changed,
  )
  if (fields.length === 0)
    return { kind: 'unchanged', view: viewOf(stored, empty) }
  if (changed && input.token !== undefined && !key)
    throw new InvoicingKeyMissingError()
  const sealed = changed && input.token !== undefined && key
    ? encryptInvoicingToken(input.token, key, tenantId)
    : null
  const tokenLastFour = changed && input.token !== undefined
    ? input.token.slice(-4)
    : stored?.tokenLastFour ?? null
  const nextVersion = (stored?.version ?? 0) + 1
  const write: InvoicingSettingsWrite = {
    dueDays: input.dueDays,
    vatRate: input.vatRate,
    lineText: input.lineText,
    version: nextVersion,
    token: sealed,
    tokenLastFour,
  }
  const view = invoicingSettingsSchema.parse({
    dueDays: write.dueDays,
    vatRate: write.vatRate,
    lineText: write.lineText,
    version: nextVersion,
    tokenSet: sealed !== null || (stored?.ciphertext !== null && stored !== null && !changed),
    tokenLastFour,
  })
  if (!stored)
    return { kind: 'insert', view, write, fields }
  return { kind: 'update', view, write, fields }
}

/**
 * Lock, plan, and write on the repository. A no-op does not call insert,
 * update, or audit.
 */
export async function saveInvoicingSettings(
  repository: InvoicingSettingsRepository,
  input: InvoicingSettingsSave,
  key: Uint8Array | undefined,
  tenantId: string,
  empty: InvoicingSettings,
): Promise<InvoicingSettings> {
  const stored = await repository.lock()
  const plan = planInvoicingSettingsSave(stored, input, key, tenantId, empty)
  if (plan.kind === 'unchanged')
    return plan.view
  if (plan.kind === 'insert') {
    await repository.insert(plan.write)
  }
  else if (!await repository.update(plan.write, input.version)) {
    throw new StaleSaveError()
  }
  await repository.audit(plan.fields)
  return plan.view
}
