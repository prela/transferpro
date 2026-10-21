# 368 Client contacts and note on the Ride

Out of scope: editing a contact person or the Client note from the Ride, and the Partner note.

## Decisions

- The office day read returns `clientBriefs` for every Client of the Tenant, not a brief on each Ride. The Transfer form can show a note for a Client with no Ride that day. A removed contact person is left out.
- The display shape has no version. The form cannot save a contact or the note. Nothing about the note is written on the Transfer.
- `loadClientOfficeBriefs` takes the actor role and refuses anyone other than a dispatcher or an admin before it reads. That answers the Standards hard finding below. The day route still checks the role as well.
- Both themes run the form path (record, correct, duplicate, return, and a Client change). The English smoke chooses a Client and reads the form note. Axe stays on the expanded ride block in light and dark. That answers the Spec partial below.
- The empty calendar-day equality in `server/api/transfers.rls.test.ts` now also expects one empty brief. Rides and decline alerts stay exact. The assertion was extended, not weakened.
- No migration.
- The branch was replayed onto `develop` after #366 merged. `e2e/client-on-ride.spec.ts` records through `recordTransfer`, so create still sends the entry key.
- Checks on this branch: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (860), and `pnpm test:e2e` (308). `pnpm audit --audit-level=high` exited 0.
- The review below is of the work before `33f1f6d`. That commit holds the role check and the form coverage. `0bd4483` only sends the entry key from the Ride spec.

## Code review

Fixed point `898a621` (the work was still uncommitted). Both axes ran on the full model, not a fast one.

## Standards

### Documented standards

**Hard.** `AGENTS.md` (Security): every loader that returns tenant data enforces the role allow-list itself and does not rely on the caller.

`loadClientOfficeBriefs` is exported from the Clients index and returns every Client's contact names, phones, emails, and Client note. The comment states the caller has already required a dispatcher or an admin:

```29:36:server/modules/clients/infrastructure/client-office-briefs.ts
 * Live contact persons and the standing note for every Client in this Tenant.
 * A removed contact person is left out. An empty note, and a Client with no
 * note row, are null text. The caller has already required a dispatcher or
 * an admin. The Driver's read must not call this: the office screens are
 * the only readers (ADR-0049). Transfers reaches it through the Clients index.
 */
export async function loadClientOfficeBriefs(transaction: TenantTransaction): Promise<ClientOfficeBrief[]> {
```

`listTransferDay` does call `officeOnly` before this read, and the upcoming test checks that the Driver payload lacks these fields. `readClientNote` in the same module checks the role inside the helper. `loadClient` is the existing transaction helper that also defers to the caller, and it returns a name and kind. This export returns phones and emails, so the helper should take the actor role and refuse a Driver itself.

Transfers imports it from the Clients `index.ts`. The new SQL reads `app.clients`, `app.client_contact_persons`, and `app.client_notes` only (ADR-0018). The day route parses `transferDaySchema`. Both locales and `e2e/client-on-ride.spec.ts` are in the change. The facts on screen are the Client note and contact persons already in the glossary.

### Baseline smells (judgement)

**Duplicated Code.** `clientOfficeContactSchema` repeats `contactPersonSchema`'s name, role, phone, email, and phone-or-email refine. The version columns are omitted on purpose so this payload cannot save a contact. The constraints can stay one schema via `omit`. The same fields are parsed again, loosely, in `contactRows` inside `client-office-briefs.ts`, then passed through `clientOfficeContactSchema.parse`.

**Duplicated Code.** Both screens scan the same array:

`TransferFormFields.vue`: `props.clientBriefs.find(brief => brief.clientId === id)?.note`

`TransferRideDetail.vue`: `props.clientBriefs.find(brief => brief.clientId === props.ride.clientId)`

**Mysterious Name.** `ClientOfficeBrief`, `clientBriefs`, and `officeBrief` stand for contact persons plus the Client note. Those two glossary terms are the honest name.

## Spec

**(a) Partial.** “E2e: the block on the Ride detail and the note on the Transfer form, with Croatian copy, one English smoke, light and dark, and axe.”

The Croatian ride block is covered in light and dark, with axe, on phone and desktop. The Transfer-form note (record, correct, duplicate, return, and changing Client) runs only in the light pass: dark returns first. Axe is not run on the form. The English smoke opens only the ride block (“Contacts and note” / “Client note”). It never chooses a Client on the form, and it creates no contact person, so it does not smoke the form note or a phone or mail link.

**(b) None.** The day payload lists every Client so the form can show a note for one with no Ride today. Empty copy (“No contact persons yet.” / “No note.”) is the empty case of the block the spec asks for.

**(c) None.** The other lines match the diff. `GET /api/transfers` loads live contacts and the note through the clients public entry, after the office role check; `removed_at` is excluded. The ride detail is a collapsed block (name, role, `tel:` and `mailto:`) on both layouts. The form note sits under the Client select, follows the selection, and is not a Transfer field. The driver upcoming read and the work order still carry only the Client name (the work order `note` is the Transfer note). RLS covers this Tenant only, a removed contact, and the driver read. Croatian and English strings exist for both themes’ tokens.
