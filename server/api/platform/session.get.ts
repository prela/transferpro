import { defineEventHandler, toWebRequest } from 'h3'
import { readPlatformShell } from '../../modules/platform'
import { platformHttpError } from './http'

/** The platform shell. It does not open a tenant session and does not read tenant settings. */
export default defineEventHandler(async (event) => {
  try {
    return await readPlatformShell(toWebRequest(event).headers)
  }
  catch (error) {
    platformHttpError(error)
  }
})
