# Invoices through the current tool in v1

Status: accepted; partially superseded by ADR-0053

Damir accepted this on 22 October 2026, in the step 27 grill of #206. It decides how ADR-0033's invoice through a provider is issued in v1, and the billing-details fields ADR-0049 left to this step. It partially supersedes ADR-0015, ADR-0036, and ADR-0039; the sentences are named below. ADR-0007, ADR-0020, ADR-0033, and ADR-0035 stand. The finding behind it is `docs/research/225-croatian-invoicing-duties.md` (#225).

## Context

ADR-0033 brings one invoice per Transfer into v1: to the Transfer's Client, only when the payment is `invoice_to_agency` and the Ride is done, through a provider's API, in its own module. ADR-0036 gives `invoicing` the invoices, the port, and the secrets, and keeps it ignorant of Transfers: transfers checks that a Transfer may be invoiced and sends a request with the Client id, the lines, and the Transfer's id as an opaque reference unique per Tenant.

The finding shows what Croatian law asks. An invoice to a Croatian agency or hotel from an issuer in the VAT register has been a structured eRačun since 1.1.2026, fiscalized when it is issued, through a certified information intermediary. The issuer reports the payments it received by the 20th of the next month. A foreign agency gets an ordinary invoice, still with 25% Croatian VAT. A Croatian individual paying by bank transfer needs a B2C fiscalized invoice signed with the Tenant's own certificate. An issued invoice is never changed; a storno cancels it.

The first Tenant already issues its agency invoices in an invoicing tool of its own. This record calls it the current tool. The current tool has an API with one token per account, and one account is one business premises. A create takes a B2B buyer, a VAT rate, due days, a language, and free notes, with the buyer's address as one text. The tool assigns the invoice number and date. A create returns an id, the number, and a document link. It has no field for our reference and no protection against a duplicate. Sending a domestic eRačun, which is when it is fiscalized, and reporting a payment are only a click in the tool's web app. The API cannot email an invoice. Status is read by id, with no webhook and a small hourly allowance of reads. Creates must be at least 10 seconds apart, and an account has a monthly allowance of API invoices. A storno through the API creates a negative invoice and returns no id. There is no sandbox.

The alternatives were a certified intermediary behind the port, with Transferpro building the CIUS-HR UBL itself; a provider that builds the UBL from JSON; Transferpro generating the PDF for a foreign agency; numbering the invoices ourselves; a storno only in the tool's web app; and payment reporting from Transferpro. An intermediary is the complete route, but the first Tenant would run two invoicing channels beside each other, and the build is larger than the pilot can carry. The current tool keeps the Tenant's fiscal identity, numbering, archive, and sending where they already are, at the cost of a click in its web app for each domestic invoice.

## Decision

### The current tool behind the invoicing port

In v1 the invoicing port has one real adapter, for the current tool, and a fake for tests and E2E. The current tool is the fiscalization provider of ADR-0033. It owns the Tenant's fiscal identity, the number series, the issue date, fiscalization, sending, and the archive. Transferpro holds no issuer data: no OIB, IBAN, premises mark, device mark, or operator. Domain and application code know the port only.

`INVOICING` in env selects `none` or the adapter, and the default is `none`. With `none`, no invoice is issued and no call leaves the server. Tests and E2E never call the current tool.

### What may be invoiced

The office issues an invoice by hand, one done Transfer at a time, with "Izdaj račun" on the Ride detail. An Admin or a Dispatcher may issue; a Driver gets 403. A Transfer may be invoiced when its payment is `invoice_to_agency` and its Ride is done, including a handed-off Ride the office closed as done. A No-show and a cancelled Ride are never invoiced. Correcting the payment to `invoice_to_agency` before the invoice is issued makes the Transfer invoiceable.

The Client must be an agency or a hotel, Croatian or foreign, with complete billing details. An individual Client is refused in v1. A refusal writes and sends nothing.

The Transfer's price is the gross amount the Client pays, VAT included, at the VAT rate of the invoicing settings, 25 to start. The invoice total equals the Transfer price. Step 24 inherits that meaning for the price list, and the step 26 price snapshot keeps it, so invoicing does not wait on step 26.

