# 262 Company settings tabs and Članovi

No migration. Email stays off `app.tenant_member`. An Admin list reads sign-in addresses from the auth pool for user ids that view already returned. A Dispatcher list does not.

## Decisions

- `/settings` is Postavke tvrtke, Admin only. Operativa is that address. Članovi is `/settings?tab=members`. The tab menu is `UNavigationMenu` with `exact` and `exactQuery`, so Operativa is not current while the members query is set.
- `/settings/tenant` redirects to `/settings`. `/settings/members` redirects to `/settings?tab=members`. `/settings/profile` still redirects to `/profile`. A Dispatcher or a Driver who opens any of those is sent to `/profile` by the route, not by hiding the screen.
- Operativa keeps the six existing fields, in two columns from the `lg` breakpoint. Članovi puts `+ Pozovi člana` at the top right. The invitation is a modal, then the sent or email-not-sent status and a copyable link. The table is name, email, and role. `⋮` offers Promijeni ulogu and Ukloni, each in a confirmation that states the consequence. Promijeni ulogu is a form, so Enter confirms.
- Pozivnice na čekanju uses `GET /api/invitations` and `POST /api/invitations/:id/revoke` from #249. Povuci revokes immediately. Expiry is `formatInstant` in the session time zone.
- Office buttons on these screens are 28px on the desktop and 44px on the phone. Inputs stay 16px.

Changed specs, and why:

- `e2e/company-settings.spec.ts` — old addresses land on the tabs; the invite modal, sent status, pending row with expiry, and Povuci; `@phone` axe in light and dark, two columns against a stacked phone layout, and English once.
- `e2e/fixtures/ui.ts` — `openMembers` opens `/settings?tab=members`; `openInvite` opens the modal; a refused settings address has no Operativa region, no invite button, and no Postavke tvrtke navigation.
- `e2e/settings.spec.ts` — Operativa is the settings region and the tab.
- `e2e/settings-profile.spec.ts` — keyboard order is Operativa then Članovi, and those addresses are `/settings` and `/settings?tab=members`.
- `e2e/members.spec.ts` — role change and removal go through the row menu, and removal states the immediate loss of access.
- `e2e/members-guards.spec.ts` — the same removal sentence; the caller's own row has no menu.
- `e2e/invitations.spec.ts` — the invite dialog, and removal of an accepted member states the consequence.
- `e2e/invite-role-select.spec.ts` — the role listbox is inside the invite dialog.
- `e2e/audit.spec.ts` — role change and a settings save start from the new tabs.
- `e2e/accept-invite-existing.spec.ts` — a Dispatcher does not see Operativa or the invite button; an Admin can open both tabs.
- `e2e/office-roles.spec.ts` — a Dispatcher is refused on `/settings` as well as the old addresses.
- `e2e/driver.spec.ts` — a Driver has no Postavke tvrtke link and is refused on `/settings`.
- `e2e/signed-out-pages.spec.ts` — `/settings/tenant` and `/settings/members` are signed-out addresses.
