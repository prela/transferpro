# 120 Office user menu sign-out

Out of scope: Settings in the menu, moving Locale and theme into the menu, and the Home dashboard (#115).

## Decisions

- An Admin or a Dispatcher signs out from the navbar user menu. Do not put that button back on Home for those roles or on the office pages. The load-error sign-out button stays: a failed session load has no Tenant name, so the menu is not shown.
- A Driver signs out from the phone Home button. Platform screens and the invitation accept screen keep their own sign-out. Do not route those through the office menu.
- The menu names the Tenant only. Do not show a personal display name, and do not add Settings yet.
- Sign-out is `useShellSignOut`. Success clears the shared session shell. Failure sets `shell.signOutFailed` and leaves the Tenant up. It does not remove `transferpro-theme`. The page alert already bound to `shellError` is the failure message. A route change clears that error.
- `e2e/fixtures/ui.ts` `signOut` clicks a visible Odjava control, and opens `button[aria-haspopup="menu"]` only when that control is not on screen. English specs open the menu with `openUserMenu`.

## Code review

Two passes, fixed point `origin/develop`. Pass 1's duplicated menu opener was extracted into the e2e fixture before pass 2. Pass 2 matches this branch.

### Pass 1

## Standards

No hard breaches of `AGENTS.md`, `docs/agents/working-rules.md` (Sign-in, i18n and theme), ADR-0016, ADR-0018, `GLOSSARY.md`, or the Charter UI/session rules.

Aligned: Nuxt UI only (`UDropdownMenu`, `UButton`), semantic `neutral`, Lucide `i-lucide-log-out`, tap targets `size="xl"` (ADR-0016; nuxt-ui skill). Labels reuse `shell.signOut` / `shell.signingOut`, already in both locale files (working-rules i18n). Sign-out stays `POST /api/auth/sign-out` (working-rules Sign-in). `transferpro-theme` is not written. The shell read goes through `sessionShellSchema`. No new module and no deep import (ADR-0018). E2E specs are extended, not weakened (`AGENTS.md`).

### Judgement calls

**Duplicated Code** — the same menu opener in two specs:

```7:9:e2e/auth.spec.ts
async function openUserMenu(page: Page, tenantName: string) {
  await page.getByRole('button', { name: tenantName, exact: true }).click()
  await expect(page.getByRole('menu')).toBeVisible()
```

```238:242:e2e/office-shell.spec.ts
async function openUserMenu(page: Page, tenantName: string) {
  await page.getByRole('button', { name: tenantName, exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
```

`e2e/fixtures/ui.ts` already owns `signOut`. One helper there would cover both.

**Duplicated Code** — the pending label is copied onto the new menu and left on the Driver button:

```21:21:app/components/OfficeUserMenu.vue
      label: pending.value ? t('shell.signingOut') : t('shell.signOut'),
```

```165:165:app/pages/index.vue
          {{ pending ? t('shell.signingOut') : t('shell.signOut') }}
```

The same expression remains on each office page’s load-error button (unchanged hunks). Small, but it is the same shape.

**ADR-0016, judgement, not a clear breach** — “A loading or saved message has `role="status"`.” `shell.signingOut` only replaces the menu-item label. Failure still uses the page `UAlert` with `role="alert"`, which matches the error sentence in that ADR. The old page button used this same label swap, so the repo pattern covers it.

## Spec

### (a) Missing or partial
None.

### (b) Scope creep
None.

### (c) Implemented but wrong
None.

### Pass 2

## Standards

No hard breaches. Sign-out stays `POST /api/auth/sign-out` (working-rules, Sign-in). Copy reuses `shell.signOut` / `shell.signingOut` / `shell.signOutFailed`, already in both locale files (working-rules, i18n). Theme key is untouched; light and dark are covered in e2e. `OfficeUserMenu.vue` is Nuxt UI only (`UDropdownMenu`, `UButton`), `color="neutral"`, `size="xl"`, icon `i-lucide-log-out` (ADR-0016; nuxt-ui skill: semantic colors, Nuxt UI only, icons). The UI change extends `e2e/`. No new module and no deep import (ADR-0018). Tenant is the company name on the trigger; no invented member name (GLOSSARY, Tenant / Member).

### Judgement calls

**Mysterious Name** — `app/composables/session-shell.ts`. `useShellSignOut` also owns locale-save errors and the flag Home’s sign-in sets.

```163:175:app/composables/session-shell.ts
type ShellError = 'shell.saveFailed' | 'shell.signOutFailed' | null
export function useShellSignOut() {
  const pending = useState('session-shell-pending', () => false)
  const shellError = useState<ShellError>('session-shell-error', () => null)
```

`chooseLocale` still assigns `shellError.value = 'shell.saveFailed'`.

**Feature Envy** — same file. `readSharedSession` and `clearSharedShell` exist to poke Nuxt async-data internals (`_asyncData`, `_abortController`, `payload.data`) rather than a session API. Comments say `useNuxtData` would revive the previous Tenant; still a private walk.

**Duplicated Code** — `e2e/fixtures/ui.ts`. `openUserMenu` opens by the Tenant button name; `signOut` opens with `button[aria-haspopup="menu"]` when Odjava is not already visible. The pending label `t('shell.signingOut')` / `t('shell.signOut')` is also repeated in `OfficeUserMenu.vue` and the driver button in `app/pages/index.vue`.

## Spec

### (a) Missing or partial

none

### (b) Scope creep

none

### (c) Implemented but wrong

none
