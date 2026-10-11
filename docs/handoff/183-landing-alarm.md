# 183 Landing alarm

Out of scope: push and SMS, the #163 unclosed-mark threshold, and the hotel or address 25-minute no-show.

## Decisions

- The alarm is `landingAlarm` on an in-progress row. Expected end is the stored landing plus the Tenant `transferDurationMinutes`. It is on when `now >=` that end plus 60 minutes. The 60 minutes are fixed. Do not add a second duration column.
- A Ride with no `landing_at` has `landingAlarm` false and keeps the unclosed mark at pickup plus 60 minutes (ADR-0027). Do not move that mark when a landing is stored.
- Office home puts the flag on the in-progress list, including earlier days. The day board puts it on an in-progress Ride of the operational day being viewed. Text only. No extra list, no extra count, no mail, and no change to done, no-show, cancel, or assignment.
- The rule lives in `shared/landing-alarm.ts`. Both reads call it. ADR-0030 names it.

## Code review

## Standards

No hard breaches of `AGENTS.md`, `docs/agents/working-rules.md`, ADR-0018, or the ADR/glossary format. ADR-0030 matches ADR-0027 and ADR-0029 (status, context, decision, consequences) and is indexed. Both locales, an `e2e/` spec, and the glossary term are present (working-rules i18n; `AGENTS.md`). The rule sits in `shared/landing-alarm.ts`; transfers import it from `shared/index.ts`, and `shared/office-home.ts` uses a sibling import, as it already does for `./transfer`. The 60 minutes stay a separate constant: ADR-0030 says this clock is not the unclosed mark. Day and home reads still enforce the office role allow-list. No new audit payload or log line.

**Judgement — Duplicated Code.** The same alarm paragraph is in both screens:

```282:287:app/components/OfficeHome.vue
              <p
                v-if="ride.landingAlarm"
                class="mt-1"
              >
                {{ t('officeHome.landingAlarm') }}
              </p>
```

```743:748:app/components/TransferDay.vue
          <p
            v-if="row.original.landingAlarm"
            class="mt-1 whitespace-normal"
          >
            {{ t('officeHome.landingAlarm') }}
          </p>
```

**Judgement — Duplicated Code.** `shared/office-home.test.ts` and `server/modules/transfers/infrastructure/transfers.test.ts` repeat one clock: landing `2026-06-15T08:00:00.000Z`, “Just short” at `2026-06-15T08:00:00.001Z`, duration 60 versus 90, guests Landed / Just short / No landing. The RLS test uses another clock (150 minutes, duration 120), so it is not that copy.

Not flagged: `now` and `transferDurationMinutes` beside `startHour` follow the operational-day parameter pattern (working-rules). `required` / `createdId` match other e2e specs. `storeLanding` matches `e2e/landing-time.spec.ts`, which is outside this diff.

## Spec

The change matches issue #183. No missing, extra, or wrong behaviour.

**(a) Missing or partial:** none.

- "Tenant has configurable transfer duration minutes (default 60)" is already on the Tenant (`transferDurationMinutes`, default 60, admin settings). This change reads that column on office Home and the day board.
- "Airport Ride with `landing_at` shows silent alarm after landing + duration + 60 min" is `landingAt + transferDurationMinutes`, then `now >=` that end plus a fixed 60 minutes, only while the Ride is in progress.
- "Ride without `landing_at` still uses #163 rule only": no landing means the alarm stays off; the unclosed mark stays pickup plus 60 minutes.
- "Mark is display-only; no action blocked": text on the in-progress list and the day-board state cell. It does not gate done, no-show, cancel, or assignment.
- "Shown on office Home / day board for admin and dispatcher": both routes already allow only those roles; the Home snapshot is the same for both.
- "ADR written and linked; no real mail from tests": ADR-0030 is accepted and listed in `docs/adr/README.md`. Tests use the fake mailer and do not set Resend.

**(b) Scope creep:** none. No push, SMS, #163 threshold change, or hotel/address 25-minute no-show.

**(c) Implemented but wrong:** none. The alarm instant is included (`>=`). Changing the duration moves only the landing alarm. A Ride can show both marks. Waiting, unassigned, and finished Rides do not take the alarm.

**ADR-0027:** not contradicted. A stored landing still does not move the unclosed mark.

**ADR-0029:** not contradicted. The alarm reads the same transfer-duration column. The extra 60 minutes are fixed, not a second duration. Occupation code is untouched.
