import type { InvoiceCreateRequest, InvoiceCreateResult, InvoiceStatusRead, InvoiceStornoResult, InvoicingPort, StornoDocument, ToolInvoice } from '../application/port'
import { z } from 'zod'
import { InvoicingKeyMissingError, InvoicingTokenDecryptError, InvoicingTokenMissingError } from '../domain/token-cipher'

/**
 * The current-tool adapter (Solo, ADR-0051, #442).
 * Contract tests drive it with the fixtures recorded on #436. Nothing here
 * calls Solo unless a caller passes a live `fetch` and a real token.
 */

/** One call is aborted after this long, inside the 120s create lease (#555). */
export const CURRENT_TOOL_TIMEOUT_MS = 30_000

/**
 * Solo returns status 100 when two creates are closer than this (#436).
 * The issue asks for the gap between creates. Reads are not delayed:
 * a lookup that waited on every detail could outlive the 120s create lease.
 * A read that still draws 100 fails the call, and the job tries again.
 */
export const CURRENT_TOOL_GAP_MS = 10_000

/** Documented origin. The token is sent only to this host over HTTPS. */
export const CURRENT_TOOL_ORIGIN = 'https://api.solo.com.hr'

/**
 * Service-type id on the account #436 used (Usluge → Tipovi usluga).
 * Solo requires a numeric id. It is not a per-Tenant setting yet.
 */
const SERVICE_TYPE_ID = '1'

/** R1. The response label is `R1`; the request sends this id (#436). */
const INVOICE_TYPE_R1 = '2'

/** Transakcijski račun. The response label differs; the request sends this id. */
const PAYMENT_TRANSACTION = '1'

/** Solo's list is the latest 1000, then `stranica` for the next thousand. */
const LIST_PAGE_SIZE = 1000
const LIST_PAGE_CAP = 5

const lastCallAt = new Map<string, number>()
const callTail = new Map<string, Promise<void>>()
let spacingSequence = 0

const toolFailure = 'The invoicing tool did not answer.'

const listRowSchema = z.object({
  id: z.string().min(1),
  broj_racuna: z.string().min(1),
  bruto_suma: z.string(),
  status: z.string(),
})

const racunSchema = z.object({
  id: z.string().min(1),
  broj_racuna: z.string().min(1),
  datum_racuna: z.string(),
  napomene: z.string(),
  pdf: z.string(),
  status: z.string(),
})

const envelopeSchema = z.object({
  status: z.number(),
  racun: racunSchema.optional(),
  racuni: z.array(listRowSchema).optional(),
})

type Envelope = z.infer<typeof envelopeSchema>
type Racun = z.infer<typeof racunSchema>

export interface CurrentToolOptions {
  readonly readToken: () => Promise<string>
  /** Defaults to the platform fetch. Tests pass a scripted one. */
  readonly fetch?: typeof fetch
  readonly now?: () => Date
  readonly sleep?: (ms: number) => Promise<void>
  /** Clamped to {@link CURRENT_TOOL_TIMEOUT_MS}. */
  readonly timeoutMs?: number
  /** Defaults to {@link CURRENT_TOOL_GAP_MS}. Tests that are not about the gap pass 0. */
  readonly gapMs?: number
  readonly spacingKey?: string
  readonly origin?: string
  /**
   * Test-only. A hanging server on 127.0.0.1 is not HTTPS. Production
   * leaves this unset, so the token never goes to an http URL.
   */
  readonly loopbackHttp?: boolean
}

/**
 * Net line price as Solo expects it. `cijena` is net (#436): sending
 * `1,02` at 25% came back as net 1,02, VAT 0,26, gross 1,28. The port's
 * amount is the gross Transfer price, so this divides it back.
 * Half-up on the cent. Only that one price was recorded.
 */
export function netPriceComma(gross: string, vatRate: number): string {
  const match = /^(\d+)\.(\d{2})$/.exec(gross)
  if (!match || vatRate < 0 || !Number.isInteger(vatRate))
    throw new Error('Invoice amount is not a two-decimal price.')
  const grossCents = Number(match[1]) * 100 + Number(match[2])
  const netCents = Math.round((grossCents * 100) / (100 + vatRate))
  const euros = Math.floor(netCents / 100)
  const cents = netCents % 100
  return `${euros},${String(cents).padStart(2, '0')}`
}

