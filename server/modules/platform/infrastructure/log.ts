import type { Logger } from '../../../core/index'

/**
 * One line per platform route call.
 * `userId` is the kept opaque id. `targetTenantId` is not `tenant_id`:
 * the logger drops `tenant_id` from a payload because that key is the
 * tenant-session scope, and a platform call does not open one.
 * Names, emails, and the request body are not fields of this line.
 */
export interface PlatformLogEvent {
  readonly userId: string | null
  readonly action: 'platform.session' | 'platform.tenants.list' | 'platform.tenants.open' | 'platform.tenants.rename'
  readonly targetTenantId: string | null
  readonly outcome: 'ok' | 'unauthorized' | 'forbidden' | 'bad_request' | 'not_found' | 'error'
}

export function writePlatformLog(logger: Logger, event: PlatformLogEvent): void {
  const line = {
    userId: event.userId,
    action: event.action,
    targetTenantId: event.targetTenantId,
    outcome: event.outcome,
  }
  if (event.outcome === 'error')
    logger.error(line, 'platform')
  else
    logger.info(line, 'platform')
}
