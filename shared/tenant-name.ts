import { z } from 'zod'

/**
 * The display name `tenant:create` already accepts.
 * Trim, then 1 to 120 characters. The slug is a different field and is not edited here.
 */
export const TENANT_NAME_MAX_LENGTH = 120

export const tenantNameSchema = z.string().trim().min(1).max(TENANT_NAME_MAX_LENGTH)
