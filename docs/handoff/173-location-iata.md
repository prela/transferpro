# 173 Location IATA

Out of scope: the flight-status feed, the landing time, the expected arrival, and the work-order mail.

## Decisions

- The stored code is three ASCII letters or null. Check the letters before `toUpperCase()`, because `ßa` becomes `SSA`.
- The labeled field is on the add and edit forms only when the kind is airport. The list shows a stored code in an unlabeled cell and leaves that cell blank for every other kind.
- Changing the kind away from airport clears the code in that same write. A patch that names a code for a non-airport is refused and writes no audit row.
- The audit field name is `iata`. The entry does not store the code.

## Code review

## Standards

No hard breaches.

`iata` stays a field name on `location.created` and `location.field_changed`. The code value is not written. That matches `AGENTS.md` (audit stores field names and ids, never names, addresses, phone, or email) and ADR-0014. The migration replaces `audit_entry_shape` so the allow-list includes `iata`; `db/audit-entry.ts` already builds that check from `LOCATION_FIELDS`. The column is on the existing `tenantTable()` (`db/locations.ts`), so ADR-0011 RLS is unchanged. Both locales and both themes are covered (`docs/agents/working-rules.md`, i18n and theme). `e2e/locations.spec.ts` is extended, not weakened (`AGENTS.md`). The airport-only optional code matches ADR-0028. `GLOSSARY.md` is updated.

**Judgement call — Duplicated Code.** `app/components/LocationList.vue` repeats the same IATA gate, body, and field for add and edit:

```84:91:app/components/LocationList.vue
iataErrorKey.value = chosen === 'airport' ? iataKey(iata.value) : null
// ...
...(chosen === 'airport' ? { iata: iata.value } : {}),
```

The edit path is the same shape with `editIata` / `editIataErrorKey`. The file already did this for name, kind, and address, so this follows the local form rather than a new pattern.

## Spec

### (a) Missing or partial

The add and edit inputs appear only for an airport (`v-if="kind === 'airport'"` / `editKind`), in both locales, and the end-to-end test covers light and dark. The list always has an IATA column (`accessorKey: 'iata'`), so a hotel, address, or other row still shows that column.

> "The code field is shown only when the kind is airport, in Croatian and English, in light and dark."

### (b) Scope creep

None. The glossary line, the audit-shape update that allows the field name `iata`, and the transfer fixture `iata: null` follow that field.

### (c) Implemented but wrong

`locationIataSchema` trims, calls `toUpperCase()`, then checks `/^[A-Z]{3}$/`. Uppercasing can turn a value that is not three letters into three ASCII letters (`ßa` → `SSA`, `ﬃ` → `FFI`), and the API stores that. The form helper tests the raw string with `/^[a-z]{3}$/i` and refuses those same values. The database check only sees the stored form, so it does not stop this.

> "A code that is not three letters is refused, and the Location is unchanged."

> "The stored value is three ASCII letters, uppercase, or empty."

Follow-up on this branch: the parser now refuses those strings before uppercasing, and the list cell is unlabeled and blank unless the row is an airport with a code.
