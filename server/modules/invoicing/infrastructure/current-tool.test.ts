import type { InvoiceCreateRequest } from '../application/port'
import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { InvoicingTokenMissingError } from '../domain/token-cipher'
import { CURRENT_TOOL_GAP_MS, CURRENT_TOOL_TIMEOUT_MS, currentToolPort, netPriceComma, soloIssuedOn, soloOfficeHasSent } from './current-tool'
import { SOLO_BROJ, SOLO_CREATE_RESPONSE, SOLO_DETAIL_RESPONSE, SOLO_INVOICE_ID, SOLO_LIST_AFTER_CREATE, SOLO_LIST_AFTER_STORNO, SOLO_OUR_REF, SOLO_STATUS_130, SOLO_STORNO_BROJ, SOLO_STORNO_DETAIL, SOLO_STORNO_ID, SOLO_STORNO_RESPONSE } from './current-tool-fixtures'

/**
 * Contract against the #436 fixtures. The scripted fetch never leaves
 * the process. The placeholder below is not a Solo token.
 */

const secret = 'placeholder-secret'
const invoiceId = '33333333-3333-4333-8333-333333333333'

function request(over: Partial<InvoiceCreateRequest> = {}): InvoiceCreateRequest {
  return {
    invoiceId,
    clientId: '22222222-2222-4222-8222-222222222222',
    lineText: '{{LINE_DESC}}',
    language: 'en',
    dueDays: 15,
    vatRate: 25,
    grossAmount: '1.28',
    quantity: 1,
    buyerType: 'b2b',
    buyer: {
      legalName: 'buyer-placeholder',
      country: 'HR',
      oib: null,
      vatId: 'tax-placeholder',
      address: 'address-placeholder',
    },
    ...over,
  }
}

function clock() {
  let nowMs = Date.parse('2026-11-06T12:00:00.000Z')
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => new Date(nowMs),
    sleep: async (ms: number) => {
      sleeps.push(ms)
      nowMs += ms
    },
  }
}

function scripted(pages: unknown[]) {
  const calls: { url: string, body: string }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : '' })
    const page = pages.shift()
    if (page === undefined)
      throw new Error('unexpected invoicing call')
    return new Response(JSON.stringify(page), { status: 200 })
  }
  return { fetchImpl, calls }
}

function portFor(pages: unknown[], gapMs = 0) {
  const time = clock()
  const script = scripted(pages)
  const port = currentToolPort({
    readToken: async () => secret,
    fetch: script.fetchImpl,
    now: time.now,
    sleep: time.sleep,
    gapMs,
    origin: 'https://api.solo.com.hr',
  })
  return { port, ...script, ...time }
}

it('converts the recorded gross price to the net Solo accepted', () => {
  expect(netPriceComma('1.28', 25)).toBe('1,02')
  expect(soloIssuedOn('01.08.2016. 13:00')).toBe('2016-08-01')
  expect(soloOfficeHasSent('1')).toBe(false)
  expect(soloOfficeHasSent('4')).toBe(false)
  expect(soloOfficeHasSent('2')).toBe(true)
  expect(CURRENT_TOOL_TIMEOUT_MS).toBe(30_000)
  expect(CURRENT_TOOL_GAP_MS).toBe(10_000)
})

