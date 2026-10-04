import type { AuditFact, TenantSettings, TenantSettingsPatch } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { ianaTimeZoneSchema, storedTimeZoneSchema, waitMinutesSchema } from '../../../../shared'
import { appendAuditEntry } from '../../audit'

const settingsRows = z.object({
  rows: z.array(z.object({
    airport_wait_minutes: z.number().int(),
    elsewhere_wait_minutes: z.number().int(),
    time_zone: z.string(),
  })),
})

/** The session's row. The caller has already opened the tenant session. */
export async function loadTenantSettings(transaction: TenantTransaction): Promise<TenantSettings> {
  return readRow(transaction, false)
}

/**
 * Apply a patch and append one audit entry per field that changed, on this
 * transaction, so the row and the entries commit or roll back together.
 * A patch that matches the locked row does not update and does not append.
 * The caller has already required an admin.
 */
export async function changeTenantSettings(
  transaction: TenantTransaction,
  actorUserId: string,
  patch: TenantSettingsPatch,
): Promise<TenantSettings> {
  const current = await readRow(transaction, true)
  const facts = changedFacts(current, patch)
  if (facts.length === 0)
    return current

  // Waits are checked on every write. The zone is checked only when this
  // patch sets one, so a stored name that has left the runtime list does
  // not block a change to another field.
  const next: TenantSettings = {
    airportWaitMinutes: waitMinutesSchema.parse(patch.airportWaitMinutes ?? current.airportWaitMinutes),
    elsewhereWaitMinutes: waitMinutesSchema.parse(patch.elsewhereWaitMinutes ?? current.elsewhereWaitMinutes),
    timeZone: patch.timeZone === undefined ? current.timeZone : ianaTimeZoneSchema.parse(patch.timeZone),
  }
  await transaction.execute(sql`
    update app.tenant_settings
    set airport_wait_minutes = ${next.airportWaitMinutes},
        elsewhere_wait_minutes = ${next.elsewhereWaitMinutes},
        time_zone = ${next.timeZone}
  `)
  for (const fact of facts)
    await appendAuditEntry(transaction, { ...fact, actorUserId })
  return next
}

function changedFacts(current: TenantSettings, patch: TenantSettingsPatch): AuditFact[] {
  const facts: AuditFact[] = []
  if (patch.airportWaitMinutes !== undefined && patch.airportWaitMinutes !== current.airportWaitMinutes) {
    facts.push({
      action: 'settings.airport_wait_changed',
      subjectUserId: null,
      data: { from: current.airportWaitMinutes, to: patch.airportWaitMinutes },
    })
  }
  if (patch.elsewhereWaitMinutes !== undefined && patch.elsewhereWaitMinutes !== current.elsewhereWaitMinutes) {
    facts.push({
      action: 'settings.elsewhere_wait_changed',
      subjectUserId: null,
      data: { from: current.elsewhereWaitMinutes, to: patch.elsewhereWaitMinutes },
    })
  }
  if (patch.timeZone !== undefined && patch.timeZone !== current.timeZone) {
    facts.push({
      action: 'settings.time_zone_changed',
      subjectUserId: null,
      data: { from: current.timeZone, to: patch.timeZone },
    })
  }
  return facts
}

async function readRow(transaction: TenantTransaction, lock: boolean): Promise<TenantSettings> {
  const query = lock
    ? sql`
      select airport_wait_minutes, elsewhere_wait_minutes, time_zone
      from app.tenant_settings
      for update
    `
    : sql`
      select airport_wait_minutes, elsewhere_wait_minutes, time_zone
      from app.tenant_settings
    `
  const selected = settingsRows.parse(await transaction.execute(query))
  const row = selected.rows.length === 1 ? selected.rows[0] : undefined
  if (!row)
    throw new Error('Tenant settings are missing.')
  return {
    airportWaitMinutes: waitMinutesSchema.parse(row.airport_wait_minutes),
    elsewhereWaitMinutes: waitMinutesSchema.parse(row.elsewhere_wait_minutes),
    // Do not run the IANA check here. The name was valid when it was
    // stored; a later runtime list must not make the row unreadable.
    timeZone: storedTimeZoneSchema.parse(row.time_zone),
  }
}