/** Solo dates are `DD.MM.YYYY`. Anything else is kept, so a placeholder still round-trips. */
export function soloIssuedOn(datum: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(datum)
  if (!match)
    return datum
  return `${match[3]}-${match[2]}-${match[1]}`
}

/**
 * Documented send statuses (Solo "Statusi"): 2 Pošalji, 3 Opomeni, 5 Plaćeno.
 * 1 is Otvori. 4 is the storno state #436 recorded, which is not sent.
 */
export function soloOfficeHasSent(status: string): boolean {
  return status === '2' || status === '3' || status === '5'
}

/**
 * `rok_placanja` on the request is an ISO date (Solo create docs).
 * The response `datum_racuna` is `DD.MM.YYYY`, which is a different field.
 * The recorded B2C create omitted the due date; the issue asks for due days.
 */
function dueOn(now: Date, dueDays: number): string {
  const date = new Date(now.getTime())
  date.setUTCDate(date.getUTCDate() + dueDays)
  return date.toISOString().slice(0, 10)
}

/**
 * B2B buyer fields from Solo's public create docs, not from the HITL.
 * The HITL sent `tip_kupca=1` and empty name, address, and OIB.
 * Docs: B2B is `tip_kupca=2`, and `kupac_naziv` / `kupac_oib` are required
 * for B2B; `kupac_adresa` is optional. `kpd_x` is documented as required
 * for B2B and was not recorded, so it is not sent.
 * EU (4) and INT (5) were not selected: the port's buyer is B2B.
 */
function createForm(request: InvoiceCreateRequest, now: Date): URLSearchParams {
  const form = new URLSearchParams()
  form.set('tip_usluge', SERVICE_TYPE_ID)
  form.set('tip_racuna', INVOICE_TYPE_R1)
  form.set('tip_kupca', '2')
  form.set('kupac_naziv', request.buyer.legalName)
  form.set('kupac_adresa', request.buyer.address)
  form.set('kupac_oib', request.buyer.oib ?? request.buyer.vatId ?? '')
  form.set('usluga', '1')
  form.set('opis_usluge_1', request.lineText)
  form.set('cijena_1', netPriceComma(request.grossAmount, request.vatRate))
  form.set('kolicina_1', '1')
  form.set('popust_1', '0')
  form.set('porez_stopa_1', String(request.vatRate))
  form.set('nacin_placanja', PAYMENT_TRANSACTION)
  form.set('rok_placanja', dueOn(now, request.dueDays))
  form.set('napomene', request.invoiceId)
  form.set('jezik_racuna', request.language === 'en' ? '2' : '1')
  return form
}

function httpsUrl(origin: string, path: string, loopbackHttp: boolean): URL {
  const url = new URL(path, origin)
  const loopback = loopbackHttp && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (url.protocol !== 'https:' && !loopback)
    throw new Error(toolFailure)
  return url
}

async function waitTurn(key: string, gapMs: number, now: () => Date, sleep: (ms: number) => Promise<void>): Promise<void> {
  const previous = callTail.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  callTail.set(key, tail)
  await previous
  try {
    const elapsed = now().getTime() - (lastCallAt.get(key) ?? Number.NEGATIVE_INFINITY)
    if (gapMs > 0 && elapsed < gapMs)
      await sleep(gapMs - elapsed)
    lastCallAt.set(key, now().getTime())
  }
  finally {
    release()
  }
}

type CallResult
  = { readonly kind: 'json', readonly body: Envelope }
    | { readonly kind: 'unanswered' }

