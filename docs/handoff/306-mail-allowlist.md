# 306 Mail recipient allowlist

Out of scope: forcing `MAIL_ALLOWLIST` at boot on preview. Preview and production are both `NODE_ENV=production`, so the app cannot tell them apart. The protection is `docs/ops/preview.md`.

## Decisions

- `MAIL_ALLOWLIST` is a comma-separated list, parsed with Zod at boot. Entries are trimmed and stored lowercased. Unset and blank leave the transport unchanged. A blank entry or an invalid email throws `MAIL_ALLOWLIST has a blank or invalid email.` The Zod error is dropped so the value is not echoed.
- With `MAILER=resend`, a Resend key, and the list set, the only function that posts to Resend sends a listed recipient and writes every other recipient as today's console line. `NODE_ENV=test` still gets the fake mailer, list and key or not. The ADR-0037 console flag is unchanged.
- Arrival-moved and will-not-arrive still do not resolve a recipient or send. Password mail is not on the port yet. Both are gated only when they call that post.
- The app cannot require the list on preview alone, because preview and production are both `NODE_ENV=production`. The protection is `docs/ops/preview.md`. Follow-up: #312, a boot guard where `DEPLOY_ENV=preview` requires `MAIL_ALLOWLIST`.

## Tests

No test removed or weakened. `server/core/app-env.test.ts` and `server/modules/tenancy/infrastructure/mailer.test.ts` grew. No migration. Conclude, after `pnpm exec nuxi build`: `pnpm lint`, `pnpm typecheck`, and `pnpm test` (596) passed, then `PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" pnpm test:e2e` — 246 passed (3.7m).

## Code review

Fixed point `origin/develop` (`27b50be`). The reports below are the review of `606d716`. `a55fc0b` then moved the allowlist check onto the only Resend post.

### Standards

No hard documented-standard breach. Env parsing, the mailer port, logging, and the docs match the rules that apply.

`parseMailAllowlist` uses Zod, drops the Zod error, and throws a fixed sentence (`AGENTS.md` runtime boundary; `docs/agents/working-rules.md` Invitations: blank or invalid email fails boot and the message does not echo the value). Unset and `''` leave the transport alone; production may still boot with Resend when the list is unset (`ADR-0042` Preview mail; `ADR-0013` / `ADR-0037` boot rule, left intact). Test still selects the fake mailer when the list and a Resend key are set (`AGENTS.md`: tests never send real mail). Non-listed recipients go through `createConsoleMailer`, which logs `mail.console` with subject and domain for an invitation and only `kind` for a work order (`ADR-0042`: today’s console line; Logging: address, body, and invite URL stay off the log). The gate sits on the address about to be posted, inside the tenancy mailer, imported via `server/core/index.ts` (`ADR-0018` public entry; no new module). `.env.example`, Invitations, and `docs/ops/preview.md` match `ADR-0042` and the console-only flag in `ADR-0037`.

**Judgement — Duplicated Code** (`server/modules/tenancy/infrastructure/mailer.ts`). The same deliver-or-console shape is copied for both sends:

```301:312:server/modules/tenancy/infrastructure/mailer.ts
      await deliver(
        { to: mail.to, ...message },
        'Invitation email was not sent.',
        async () => { await consoleMailer?.sendInvitation(mail) },
      )
    },
    async sendWorkOrder(mail) {
      await deliver(
        mail,
        'Work order email was not sent.',
        async () => { await consoleMailer?.sendWorkOrder(mail) },
      )
```

**Judgement — Mysterious Name** (`mailerForApp`). The parameter is a `Logger`, and the comment calls it a line:

```163:170:server/modules/tenancy/infrastructure/mailer.ts
 * `log` is the console line for a recipient the allowlist turns away.
 * Boot omits it and the process logger is used.
 */
export function mailerForApp(env: { ... }, log?: Logger): Mailer {
```

Shotgun edits across env, docs, and the mailer are the documented seams (Zod at the env boundary, delivery behind the mailer port), so that baseline smell is suppressed.

### Spec

### (a) Missing or partial

**Arrival-moved, will-not-arrive, and later password mail are not on the gate.** The issue says: "This covers every kind of mail: invitation, work order, arrival moved, will not arrive, and the password mails that come later." And: "The check applies to the final recipient of every Resend send, including a notice whose address is resolved inside the adapter."

`deliver` checks `message.to` only for `sendInvitation` and `sendWorkOrder`. `notifyArrivalMoved` and `notifyFlightWillNotArrive` are still empty and do not call `deliver` or `post`. A comment says a future address "must go through `deliver`". Password mail is not on this port. Those kinds are not gated; a later edit can call `post` and skip the list.

### (b) Scope creep

None in behavior. Parsing, the Resend-vs-console split, the test fake mailer, and the preview docs match the issue and ADR-0042. The optional logger on `mailerForApp` is a test seam; boot does not pass it.

One doc tweak the issue did not ask for: Invitations used to say "The Resend key is not required to boot." It now says that only "when the console mailer is selected." The key parser itself is unchanged.

### (c) Implemented but wrong

None. Zod parse, trim, case-insensitive compare, fixed boot error, unset list, `NODE_ENV=test` fake mailer, and "no new address log" match the acceptance lines. Non-listed invitation and work-order sends use today's console line and do not call Resend.
