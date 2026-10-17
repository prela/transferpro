import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The e2e server appends each reset mail here. The verification row stores
 * a hash, and the link is not on a screen, so the spec reads the token
 * from this file. Playwright and the server must use the same path.
 */
export const e2ePasswordResetOutboxPath = join(tmpdir(), 'transferpro-e2e-password-reset.jsonl')