async function callTool(
  options: Required<Pick<CurrentToolOptions, 'fetch' | 'now' | 'sleep' | 'origin' | 'loopbackHttp'>> & {
    readonly timeoutMs: number
    readonly gapMs: number
    readonly spacingKey: string
    readonly token: string
    readonly method: 'GET' | 'POST'
    readonly path: string
    readonly query?: Record<string, string>
    readonly form?: URLSearchParams
  },
): Promise<CallResult> {
  // The recorded limit is between creates. A storno and a read are not creates.
  if (options.method === 'POST' && options.path === '/racun')
    await waitTurn(options.spacingKey, options.gapMs, options.now, options.sleep)
  let url: URL
  try {
    url = httpsUrl(options.origin, options.path, options.loopbackHttp)
  }
  catch {
    return { kind: 'unanswered' }
  }
  const timeoutMs = Math.min(options.timeoutMs, CURRENT_TOOL_TIMEOUT_MS)
  try {
    const init: RequestInit = { method: options.method, signal: AbortSignal.timeout(timeoutMs) }
    if (options.method === 'GET') {
      url.searchParams.set('token', options.token)
      for (const [key, value] of Object.entries(options.query ?? {}))
        url.searchParams.set(key, value)
    }
    else {
      const form = options.form ?? new URLSearchParams()
      form.set('token', options.token)
      init.headers = { 'content-type': 'application/x-www-form-urlencoded' }
      init.body = form.toString()
    }
    const response = await options.fetch(url, init)
    const text = await response.text()
    const parsed = envelopeSchema.safeParse(JSON.parse(text))
    if (!parsed.success)
      return { kind: 'unanswered' }
    return { kind: 'json', body: parsed.data }
  }
  catch {
    // The fetch error can carry the URL, and the GET URL carries the token.
    return { kind: 'unanswered' }
  }
}

function documentOf(racun: Racun): ToolInvoice | null {
  if (!racun.pdf.startsWith('https://'))
    return null
  return {
    toolInvoiceId: racun.id,
    number: racun.broj_racuna,
    issuedOn: soloIssuedOn(racun.datum_racuna),
    documentLink: racun.pdf,
  }
}

/**
 * Tool status codes. Text from the tool is not returned: a message can
 * carry a name or an address. 100 is "wait", 101 the token, 102 the
 * monthly allowance. 130 is the fiscalization refusal #436 recorded.
 * Anything else the tool numbers is a refusal of the data.
 */
function createOutcome(body: Envelope): InvoiceCreateResult {
  if (body.status === 0) {
    if (!body.racun)
      return { kind: 'unknown' }
    const invoice = documentOf(body.racun)
    if (!invoice)
      return { kind: 'unknown' }
    return { kind: 'created', invoice }
  }
  if (body.status === 100)
    return { kind: 'transient' }
  if (body.status === 101)
    return { kind: 'refused', reason: 'token' }
  if (body.status === 102)
    return { kind: 'refused', reason: 'allowance' }
  return { kind: 'refused', reason: 'rejected' }
}

function stornoOutcome(body: Envelope): InvoiceStornoResult {
  if (body.status === 0)
    return { kind: 'accepted' }
  if (body.status === 101)
    return { kind: 'refused', reason: 'token' }
  if (body.status === 102)
    return { kind: 'refused', reason: 'allowance' }
  if (body.status === 100)
    return { kind: 'refused', reason: 'unavailable' }
  return { kind: 'refused', reason: 'rejected' }
}

type TokenRead = { readonly ok: true, readonly token: string } | { readonly ok: false }

async function readTokenOr(readToken: () => Promise<string>): Promise<TokenRead> {
  try {
    return { ok: true, token: await readToken() }
  }
  catch (error) {
    if (error instanceof InvoicingKeyMissingError || error instanceof InvoicingTokenDecryptError || error instanceof InvoicingTokenMissingError)
      return { ok: false }
    throw new Error(toolFailure)
  }
}