While a Transfer has an invoice that is requested, created, sent, or being cancelled, a Transfer correction that changes its Client, its price, or its payment is refused with 409 `transfer_invoiced`. Its other fields stay editable. A failed invoice does not hold those three fields, so the office can correct the cause before Pokušaj ponovno; otherwise only a storno frees them.

### Billing details

Billing details are the one-row-per-Client child table of `clients` that ADR-0049 reserved. They hold the legal name, the country, the OIB (required when the country is Croatia), an optional VAT id, the address as one text, and "Ime gosta na računu", a checkbox that starts off. They carry their own ADR-0046 version, separate from the Client's. The office edits them in a "Podaci za račun" tab of the Client card. Issuing without complete billing details is refused with 409 `billing_details_missing`, linking to the Client card.

An OIB may belong to a sole trader, so billing details are treated as personal data. They never enter an audit entry, a log line, a job payload, or the error tracker.

### The request and the line

The request holds one line, quantity 1, at the Transfer price and the Tenant's VAT rate, for a B2B buyer, with the Tenant's due days. The line text is the Tenant's line text, the start and end Location names, the pickup date in the Tenant's time zone, the Client reference when there is one, and the guest name only when the Client's billing details ask for it. The guest name goes on that line and nowhere else. A Croatian Client gets the invoice in Croatian, any other Client in English. The notes carry our reference, which is the invoice's id.

### Issuing safely

Pressing "Izdaj račun" stores the invoice as requested and enqueues a job with the invoice id in the same transaction (ADR-0035). The invoice keeps the Transfer's id as ADR-0036's opaque Transfer reference. One Transfer has at most one invoice that is not cancelled or withdrawn, enforced by a partial unique key on the Tenant and the Transfer reference, so a repeated request returns that invoice. Our reference, which the current tool sees, is the invoice's id.

The job writes the attempt to Postgres before it calls the current tool. Each Tenant has at most one create in flight, and creates are at least 10 seconds apart. A success stores the tool's id, the number, the issue date, and the document link, and the invoice is created. When the outcome is unknown, as after a timeout, the job looks up the Tenant's recent invoices in the tool by our reference before it tries again. Only when none is found does it create again. Attempts that fail on the way are tried again after 1, 5, and 30 minutes, as in the mail outbox (ADR-0045); after that the invoice is failed. A refusal by the tool, such as bad data, a spent monthly allowance, or a rejected token, fails at once, with a reason category and no personal data. The office fixes the cause and presses "Pokušaj ponovno", which rebuilds the request from the current Transfer and billing details under the same invoice id. An Admin may withdraw a failed invoice after a lookup confirms that the tool has none with its reference.

### Status, sending, and Home

A scheduled job reads the status of every created invoice, and of every invoice being cancelled, within the tool's status allowance. A created invoice that the office has not yet sent from the current tool is an unsent invoice. A failed invoice and an unsent invoice are Warnings, and the Ride shows in Pozornost on Home with that Warning, whatever its operational day. Neither counts toward the urgent count.

The office sends every invoice from the current tool's web app: a domestic eRačun through the tool's eRačun channel, and a foreign agency's PDF by the tool's email. Transferpro links the document the tool returns.

Payment reporting stays in the current tool's web app. Pozornost shows a reminder to report the previous month's payments, from the 15th to the 20th of each month in the Tenant's time zone, while the Tenant has a sent invoice to a Croatian Client. The reminder is a Warning that is not attached to a Ride.

The invoice block on the Ride detail shows the state, the number, the document link, and the actions. Transfers has a quick filter "Za fakturiranje" for done Rides with `invoice_to_agency` and no invoice. Each row of a Client's Ride history shows its invoice state. There is no invoice register and no new navigation item; the current tool is the register.

### Storno

An Admin may cancel a created or sent invoice with "Storniraj"; a Dispatcher or a Driver gets 403. The job calls the tool's storno once and marks the invoice as being cancelled. The tool returns no id and does not refuse a duplicate, so the job never repeats a storno, whatever the outcome; the status job always finds the negative invoice the tool created. When it finds it, it stores that number and link, and the invoice is cancelled. The Transfer is then free again, and a new invoice for it gets its own id and the tool's next number. A domestic storno is sent from the current tool like any invoice, and until then it is an unsent invoice.

