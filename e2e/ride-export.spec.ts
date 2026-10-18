import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, switchLocale, switchTheme } from './fixtures/ui'

const croatianHeader = 'Datum;Vrijeme;Polazište;Odredište;Naručitelj;Vozač;Registarska oznaka;Cijena;Plaćanje;Stanje'
const englishHeader = 'Date;Time;Pickup;Drop-off;Client;Driver;Registration plate;Price;Payment;Status'

test('the office downloads a Croatian ride CSV, in both themes, and an English smoke', async ({ page }) => {
  const tenant = await seedTenant('ride-export')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)

  await page.getByRole('link', { name: 'Transferi' }).click()
  await page.getByRole('button', { name: 'Izvoz CSV', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Izvoz CSV' })).toBeVisible()
  await expect(dialog.getByLabel('Od')).toBeVisible()
  await expect(dialog.getByLabel('Do')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await dialog.getByLabel('Do').press('Enter')
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^rides-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/)
  const bytes = readFileSync(await download.path())
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xEF, 0xBB, 0xBF]))
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '')
  expect(text.split('\r\n')[0]).toBe(croatianHeader)

  await switchTheme(page, 'dark')
  await page.getByRole('button', { name: 'Izvoz CSV', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Od')).toBeVisible()
  await expect(dialog.getByLabel('Do')).toBeVisible()
  await dialog.getByRole('button', { name: 'Zatvori', exact: true }).click()
  await expect(dialog).toBeHidden()
  await switchTheme(page, 'light')

  await switchLocale(page, 'en')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('From')).toBeVisible()
  await expect(dialog.getByLabel('To')).toBeVisible()
  const englishDownload = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  const english = await englishDownload
  const englishText = readFileSync(await english.path()).toString('utf8').replace(/^\uFEFF/, '')
  expect(englishText.split('\r\n')[0]).toBe(englishHeader)
})
