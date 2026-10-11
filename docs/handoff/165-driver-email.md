# 165 Driver email

Out of scope: sending a work order, SMS, and a screen that changes a member's sign-in email.

## Decisions

- The copy is `emailByUserId` on the auth role, after `app.tenant_member` confirms the member is a driver. Do not add a view of `auth.user` for the app role.
- Create and patch refuse an `email` key when the Driver has, or will have, an account. Do not drop the key.
- A blank email is stored as null. Two Drivers may share an address.
- v1 has no sign-in change, so there is no updater that rewrites linked Driver emails. Add that write in the same transaction as the first screen or hook that changes `auth.user.email`.
- The unknown-key test that used `email` now uses `notes`. `email` is a field.

## Code review

## Standards

No hard violations. The earlier `auth.user` view is gone. `0025_driver_email.sql` copies addresses in an owner `UPDATE` and adds no grant. Runtime reads go through `emailByUserId` on the auth pool (`AUTH_DATABASE_URL`), and drivers imports `readSignInEmail` from the tenancy `index.ts` (AGENTS.md deep-import rule; ADR-0011: the app role selects `app.tenant_member` for `user_id`, `name`, and `role` only). Audit rows store the field name `email`, not the address (AGENTS.md audit ban; ADR-0014: entries do not store emails). `db/audit-entry.ts` already builds `audit_entry_shape` from `DRIVER_FIELDS`, and the migration’s list matches. Journal `when` is the previous entry plus 1000. Both locales gained the new strings. `email` is already on the redact list.

### Judgement calls

**Duplicated Code.** The same address rules are written out several times. Format: `driverEmailSchema` (`z.email()`), `normalizeEmail` (`if (!z.email().safeParse(email).success) throw new DriverInputError()`), and `driverEmailError`. The “linked body must not carry an address” refusal is in `parseCreateDriver`, `parseDriverPatch`, `addDriver` (`if (input.memberUserId !== undefined && input.email !== undefined)`), and `correctDriver` (`if (patch.email !== undefined && next.memberUserId !== null)`). The SQL check is a third, weaker form (`position('@' in email) > 1`). The parser-plus-writer repeat matches this repo’s double-check habit; the three TypeScript copies of `z.email()` do not.

**Mysterious Name.** In `drivers.test.ts`, `const signIn = 'marko@example.test'` holds an address.

## Spec

### (a) Missing or partial

- **Partial.** "A later sign-in change, which v1 does not offer as a screen, must update every linked Driver email in the same write." There is no screen (that acceptance line holds) and no user-update hook or trigger. After the link-time copy, nothing writes `auth.user.email` through to every linked Driver. A later account-address change would leave those rows on the old address.

### (b) Scope creep

None. The diff does not send work orders. Glossary, audit-constraint, list column, and the auth-role read are the email column.

### (c) Implemented but wrong

None. A body that supplies an email for a Driver who has, or will have, an account is refused (400, no update), not dropped. Linking copies the sign-in email in that same insert or update via the auth pool. Unlinking leaves the column. Blank is stored as null. The office list shows the email. The phone ride query and `presentDriverRide` omit it. A driver role is 403. An audit entry stores the field name `email` and not the address. Tenant B’s `select email` returns no rows.