### The token and the settings

An Admin keeps the invoicing settings in `/settings` under Računi: the current tool's token, the due days (15 to start), the VAT rate (25 to start), and the line text. A Dispatcher or a Driver gets 403 on reading or saving them. `invoicing` owns them; `tenancy` does not change.

The token is stored in `invoicing`, encrypted with AES-256-GCM under `INVOICING_SECRET_KEY` from env, with a fresh nonce on every write and the Tenant id bound as associated data. It is write-only: the screen shows its last four characters, and it never reaches an API response, an audit entry, a log line, a job payload, or the error tracker. Any `INVOICING` value other than `none` requires the key. Rotating the key means re-entering every token; there is no rotation tool in v1.

### Audit and logs

The audit log records `invoice.requested`, `invoice.issued`, `invoice.failed`, `invoice.cancelled`, and `invoice.withdrawn`, each with the invoice id and the Transfer id. The actor is the member who asked: the one who pressed Izdaj račun or Pokušaj ponovno for the first three, the Admin for the last two. Billing details saved records the Client id and the field names. An invoicing settings change records the field names only, never the values, the token included. No entry holds a number, an amount, an OIB, an address, a guest, or a link. Log lines hold the invoice id, the state, and the reason category.

### After v1

A certified-intermediary module is post-v1, like CRM. In it, Transferpro builds the CIUS-HR UBL itself, adapters reach intermediaries from the official register, payment reporting runs from Transferpro, and other countries follow (EN 16931, eSLOG, Peppol). It needs its own grill and ADR, starting from the finding of #225. The port of this record is meant to take that adapter without changing transfers.

### Superseded

ADR-0036: "the Tenant's issuer" in "`invoicing` owns invoices, the provider port, the Tenant's issuer, and the provider secrets." In v1 the issuer's fiscal identity lives in the current tool. `invoicing` owns invoices, the port, the token, and the invoicing settings.

ADR-0036: "That reference is unique per Tenant, so a repeated request returns the same invoice." The Transfer reference is unique per Tenant among invoices that are not cancelled or withdrawn. After a storno, the same Transfer gets a new invoice with its own id.

ADR-0015: "the from/to values" for a settings change. An invoicing settings change records the field names only. ADR-0015 keeps covering the Tenant settings of `tenancy`.

ADR-0039: "every Ride with an urgent item" in "Home opens its lists with the "Pozornost" block: every Ride with an urgent item". Pozornost also lists every Ride with a failed or an unsent invoice, as a Warning, and the payment-reporting reminder. The urgent count is unchanged.

ADR-0039: "**Warning** (Upozorenje) is attached to a Ride". The payment-reporting reminder is a Warning that is not attached to a Ride.

## Consequences

The Tenant keeps one number series, one sending channel, and one archive, and no invoice is fiscalized twice. Each domestic invoice costs one click in the current tool, and Home keeps showing an invoice until it is sent. Payment reporting is the Tenant's own work in the tool, with a reminder.

The current tool sets the ceiling. The monthly allowance of API invoices may run out in a peak month; then a create fails with the spent allowance, and the office issues the rest of that month in the tool by hand. Creates at least 10 seconds apart and a small status allowance make issuing slow but not lost. Without a sandbox, step 28 needs a separate test account of the current tool, outside the Tenant's, on a plan that allows API invoices, with its token in a local env outside the repo. Test invoices there are B2B and never sent, so none is fiscalized. Step 28 proves three facts: the total equals a gross Transfer price to the cent, an invoice is found again by our reference in its notes, and the negative invoice of a storno is found. If any one fails, issuing stops at step 28 and this record is reopened.

ADR-0033's pilot acceptance reads as a real invoice created through the current tool in the Tenant's own account on production. The current tool works for the Tenant under the Tenant's own contract; step 35 decides how the privacy documents name it.

The first module that stores a secret in the database is `invoicing`, so the step 34 security gate checks its encryption, its redaction, and that the token never leaves the server. Swapping the current tool for an intermediary later is a new adapter, new billing-details fields, and a new ADR, not a change to transfers.

Open for the accountant, not blocking: whether an invoice to a foreign agency that carries Croatian VAT needs no fiscalization, and the KPD code of a transfer line, if the current tool asks for one.