export function currentToolPort(options: CurrentToolOptions): InvoicingPort {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const timeoutMs = options.timeoutMs ?? CURRENT_TOOL_TIMEOUT_MS
  const gapMs = options.gapMs ?? CURRENT_TOOL_GAP_MS
  const spacingKey = options.spacingKey ?? `current-tool-${spacingSequence++}`
  const origin = options.origin ?? CURRENT_TOOL_ORIGIN
  const loopbackHttp = options.loopbackHttp === true
  const call = (token: string, method: 'GET' | 'POST', path: string, extra?: { query?: Record<string, string>, form?: URLSearchParams }) =>
    callTool({
      fetch: fetchImpl,
      now,
      sleep,
      origin,
      loopbackHttp,
      timeoutMs,
      gapMs,
      spacingKey,
      token,
      method,
      path,
      ...extra,
    })

  async function detail(token: string, id: string): Promise<Racun> {
    const result = await call(token, 'GET', '/racun', { query: { id } })
    // A miss is not "no such invoice": that would let a create run again.
    if (result.kind !== 'json' || result.body.status !== 0 || !result.body.racun)
      throw new Error(toolFailure)
    return result.body.racun
  }

  async function listPages(token: string): Promise<z.infer<typeof listRowSchema>[]> {
    const rows: z.infer<typeof listRowSchema>[] = []
    for (let page = 1; page <= LIST_PAGE_CAP; page++) {
      const result = await call(token, 'GET', '/racun', { query: { stranica: String(page) } })
      if (result.kind !== 'json')
        throw new Error(toolFailure)
      // 123 is Solo's "no invoice has been created". The list is empty.
      if (result.body.status === 123)
        return rows
      if (result.body.status !== 0)
        throw new Error(toolFailure)
      const pageRows = result.body.racuni ?? []
      rows.push(...pageRows)
      if (pageRows.length < LIST_PAGE_SIZE)
        break
    }
    return rows
  }

  async function findNegative(token: string, originalNumber: string): Promise<StornoDocument | null> {
    const note = `Storno računa ${originalNumber}`
    for (const row of await listPages(token)) {
      if (!row.bruto_suma.startsWith('-'))
        continue
      const racun = await detail(token, row.id)
      if (racun.napomene !== note)
        continue
      const invoice = documentOf(racun)
      if (!invoice)
        return null
      return {
        number: invoice.number,
        documentLink: invoice.documentLink,
        sent: soloOfficeHasSent(racun.status),
      }
    }
    return null
  }

  return {
    async create(request): Promise<InvoiceCreateResult> {
      const read = await readTokenOr(options.readToken)
      if (!read.ok)
        return { kind: 'refused', reason: 'token' }
      const result = await call(read.token, 'POST', '/racun', { form: createForm(request, now()) })
      if (result.kind !== 'json')
        return { kind: 'unknown' }
      return createOutcome(result.body)
    },

    async findByReference(invoiceId): Promise<ToolInvoice | null> {
      const read = await readTokenOr(options.readToken)
      if (!read.ok)
        throw new Error(toolFailure)
      for (const row of await listPages(read.token)) {
        const racun = await detail(read.token, row.id)
        if (racun.napomene !== invoiceId)
          continue
        return documentOf(racun)
      }
      return null
    },

    async readStatus(toolInvoiceId): Promise<InvoiceStatusRead> {
      const read = await readTokenOr(options.readToken)
      if (!read.ok)
        throw new Error(toolFailure)
      const racun = await detail(read.token, toolInvoiceId)
      const storno = await findNegative(read.token, racun.broj_racuna)
      return {
        sent: soloOfficeHasSent(racun.status),
        storno,
      }
    },

    async storno(toolInvoiceId): Promise<InvoiceStornoResult> {
      const read = await readTokenOr(options.readToken)
      if (!read.ok)
        return { kind: 'refused', reason: 'token' }
      const form = new URLSearchParams()
      form.set('id', toolInvoiceId)
      const result = await call(read.token, 'POST', '/storno', { form })
      if (result.kind !== 'json')
        return { kind: 'unknown' }
      return stornoOutcome(result.body)
    },

    async findStorno(toolInvoiceId): Promise<StornoDocument | null> {
      // A miss stays "not found". The storno job does not call the tool
      // again, and the status job reads it later (ADR-0051).
      try {
        const read = await readTokenOr(options.readToken)
        if (!read.ok)
          return null
        const racun = await detail(read.token, toolInvoiceId)
        return await findNegative(read.token, racun.broj_racuna)
      }
      catch (error) {
        if (error instanceof Error && error.message === toolFailure)
          return null
        throw error
      }
    },
  }
}
