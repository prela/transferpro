# 416 Partner Ride history screen

Out of scope: a migration, a new command, and the Nedostupnost tab.

## Decisions

- Vožnje is the second tab on the opened Partner, after Podaci, including an archived Partner. The screen calls `GET /api/partners/:id/ride-history`. `partners` does not import `transfers`.
- Each row matches the Client history: pickup via `formatInstant`, guest, from and to, state, Driver or Partner, and price with the payment. Učitaj još follows `nextCursor`. The page stays 50. The counts line is the response `counts`.
- A row opens `/transfers?day={operationalDay}&ride={id}`.
- A handed-off Ride shows the Partner phone and email from `partnerBriefs` as `tel:` and `mailto:` links. The note stays off that screen. The links are 28 px in the office and 48 px on the phone.
- The Driver's reads do not carry `partnerBriefs`. The Driver's phone shows neither the tab nor the links.
- QC accepted the duplicated history view and seed helpers, and the extra empty and error states, on `640f167`. Those states match the Client tab.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (909) passed. `pnpm test:e2e` passed (329, 5.1m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored).

## Code review

Reviewed `feature/416-partner-ride-history-screen` against `origin/develop`. QC passed on `640f167`. The reports below are verbatim.

## Standards

**Hard violations:** none.

Checked against `AGENTS.md` (glossary terms in code and tests, e2e added for the UI change, Zod on the history response, no deep module import), `docs/agents/working-rules.md` (both locales, `formatInstant`, `role="alert"` / `role="status"`, Lucide only), ADR-0016 / ADR-0038 (Nuxt UI tokens, phone `xl` / 44–48px, desktop 28px via `commandControlClass`), and ADR-0049 (the screen calls the history read; `partners` does not import `transfers`; Driver links stay off when `partnerBriefs` is empty).

**Judgement — Duplicated Code.** `app/components/PartnerRideHistory.vue` is a second copy of `ClientRideHistory.vue` (not in this diff): the same page load, status switch, price comma, and row markup, with the id and i18n prefix changed.

```27:46:app/components/PartnerRideHistory.vue
function failureKey(error: unknown): RideFailure {
  switch (httpStatus(error)) {
    case 400: return 'partners.rides.rejected'
    // ...
  }
}
async function readPage(cursor: string | null): Promise<RideHistory> {
  return rideHistorySchema.parse(await $fetch(`/api/partners/${props.partnerId}/ride-history`, {
```

`e2e/partner-ride-history.spec.ts` repeats the same helpers (`isPhone`, `card`, `createdId`, `book`, `wallBefore`) as `e2e/client-ride-history.spec.ts`. One shared history view and one shared seed helper would remove both copies. `priceLabel` staying local matches the existing per-component pattern, so that line alone is not a separate finding.

## Spec

**(a) Missing or partial**

None. The Partner panel’s edit view, including an archived Partner, has a Vožnje / Rides tab and calls `GET /api/partners/:id/ride-history`. Rows, cursor paging, and total / done / No-show / cancelled counts match the Client history. A row opens `/transfers?day=&ride=`. On a `handed_off` Ride, the detail shows that Partner’s phone and email as `tel:` and `mailto:` links, from `partnerBriefs` (phone and email only). The note is not shown. `/partners` and `/transfers` stay office-only, so the Driver’s phone does not get the tab or the links. There is no migration and no new command, and `partners` does not import `transfers`. The new spec covers an archived Partner, paging, Croatian and light, an English dark smoke, phone and desktop (`@phone` on both projects), and axe. No test is removed or weakened.

**(b) Scope creep**

The history tab also has a loading line, an empty state, and alerts for 400, 401, 403, 404, and other failures, and the data-tab footer is hidden while Vožnje is selected. Issue #416 asks for “the same rows, paging, and counts as a Client's Ride history,” not those states. They match that Client tab.

**(c) Implemented but wrong**

None. Contact links render only when `state === 'handed_off'` and a brief has a phone or email, which matches ADR-0049: “on a handed-off Ride, the Partner's phone and email.”
