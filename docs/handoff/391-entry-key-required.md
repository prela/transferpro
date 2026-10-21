# 391 The Transfer entry key is required

Out of scope: the form already sends the key and is unchanged. No migration.

## Decisions

- `createTransferSchema` requires `externalId`. `parseRecordTransfer` throws `TransferInputError` before `withTenantFromSession`.
- `recordTransfer` takes that id and stores it. It does not mint one.
- The 15a tail “a body without the key still records” is replaced by “a create body without the key is 400 and writes nothing”. The idempotent assertions stay under “records the same manual external id once”.
- The unit test that expected a missing id to be null now expects `TransferInputError`. Other create parses in that file send a fixture key, so each assertion still checks the field it names.
- After the review, the create-schema comment no longer calls a missing key a non-idempotent create, and `parseRecordTransfer` calls the field the entry key.

## Code review

Fixed point `origin/develop`. The reports below are the review of `3f62b32`. The comment they quote was corrected in `63a5c30`.

## Standards

No hard breach. RLS, the tenant session, logging, module boundaries, and the entry-key rule in ADR-0035 match the code. `externalId` stays a string because ADR-0035 types it as text. `parseCreateTransfer` only returning `.input` is the split that keeps the key off `CreateTransfer`. The six-file spread is the shared contract plus the transfers module, which ADR-0018 requires.

**Judgement (ADR-0035, Idempotent manual entry).** `shared/transfer.ts` still describes the behavior this change removes:

```410:414:shared/transfer.ts
 * `externalId` is
 * required: a body without it is not idempotent, and the server does not
 * assign one (ADR-0035). The pickup window and the same-place rule are
```

A body without the key is now the same 400 as any other bad body and writes nothing (`transfers.rls.test.ts`). ADR-0035 says the form sends the id and an insert without one fails. It does not say a missing id is a non-idempotent create. The same slip is in the `parseRecordTransfer` comment, which calls the bare `externalId` string “the required ExternalRef”. The glossary defines ExternalRef as the Channel plus that id. The insert still stores both (`'manual'` and `externalId`).

## Spec

No findings.

**(a) Missing or partial.** None. “`externalId` is required on create. A body without it is 400 and opens no session. The server no longer assigns one.” `createTransferSchema` requires `z.uuid()`, `parseRecordTransfer` runs before `withTenantFromSession`, and `recordTransfer` no longer calls `randomUUID`. The route test posts a keyless body with no cookie (400, so the session is not opened first) and with a dispatcher (400, tenant counts unchanged). “The 15a test ‘a body without the key still records’ is replaced” by `a create body without the key is 400 and writes nothing`; the idempotent half of that test remains. “A correction has no key”: `parseCorrectTransfer` still rejects `externalId` and `channel`. The unit test that expected a missing id to be null now expects `TransferInputError`.

**(b) Scope creep.** None. The diff is the schema, the record function, comments, and the tests those changes force. The form still creates the manual key; that code is not in this commit.

**(c) Implemented but wrong.** None. The keyless body is a normal booking (`correctionBody`), so the 400 is the missing key. A supplied id is still stored as `manual` / `external_id`, a repeat still returns the stored Transfer and writes nothing, and the correction schema is unchanged.