it('creates from the recorded response and sends the gross price as net', async () => {
  const { port, calls } = portFor([SOLO_CREATE_RESPONSE])
  const result = await port.create(request())
  expect(result).toEqual({
    kind: 'created',
    invoice: {
      toolInvoiceId: SOLO_INVOICE_ID,
      number: SOLO_BROJ,
      issuedOn: '{{DATUM_RACUNA}}',
      documentLink: `https://solo.com.hr/download/${SOLO_INVOICE_ID}`,
    },
  })
  expect(calls).toHaveLength(1)
  const url = new URL(calls[0]!.url)
  expect(url.origin).toBe('https://api.solo.com.hr')
  expect(url.pathname).toBe('/racun')
  expect(url.search).toBe('')
  expect(calls[0]!.url).not.toContain(secret)
  const form = new URLSearchParams(calls[0]!.body)
  // Recorded B2C create, plus the documented B2B fields the HITL did not send.
  expect(form.get('tip_usluge')).toBe('1')
  expect(form.get('tip_racuna')).toBe('2')
  expect(form.get('usluga')).toBe('1')
  expect(form.get('opis_usluge_1')).toBe('{{LINE_DESC}}')
  expect(form.get('cijena_1')).toBe('1,02')
  expect(form.get('kolicina_1')).toBe('1')
  expect(form.get('popust_1')).toBe('0')
  expect(form.get('porez_stopa_1')).toBe('25')
  expect(form.get('nacin_placanja')).toBe('1')
  expect(form.get('napomene')).toBe(invoiceId)
  expect(form.get('tip_kupca')).toBe('2')
  expect(form.get('kupac_naziv')).toBe('buyer-placeholder')
  expect(form.get('kupac_oib')).toBe('tax-placeholder')
  expect(form.get('kupac_adresa')).toBe('address-placeholder')
  expect(form.get('jezik_racuna')).toBe('2')
  expect(form.get('rok_placanja')).toBe('2026-11-21')
  expect(form.get('kpd_1')).toBeNull()
  expect(form.get('token')).toBe(secret)
  expect(JSON.stringify(result)).not.toContain(secret)
  expect(JSON.stringify(result)).not.toContain('Račun uspješno')
})

it('maps the recorded fiscalization refusal and the documented token and allowance codes, without the tool text', async () => {
  const refused = portFor([SOLO_STATUS_130])
  const rejected = await refused.port.create(request())
  expect(rejected).toEqual({ kind: 'refused', reason: 'rejected' })
  expect(JSON.stringify(rejected)).not.toContain('certifikat')
  expect(JSON.stringify(rejected)).not.toContain('Fiskalizacija')

  const token = portFor([{ status: 101, message: 'Neispravan token.' }])
  const tokenResult = await token.port.create(request())
  expect(tokenResult).toEqual({ kind: 'refused', reason: 'token' })
  expect(JSON.stringify(tokenResult)).not.toContain('Neispravan')

  const allowance = portFor([{ status: 102, message: 'Dosegnut mjesečni limit licence.' }])
  expect(await allowance.port.create(request())).toEqual({ kind: 'refused', reason: 'allowance' })

  const wait = portFor([{ status: 100, message: 'Pričekaj barem 10 sekundi prije slanja novog zahtjeva.' }])
  expect(await wait.port.create(request())).toEqual({ kind: 'transient' })
  expect(JSON.stringify(await portFor([{ status: 100, message: 'Pričekaj.' }]).port.create(request()))).not.toContain('Pričekaj')
})

it('finds an invoice by the note on the detail, not by the list', async () => {
  const { port, calls } = portFor([SOLO_LIST_AFTER_CREATE, SOLO_DETAIL_RESPONSE])
  const found = await port.findByReference(SOLO_OUR_REF)
  expect(found).toEqual({
    toolInvoiceId: SOLO_INVOICE_ID,
    number: SOLO_BROJ,
    issuedOn: '{{DATUM_RACUNA}}',
    documentLink: `https://solo.com.hr/download/${SOLO_INVOICE_ID}`,
  })
  expect(calls[0]!.url).toContain('/racun')
  expect(calls[0]!.url).toContain('stranica=1')
  expect(calls[0]!.url).not.toContain('napomene')
  expect(calls[1]!.url).toContain(`id=${encodeURIComponent(SOLO_INVOICE_ID)}`)
  const missed = portFor([SOLO_LIST_AFTER_CREATE, SOLO_DETAIL_RESPONSE])
  expect(await missed.port.findByReference('other-ref')).toBeNull()
})

