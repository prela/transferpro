# 390 E2e specs send the Transfer entry key

Out of scope: making the key required stays on #391. Specs that record a Transfer through the form stay as they are. No production code.

## Decisions

- One helper, `recordTransfer`, posts every direct Transfer create. Each call sends a fresh `externalId`, then spreads the body, so a passed id wins. No call site passes one.
- Form specs, including `e2e/transfer-form.spec.ts`, are not edited. The form already sends the key.
- Fixture only, no assertion changed.

## Code review

Fixed point `origin/develop`. The reports below are the review of `e6711fb`.

## Standards

**Hard violations:** none.

`e2e/fixtures/record-transfer.ts` posts `/api/transfers` with a fresh `externalId` (`crypto.randomUUID()`), and a caller-supplied `externalId` wins because the body is spread after it. That matches ADR-0035: the id is a UUID in the request body, and every test, fixture, and seed that inserts a Transfer supplies an `external_id`. The prose “entry key” matches `transferEntryKey` in `shared/transfer-draft.ts`; the JSON field stays `externalId`. `GLOSSARY.md` ExternalRef avoid-words (voucher, Client reference) are not used.

The 25 spec edits only swap `page.request.post('/api/transfers', …)` for `recordTransfer`. Assertions are unchanged (`AGENTS.md`: do not weaken or remove a test). No tenant-data, audit, or log path is touched (`docs/agents/working-rules.md`). ADR-0018 does not apply: the helper stays in `e2e/` and does not import a module past its `index.ts`.

**Judgement call — Primitive Obsession** (`e2e/fixtures/record-transfer.ts`):

```ts
options: { readonly data: object }
```

The create body is a known payload, and `object` accepts any bag, so a misspelled field is not checked at this boundary. Playwright’s `data` was already loose, so this does not weaken a check the call sites had.

**Not flagged:** Middle Man and Shotgun Surgery. The helper only adds the key and delegates the post, and 25 files change by one call. ADR-0035 requires the id on every insert, so one fixture is the right place. The spread that lets a body keep its own `externalId` is the merge, not an unused hook.

## Spec

**(a) Missing or partial**

None in the diff. `origin/develop` has 40 `page.request.post('/api/transfers'` calls. The commit replaces all 40, one call each, with `recordTransfer`. The new helper posts that body plus `externalId: crypto.randomUUID()`.

`pnpm test:e2e passes with the same assertions and test names` is unconfirmed: this review did not run the suite. The diff adds or removes no `expect(` or `test(` line.

**(b) Scope creep**

The helper lets a caller `externalId` replace the fresh one (`...options.data` after the UUID). The spec says the helper "posts a Transfer create body with a fresh random externalId." No call site passes `externalId`, so every current post still gets a new id.

No production file is in the diff. The 26 files are `e2e/fixtures/record-transfer.ts` and 25 specs.

**(c) Implemented but wrong**

None found.

**Checks you asked for**

- Form-driven specs are unchanged, including `e2e/transfer-form.spec.ts`, `e2e/transfers.spec.ts`, `e2e/theme-pages.spec.ts`, and `e2e/operational-day.spec.ts`. `e2e/duplicate-return-print.spec.ts` only swaps its two direct posts; its form path is untouched. Spec: "Specs that record a Transfer through the form are unchanged."
- Production code is unchanged. Spec: "No production code changes."
- No `expect` or test-name line changed. Spec: "No test is weakened or removed."
