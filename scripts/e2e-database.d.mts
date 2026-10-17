export const E2E_DATABASE_NAME: string
export const E2E_APP_DATABASE_ENV: readonly string[]

export function e2eDatabaseUrl(raw: string): string
export function applyE2eDatabaseEnv(env: NodeJS.ProcessEnv): void
export function assertE2eDatabaseEnv(env: NodeJS.ProcessEnv, names?: readonly string[]): void
export function e2eAdminLogin(env: NodeJS.ProcessEnv): { user: string, password: string }
