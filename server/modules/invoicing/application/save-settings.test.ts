import type { InvoicingSettingsSave } from '../../../../shared'
import { expect, it } from 'vitest'
import { EMPTY_INVOICING_SETTINGS, StaleSaveError } from '../../../../shared'
import { saveInvoicingSettings } from './save-settings'

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const token = 'current-tool-token-9911'
const key = new Uint8Array(32).fill(9)

function input(patch: Partial<InvoicingSettingsSave> = {}): InvoicingSettingsSave {
  return {
    dueDays: 15,
    vatRate: 25,
    lineText: 'Transfer',
    version: 0,
    ...patch,
  }
}

it('appends nothing when the save matches the defaults and sets no token', async () => {
  const audits: unknown[] = []
  const writes: string[] = []
  const view = await saveInvoicingSettings({
    lock: async () => null,
    insert: async () => {
      writes.push('insert')
    },
    update: async () => {
      writes.push('update')
      return true
    },
    audit: async (fields) => {
      audits.push(fields)
    },
  }, input(), key, tenantId, EMPTY_INVOICING_SETTINGS)
  expect(view).toEqual(EMPTY_INVOICING_SETTINGS)
  expect(writes).toEqual([])
  expect(audits).toEqual([])
})

it('records the field name token and not the token value', async () => {
  const audits: unknown[] = []
  const view = await saveInvoicingSettings({
    lock: async () => null,
    insert: async () => {},
    update: async () => true,
    audit: async (fields) => {
      audits.push(fields)
    },
  }, input({ dueDays: 10, token }), key, tenantId, EMPTY_INVOICING_SETTINGS)
  expect(view.tokenSet).toBe(true)
  expect(view.tokenLastFour).toBe('9911')
  expect(view.dueDays).toBe(10)
  expect(audits).toEqual([['dueDays', 'token']])
  expect(JSON.stringify(audits)).not.toContain(token)
  expect(JSON.stringify(view)).not.toContain(token)
})

it('refuses a version that is not the stored one and writes nothing', async () => {
  const writes: string[] = []
  await expect(saveInvoicingSettings({
    lock: async () => ({
      dueDays: 15,
      vatRate: 25,
      lineText: 'Transfer',
      version: 2,
      ciphertext: null,
      nonce: null,
      tokenLastFour: null,
    }),
    insert: async () => {
      writes.push('insert')
    },
    update: async () => {
      writes.push('update')
      return true
    },
    audit: async () => {
      writes.push('audit')
    },
  }, input({ version: 1, dueDays: 3 }), key, tenantId, EMPTY_INVOICING_SETTINGS)).rejects.toBeInstanceOf(StaleSaveError)
  expect(writes).toEqual([])
})
