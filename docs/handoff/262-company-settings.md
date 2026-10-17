# 262 Company settings tabs and Članovi

Out of scope: Profile, the audit page, and invitation accept stay as they are. No migration.

## Decisions

- `/settings` is Postavke tvrtke, Admin only. Operativa is that address. Članovi is `/settings?tab=members`. The tab menu is `UNavigationMenu` with `exact` and `exactQuery`, so Operativa is not current while the members query is set.
- `/settings/tenant` redirects to `/settings`. `/settings/members` redirects to `/settings?tab=members`. `/settings/profile` still redirects to `/profile`. A Dispatcher or a Driver who opens any of those is sent to `/profile` by the route.
- Operativa keeps the six existing fields, in two columns from the `lg` breakpoint. Članovi puts `+ Pozovi člana` at the top right. The invitation is a modal, then the sent or email-not-sent status and a copyable link. The table is name, email, and role. `⋮` offers Promijeni ulogu and Ukloni, each in a confirmation that states the consequence. Promijeni ulogu is a form, so Enter confirms.
- Pozivnice na čekanju uses `GET /api/invitations` and `POST /api/invitations/:id/revoke` from #249. Povuci revokes immediately. Expiry is `formatInstant` in the session time zone.
- The sign-in address is only on an Admin member list, for user ids the session tenant already returned. A Dispatcher list has no email. `app.tenant_member` is unchanged.
- Office buttons on these screens are 28px on the desktop and 44px on the phone. Inputs stay 16px.
- The invitation result stays in the modal, so `signOut` and `openAudit` dismiss that dialog before they click. Otherwise the overlay covers the menu and the sidebar.

Changed specs, and why:

- `e2e/company-settings.spec.ts` — old addresses land on the tabs; the invite modal, sent status, pending row with expiry, and Povuci; `@phone` axe in light and dark, two columns against a stacked phone layout, and English once.
- `e2e/fixtures/ui.ts` — `openMembers` opens `/settings?tab=members`; `openInvite` opens the modal; a refused settings address has no Operativa region, no invite button, and no Postavke tvrtke navigation. Sign-out and the audit link dismiss an open dialog first.
- `e2e/settings.spec.ts` — Operativa is the settings region and the tab.
- `e2e/settings-profile.spec.ts` — keyboard order is Operativa then Članovi, and those addresses are `/settings` and `/settings?tab=members`.
- `e2e/members.spec.ts` — role change and removal go through the row menu, and removal states the immediate loss of access.
- `e2e/members-guards.spec.ts` — the same removal sentence; the caller's own row has no menu.
- `e2e/invitations.spec.ts` — the invite dialog, and removal of an accepted member states the consequence.
- `e2e/invite-role-select.spec.ts` — the role listbox is inside the invite dialog.
- `e2e/audit.spec.ts` — role change and a settings save start from the new tabs.
- `e2e/accept-invite-existing.spec.ts` — a Dispatcher does not see Operativa or the invite button; an Admin can open both tabs.
- `e2e/office-roles.spec.ts` — a Dispatcher is refused on `/settings` as well as the old addresses. Home for a Dispatcher and a Driver has no Članovi heading.
- `e2e/driver.spec.ts` — a Driver has no Postavke tvrtke link and is refused on `/settings`.
- `e2e/signed-out-pages.spec.ts` — `/settings/tenant` and `/settings/members` are signed-out addresses.

## Code review

Fixed point `origin/develop`, after `573007a`. The reports below are that review.

## Standards

### Hard

none

### Judgement

- **ADR-0038** (“A confirmation is kept for a command that cannot be undone…”) vs the Members paragraph, which names a confirmation only for Promijeni ulogu and Ukloni. `PendingInvitations.vue` revokes on click: `@click="revoke(row.original.id)"` with no dialog. Sending again is a new invitation, so Povuci is not undone.
- **ADR-0038** (“Size `xl` now applies only to the phone layouts”; desktop controls in a row are 28 px). The same diff defines `h-7 … max-lg:h-11` for the invite, row, and revoke controls, but the rewritten Operativa fields and submit stay `size="xl"` (`TenantSettings.vue`), as do the invite `UFormField`s (`MemberInvite.vue`). Repo forms elsewhere still use `xl`, so this is inconsistent inside the change, not a new pattern.
- **Duplicated Code.** The same control class is copied in `MemberInvite.vue`, `MemberList.vue`, and `PendingInvitations.vue`: `const controlClass = 'h-7 min-h-7 max-lg:h-11 max-lg:min-h-11 max-lg:text-base'`. The phone-column meta `{ class: { td: 'max-lg:hidden', th: 'max-lg:hidden' } }` is copied in `MemberList.vue` and `PendingInvitations.vue`.
- **Duplicated Code.** `companySettingsRedirect` already returns `/settings` and `/settings?tab=members`, and the child routes hardcode the same targets: `await navigateTo('/settings', { replace: true })` and `await navigateTo('/settings?tab=members', { replace: true })`.
- **AGENTS.md** (“every loader or helper that returns tenant data enforces the role allow-list itself; do not rely on the caller”). `emailsByUserId` selects `auth."user"` for whatever ids it is given; the comment says the caller already limited them. `listMembers` does restrict that to an admin of the session tenant, and ADR-0011 keeps the auth role off the tenant view, so the helper cannot check the tenant itself.

## Spec

### (a)

none

### (b)

none

### (c)

Operativa’s save control stays `size="xl"` on the desktop. The same screens set other controls to 28px / 44px. ADR-0038: “Size `xl` now applies only to the phone layouts, the office's and the Driver's.”

An Admin `GET /api/members` throws `Member email is missing.` when any returned user id has no auth address, so Članovi shows the load error instead of the table. Issue #262: “the member table first (name, email, role, `⋮` with "Promijeni ulogu" and "Ukloni"”.
