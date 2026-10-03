import { createError, defineEventHandler, readBody, toWebRequest } from 'h3'
import { LocaleChoiceError, saveDisplayLocale } from '../../shared'
import { TenantAccessError, updateUserLocale, withTenantFromSession } from '../modules/tenancy'

/**
 * The user chooses a locale. The column lives on the auth user.
 * A body other than hr or en never opens a session and never writes.
 */
export default defineEventHandler(async (event) => {
  try {
    const locale = await saveDisplayLocale(await readBody(event), async (choice) => {
      const headers = toWebRequest(event).headers
      await withTenantFromSession(headers, async () => {
        // Membership only. The write below uses the auth role, outside this transaction.
      })
      await updateUserLocale(headers, choice)
    })
    return { locale }
  }
  catch (error) {
    if (error instanceof LocaleChoiceError)
      throw createError({ statusCode: 400 })
    if (error instanceof TenantAccessError)
      throw createError({ statusCode: error.statusCode })
    throw error
  }
})
