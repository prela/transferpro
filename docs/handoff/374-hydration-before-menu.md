# 374 Wait for hydration before opening Više and Radnje

Out of scope: product code, migrations, and menu clicks that are not the first action after navigation.

## Decisions

- `openCorrection` waits for hydration immediately after `goto('/transfers')`, before the phone row click and **Više**, and before the desktop **Radnje** click.
- The same wait was added only where **Više**, **Radnje**, or **Actions** is the next click after `goto` and `hydrated` was missing: the clear-assignment click in `stale-save`, three sites in `correct-transfer`, the members-tab click in `audit`, and the first menu in `record-landing-time`.
- `openMembers` waits after the server-rendered heading check. That covers `members`, `members-guards`, `invitations`, and `invite-role-select`, which open **Radnje** as soon as the helper returns.
- The wait stays off `openRideMenu`. That helper is also used long after hydration. A later landing-time menu click already follows `switchLocale` or `switchTheme`, which wait on the way back.
- Specs that already call `hydrated` after `goto` were left as they are.

## Code review

Fixed point `origin/develop`. The reports below are the review of `f3a62e6`, before the pull request.

### Standards

No hard violations. The diff only adds `await hydrated(page)` before overflow-menu clicks and inside `openMembers`. Glossary terms, ADR-0018 import direction, tenant/RLS, mail, and i18n/theme rules are untouched. No spec is removed or weakened (`AGENTS.md`).

**Judgement — Shotgun Surgery / Duplicated Code.** One wait is copied at each menu open instead of living on the helpers that already open those menus.

`openRideMenu` in `e2e/fixtures/ui.ts` still clicks immediately:

```251:254:e2e/fixtures/ui.ts
export async function openRideMenu(page: Page, guest: string) {
  const name = guest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await page.getByRole('button', { name: new RegExp(`^(Radnje|Actions): ${name}$`) }).click()
}
```

The same `goto` + `hydrated` + Radnje/Actions click is added in `e2e/correct-transfer.spec.ts` (three times), `e2e/record-landing-time.spec.ts` (before `openRideMenu`), and `e2e/stale-save.spec.ts` (`openCorrection` and the clear-assignment click). `openMembers` now waits, but `e2e/audit.spec.ts` repeats that navigation:

```
await page.goto('/settings?tab=members')
await hydrated(page)
```

`Više` is only covered inside `openCorrection` (`text.more`), not in a shared helper. A later `openRideMenu` caller can still click before hydration.

The two new comments state the same gap in different words (`openMembers`; `openCorrection`). Not a standard breach: the JSDoc on `hydrated` already says a click before it misses the Vue handler.

### Spec

#### (a) Missing or partial

- **The changed-spec list is not in a PR.** “Other menu-after-goto specs are checked; the list of the ones changed is in the PR.” `fix/374-hydration-before-menu` is pushed and has no pull request, so that list does not exist. The diff itself does add `hydrated` in `e2e/stale-save.spec.ts` (`openCorrection` and the later `Radnje` click), `e2e/audit.spec.ts`, `e2e/correct-transfer.spec.ts` (three `goto('/transfers')` sites), `e2e/record-landing-time.spec.ts` (the `goto` immediately before `openRideMenu`), and `openMembers` in `e2e/fixtures/ui.ts`.
- **A local green run is not shown.** “Only the related e2e specs are run locally (chromium + phone), and they are green.” Nothing in the commit or a PR records that.

`openCorrection` does wait: `await hydrated(page)` sits directly after `page.goto('/transfers')` and before the row / **Više** / **Radnje** clicks. “`openCorrection` waits for hydration before clicking.”

#### (b) Scope creep

None. The diff is test-only. Each new wait is a **Više** / **Radnje** / **Actions** click after `goto`, or the `openMembers` wait the ticket allows for those callers. No product code, migration, or assertion change.

#### (c) Implemented but wrong

None in the touched files. `openMembers` still asserts the server-rendered heading before `hydrated`, and the wait runs before the function returns, so callers that then click **Radnje** are covered.
