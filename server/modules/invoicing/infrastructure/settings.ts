import type { InvoicingSettings, InvoicingSettingsField, InvoicingSettingsSave } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import type { InvoicingSettingsRepository } from '../application/save-settings'
import { Buffer } from 'node:buffer'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { EMPTY_INVOICING_SETTINGS, invoicingSettingsSchema, invoicingVatRateSchema, StaleSaveError } from '../../../../shared'
import { hideDatabaseError, postgresErrorCode } from '../../../core'
import { appendAuditEntry } from '../../audit'
import { TenantAccessError } from '../../tenancy'
import { saveInvoicingSettings } from '../application/save-settings'
import { InvoicingKeyMissingError, InvoicingTokenDecryptError } from '../domain/token-cipher'

/**
 * The one invoicing-settings row for the session's Tenant.
 * Ciphertext and nonce are read as base64 so a driver buffer shape cannot
 * change the decrypt. The plaintext token is not a column and is not selected.
 */

const storedRow = z.object({
  due_days: z.number().int(),
  vat_rate: invoicingVatRateSchema,
  line_text: z.string(),
  version: z.number().int(),
  token_ciphertext: z.string().nullable(),
  token_nonce: z.string().nullable(),
  token_last_four: z.string().nullable(),
})

const storedRows = z.object({ rows: z.array(storedRow) })

const claimedRows = z.object({ rows: z.array(z.object({ version: z.number() })) })

const selectColumns = `
  select due_days, vat_rate, line_text, version,
    encode(token_ciphertext, 'base64') as token_ciphertext,
    encode(token_nonce, 'base64') as token_nonce,
    token_last_four
  from app.invoicing_settings
`

function toStored(row: z.infer<typeof storedRow> | undefined) {
  if (!row)
    return null
  return {
    dueDays: row.due_days,
    vatRate: row.vat_rate,
    lineText: row.line_text,
    version: row.version,
    ciphertext: row.token_ciphertext === null ? null : Buffer.from(row.token_ciphertext, 'base64'),
    nonce: row.token_nonce === null ? null : Buffer.from(row.token_nonce, 'base64'),
    tokenLastFour: row.token_last_four,
  }
}

function viewFromStored(stored: ReturnType<typeof toStored>): InvoicingSettings {
  if (!stored)
    return EMPTY_INVOICING_SETTINGS
  return invoicingSettingsSchema.parse({
    dueDays: stored.dueDays,
    vatRate: stored.vatRate,
    lineText: stored.lineText,
    version: stored.version,
    tokenSet: stored.ciphertext !== null,
    tokenLastFour: stored.tokenLastFour,
  })
}

/**
 * Due days, the VAT rate, the line text, and whether a token is set.
 * A Driver is 403 before the row is read. The ciphertext is not returned.
 */
export async function readInvoicingReadiness(transaction: TenantTransaction, role: string): Promise<{
  tokenSet: boolean
  dueDays: number
  vatRate: InvoicingSettings['vatRate']
  lineText: string
}> {
  if (role !== 'admin' && role !== 'dispatcher')
    throw new TenantAccessError(403)
  const view = await loadInvoicingSettings(transaction)
  return {
    tokenSet: view.tokenSet,
    dueDays: view.dueDays,
    vatRate: view.vatRate,
    lineText: view.lineText,
  }
}

/** The session's row, or the defaults when the Tenant has not saved yet. */
export async function loadInvoicingSettings(transaction: TenantTransaction): Promise<InvoicingSettings> {
  const selected = storedRows.parse(await transaction.execute(sql.raw(selectColumns)))
  return viewFromStored(toStored(selected.rows[0]))
}

function keepPassThrough(error: unknown): boolean {
  return error instanceof StaleSaveError
    || error instanceof InvoicingKeyMissingError
    || error instanceof InvoicingTokenDecryptError
}

function repository(transaction: TenantTransaction, actorUserId: string): InvoicingSettingsRepository {
  return {
    async lock() {
      const selected = storedRows.parse(await transaction.execute(sql.raw(`${selectColumns} for update`)))
      return toStored(selected.rows[0])
    },
    async insert(write) {
      if (write.token) {
        const ciphertext = write.token.ciphertext.toString('base64')
        const nonce = write.token.nonce.toString('base64')
        await transaction.execute(sql`
          insert into app.invoicing_settings (
            due_days, vat_rate, line_text, version, token_ciphertext, token_nonce, token_last_four
          )
          values (
            ${write.dueDays}, ${write.vatRate}, ${write.lineText}, ${write.version},
            decode(${ciphertext}, 'base64'), decode(${nonce}, 'base64'), ${write.tokenLastFour}
          )
        `)
        return
      }
      await transaction.execute(sql`
        insert into app.invoicing_settings (due_days, vat_rate, line_text, version)
        values (${write.dueDays}, ${write.vatRate}, ${write.lineText}, ${write.version})
      `)
    },
    async update(write, version) {
      const claimed = write.token
        ? await transaction.execute(sql`
          update app.invoicing_settings
          set due_days = ${write.dueDays},
              vat_rate = ${write.vatRate},
              line_text = ${write.lineText},
              version = ${write.version},
              token_ciphertext = decode(${write.token.ciphertext.toString('base64')}, 'base64'),
              token_nonce = decode(${write.token.nonce.toString('base64')}, 'base64'),
              token_last_four = ${write.tokenLastFour}
          where version = ${version}
          returning version
        `)
        : await transaction.execute(sql`
          update app.invoicing_settings
          set due_days = ${write.dueDays},
              vat_rate = ${write.vatRate},
              line_text = ${write.lineText},
              version = ${write.version}
          where version = ${version}
          returning version
        `)
      return claimedRows.parse(claimed).rows.length === 1
    },
    async audit(fields: readonly InvoicingSettingsField[]) {
      await appendAuditEntry(transaction, {
        action: 'invoicing_settings.changed',
        actorUserId,
        subjectUserId: null,
        data: { fields: [...fields] },
      })
    },
  }
}

/**
 * Apply one save. The caller has already required an admin. A no-op does
 * not update and does not append. A second first insert is 409 `stale_save`.
 * Bound values stay out of the failure log.
 */
export async function changeInvoicingSettings(
  transaction: TenantTransaction,
  actorUserId: string,
  tenantId: string,
  input: InvoicingSettingsSave,
  key: Uint8Array | undefined,
): Promise<InvoicingSettings> {
  return hideDatabaseError(async () => {
    try {
      return await saveInvoicingSettings(
        repository(transaction, actorUserId),
        input,
        key,
        tenantId,
        EMPTY_INVOICING_SETTINGS,
      )
    }
    catch (error) {
      if (postgresErrorCode(error) === '23505')
        throw new StaleSaveError()
      throw error
    }
  }, 'Invoicing settings save failed', { passthrough: keepPassThrough })
}
