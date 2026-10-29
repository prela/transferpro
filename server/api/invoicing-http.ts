import { createError } from 'h3'
import { InvoicingSettingsInputError, StaleSaveError } from '../../shared'
import { InvoicingKeyMissingError } from '../modules/invoicing'
import { TenantAccessError } from '../modules/tenancy'
import { rethrowTenantChanged } from './tenant-changed'

/**
 * Turn an invoicing-settings failure into an HTTP error. The message stays
 * a fixed phrase for the status. `stale_save` is a version the form no
 * longer holds. Nothing was written. The token is not on the body.
 */
export function invoicingHttpError(error: unknown): never {
  rethrowTenantChanged(error)
  if (error instanceof InvoicingSettingsInputError || error instanceof TenantAccessError || error instanceof InvoicingKeyMissingError)
    throw createError({ statusCode: error.statusCode })
  if (error instanceof StaleSaveError)
    throw createError({ statusCode: error.statusCode, data: { code: error.code } })
  throw error
}
