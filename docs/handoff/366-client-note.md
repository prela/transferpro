# 366 Client note on the Client card

Out of scope: the Ride detail, the Transfer form, the Vožnje tab, and the Partner note. Those stay on later cuts of #363.

## Decisions

- The note is its own table, `app.client_notes`. `app.clients` is not altered. Migration `0054_client_notes`, journal `when` 1791400044000 (the `0053` value plus 1000). No `DELETE` grant.
- The first save omits `version` and stores version 1, so a later refusal can name who and when. A second first save, including a lost race, is 409 `stale_save` and writes nothing.
- The 409 body is the code only, the same reading as #364. Who and when come from a re-read of the note.
- An empty save of an existing row clears the text and keeps the row. An empty first save, when there is no row, writes nothing and appends nothing. A fresh save of the same text appends nothing. A note save does not change the Client's version.
- Audit action `client_note.saved` stores the Client id and the field name `note`. Never the text.
- No new domain or application tier. The write follows the contact-person catalog path.
- The card trims, then applies the 2000-character limit, in the same order as the route.
- Checks on this branch: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (858), `pnpm test:e2e` (302; port 3010 because 3000 was already in use), and `pnpm test:rls` (398). `pnpm audit --audit-level=high` exited 0.
- The review below is of `802e17d`. `4f51066` answers it: an empty first save no longer inserts or audits, the card trims before the length check, the audit payload uses `CLIENT_NOTE_FIELD`, the passthrough is named `isStaleSave`, and both save paths call `recordNoteSaved`. The test local name `firm` stays, matching the contact-person HTTP test. A second look confirmed the two spec findings are fixed.

## Code review

Fixed point `b1d144e` (`origin/develop`). Both axes ran on the full model, not a fast one.

## Standards

No hard documented-standard breach.

The note is a child of `app.clients` (`tenant_id`, composite foreign key, `FORCE ROW LEVEL SECURITY`, `tenant_isolation` with `USING` and `WITH CHECK`, `REVOKE ALL`, no `DELETE`) as required by `AGENTS.md` (Security) and `docs/adr/0018-module-boundaries.md`. The new audit action has the four pieces in `docs/agents/working-rules.md` (Audit log): a strict shape in `shared/audit-entry.ts`, a branch in `db/audit-entry.ts`, migration `0054` (enum value and check), and `audit.actions.client_note.saved` in both locales. The entry stores the Client id and the field name, not the text (`AGENTS.md`: field names and ids only). `parseClientNoteSave` runs before a session; `readClientNote` and `writeClientNote` allow only admin and dispatcher.

A correction matches `docs/adr/0046-refuse-a-stale-save.md`: `update ... where version =` on the same transaction; a mismatch, including one that would not change the text, is 409 `stale_save` (code, fixed message, no name), and nothing is written or appended. A fresh save of the same text does not bump the version, the same reading already used for contact persons, and the reading ADR-0046 keeps from ADR-0029 (a fresh save that changes nothing writes nothing). The first save omits `version`; the losing insert is `stale_save`. ADR-0046’s “missing version is 400” is for commands whose body already requires a version. ADR-0049, which this change cites, is the rule for this table: two first saves, one row, the other a stale save.

Judgement calls (baseline only):

- **Speculative Generality.** `CLIENT_NOTE_FIELD` is exported and never read; the audit schema and the check hardcode `'note'`.

```14:14:shared/client-note.ts
export const CLIENT_NOTE_FIELD = 'note' as const
```

- **Mysterious Name.** `lostFirstSave` does not detect a lost race. It only classifies an error for passthrough.

```1842:1844:server/modules/clients/infrastructure/client-notes.ts
function lostFirstSave(error: unknown): boolean {
  return error instanceof StaleSaveError
}
```

- **Duplicated Code.** The same audit payload is appended in both `insertClientNote` and `saveClientNote`: `data: { clientId, fields: ['note'] }`.

- **Glossary, judgement.** `GLOSSARY.md` (Tenant) says to avoid “firm”. `server/api/client-notes.rls.test.ts` names the Tenant `firm` (`const firm = await office(...)`). Product copy uses Client. The contact-person HTTP test uses the same local name.

## Spec

(a) Missing or partial

None. The migration, office read and save, both stale-save cases, audit keys, Napomena on phone and desktop in Croatian and English and in light and dark, and the listed route, cross-tenant, audit, and e2e cases are in the diff.

(b) Scope creep

None. The diff stays on the Client note: the card tab, the read and save routes, the child table, and the audit action.

(c) Implemented but wrong

Blank first save still writes and audits. "A save that changes nothing appends nothing." "Saving an empty note clears it." With no row, the read is already an empty note. Saving that empty field calls `insertClientNote`, which always inserts a null row at version 1 and appends `client_note.saved`. A later save of the same empty text, once a row exists, appends nothing. The blank click also becomes the winning first save, so a colleague's real first save is `409 stale_save`.

The card counts length before trim. "the text (trimmed, up to 2000 characters)." `parseClientNoteSave` trims, then enforces 2000. `ClientNote.vue` uses `z.string().max(2000)` on the raw textarea. A 2000-character note with a leading or trailing space is refused on the card and accepted by the route.