it('reads an unsent invoice from the recorded detail', async () => {
  const { port } = portFor([SOLO_DETAIL_RESPONSE, SOLO_LIST_AFTER_CREATE])
  expect(await port.readStatus(SOLO_INVOICE_ID)).toEqual({ sent: false, storno: null })
  const sent = portFor([{
    ...SOLO_DETAIL_RESPONSE,
    racun: { ...SOLO_DETAIL_RESPONSE.racun, status: '2' },
  }, SOLO_LIST_AFTER_CREATE])
  expect(await sent.port.readStatus(SOLO_INVOICE_ID)).toEqual({ sent: true, storno: null })
})

it('accepts the recorded storno, which has no new id, and finds the negative invoice by its note', async () => {
  const storno = portFor([SOLO_STORNO_RESPONSE])
  const accepted = await storno.port.storno(SOLO_INVOICE_ID)
  expect(accepted).toEqual({ kind: 'accepted' })
  expect(JSON.stringify(accepted)).not.toContain('arhiv')
  const form = new URLSearchParams(storno.calls[0]!.body)
  expect(form.get('id')).toBe(SOLO_INVOICE_ID)
  expect(storno.calls[0]!.url).toContain('/storno')
  expect(storno.calls[0]!.url).not.toContain(secret)

  const found = portFor([SOLO_DETAIL_RESPONSE, SOLO_LIST_AFTER_STORNO, SOLO_STORNO_DETAIL])
  expect(await found.port.findStorno(SOLO_INVOICE_ID)).toEqual({
    number: SOLO_STORNO_BROJ,
    documentLink: `https://solo.com.hr/download/${SOLO_STORNO_ID}`,
    sent: false,
  })

  const status = portFor([
    { ...SOLO_DETAIL_RESPONSE, racun: { ...SOLO_DETAIL_RESPONSE.racun, status: '4' } },
    SOLO_LIST_AFTER_STORNO,
    SOLO_STORNO_DETAIL,
  ])
  expect(await status.port.readStatus(SOLO_INVOICE_ID)).toEqual({
    sent: false,
    storno: {
      number: SOLO_STORNO_BROJ,
      documentLink: `https://solo.com.hr/download/${SOLO_STORNO_ID}`,
      sent: false,
    },
  })
})

it('waits ten seconds between calls to the tool', async () => {
  const time = clock()
  const script = scripted([SOLO_CREATE_RESPONSE, SOLO_CREATE_RESPONSE])
  const port = currentToolPort({
    readToken: async () => secret,
    fetch: script.fetchImpl,
    now: time.now,
    sleep: time.sleep,
    spacingKey: 'gap',
  })
  await port.create(request())
  await port.create(request())
  expect(time.sleeps).toEqual([CURRENT_TOOL_GAP_MS])
})

it('does not call the tool when the token cannot be read, and does not return it', async () => {
  const script = scripted([])
  const port = currentToolPort({
    readToken: async () => {
      throw new InvoicingTokenMissingError()
    },
    fetch: script.fetchImpl,
    gapMs: 0,
  })
  const result = await port.create(request())
  expect(result).toEqual({ kind: 'refused', reason: 'token' })
  expect(script.calls).toEqual([])
  expect(JSON.stringify(result)).not.toContain(secret)
})

it('aborts a hanging call within the timeout and does not keep the token on the error', async () => {
  const server = createServer(() => {
    // Never answers. The client must abort.
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('hanging server has no port')
  try {
    const port = currentToolPort({
      readToken: async () => secret,
      now: () => new Date('2026-11-06T12:00:00.000Z'),
      sleep: async () => {},
      gapMs: 0,
      timeoutMs: 50,
      origin: `http://127.0.0.1:${address.port}`,
      loopbackHttp: true,
    })
    const started = Date.now()
    const result = await port.create(request())
    expect(result).toEqual({ kind: 'unknown' })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(JSON.stringify(result)).not.toContain(secret)
  }
  finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
})

it('refuses an http origin that is not the test loopback, and does not send the token', async () => {
  const script = scripted([])
  const port = currentToolPort({
    readToken: async () => secret,
    fetch: script.fetchImpl,
    gapMs: 0,
    origin: 'http://api.solo.com.hr',
  })
  expect(await port.create(request())).toEqual({ kind: 'unknown' })
  expect(script.calls).toEqual([])
})
