import type { Locator, Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { inflateSync } from 'node:zlib'
import { instantFromWallClock } from '../shared/date'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, useTheme } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

/**
 * Issue #377. Under 1440 the Ride opens in the slideover, on a laptop and
 * on a phone. A menuitem can sit in the accessibility tree, and even be the
 * hit target, while its label is not painted. The ink in its screenshot is
 * the check that a person can see it. The click is the check that they can
 * use it.
 */

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const diagonal = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= diagonal)
    return left
  return upDistance <= diagonal ? up : upLeft
}

/** Spread of luminance in a PNG. Blank panel is a few units. Painted text is not. */
function luminanceSpread(png: Buffer): number {
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 2
  const data: Buffer[] = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const chunk = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0)
      height = chunk.readUInt32BE(4)
      colorType = chunk[9] ?? 2
    }
    if (type === 'IDAT')
      data.push(chunk)
    if (type === 'IEND')
      break
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  let min = 255
  let max = 0
  let cursor = 0
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++] ?? 0
    const row = Buffer.alloc(stride)
    for (let index = 0; index < stride; index++) {
      const sample = raw[cursor++] ?? 0
      const left = index >= channels ? row[index - channels] ?? 0 : 0
      const up = previous[index] ?? 0
      const upLeft = index >= channels ? previous[index - channels] ?? 0 : 0
      let value = sample
      if (filter === 1)
        value += left
      else if (filter === 2)
        value += up
      else if (filter === 3)
        value += Math.floor((left + up) / 2)
      else if (filter === 4)
        value += paeth(left, up, upLeft)
      row[index] = value & 255
    }
    previous = row
    for (let x = 0; x < width; x++) {
      const index = x * channels
      const luminance = Math.round(0.299 * (row[index] ?? 0) + 0.587 * (row[index + 1] ?? 0) + 0.114 * (row[index + 2] ?? 0))
      min = Math.min(min, luminance)
      max = Math.max(max, luminance)
    }
  }
  return max - min
}

/** Where the open item sits, and whether its own pixels contain ink. */
async function menuFacts(item: Locator): Promise<string> {
  const shot = await item.screenshot({ animations: 'disabled' })
  const spread = luminanceSpread(shot)
  const facts = await item.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const hit = document.elementFromPoint(x, y)
    const menu = el.closest('[role="menu"]')
    const dialog = document.querySelector('[role="dialog"]')
    return {
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      color: style.color,
      opacity: style.opacity,
      visibility: style.visibility,
      position: style.position,
      zIndex: style.zIndex,
      transform: style.transform,
      inDialog: Boolean(el.closest('[role="dialog"]')),
      menuState: menu?.getAttribute('data-state') ?? null,
      menuHidden: menu?.hasAttribute('hidden') ?? null,
      menuInert: Boolean(menu?.closest('[inert]')),
      dialogCount: document.querySelectorAll('[role="dialog"]').length,
      dialogAriaHidden: dialog?.getAttribute('aria-hidden') ?? null,
      hit: hit === null
        ? 'none'
        : `${hit.tagName} role=${hit.getAttribute('role') ?? ''} id=${hit.id}`,
      hitInsideItem: hit !== null && (hit === el || el.contains(hit)),
    }
  })
  const ink = spread >= 40 ? 'painted' : `unpainted spread=${spread}`
  return `${ink} ${JSON.stringify(facts)}`
}

async function openRidePanel(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  const tenant = await seedTenant(`panel-more-${width}`)
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const day = operationalDay(page)
  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Panel', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Panel', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Panel', kind: 'hotel' })
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: 'Ana Panel',
      price: 42.5,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
  await page.goto(`/transfers?day=${day}&ride=${rideId}`)
  await hydrated(page)
  await expect(page.getByRole('article').getByRole('heading', { name: 'Ana Panel' })).toBeVisible()
  await page.getByRole('button', { name: 'Više', exact: true }).click()
}

test('Više in the ride slideover shows a painted Ispravi transfer at laptop width', async ({ page }) => {
  await openRidePanel(page, 1280, 800)
  const item = page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true })
  await expect(item).toBeVisible()
  await expect.poll(() => menuFacts(item), { timeout: 5_000 }).toMatch(/^painted /)
})

test('Više in the ride panel shows a painted Ispravi transfer beside the table', async ({ page }) => {
  await openRidePanel(page, 1440, 900)
  const item = page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true })
  await expect(item).toBeVisible()
  await expect.poll(() => menuFacts(item), { timeout: 5_000 }).toMatch(/^painted /)
})
