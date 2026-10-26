# Office and driver session lengths

Status: accepted

Accepted on 23 October 2026 in the #309 grill. It partially supersedes ADR-0019; the sentence is named below. The superadmin half of ADR-0019 stands, including the separate account, the eight-hour cap, and that a refresh cannot stretch a superadmin session. ADR-0011 stays. ADR-0056 decides the gate, the switch, and the draft. ADR-0022's meaning of in progress stands, narrowed below to the current operational day. Coupling the session to any further driver or vehicle duty state is a later ticket.

## Context

A Tenant member's session lasts seven days, and a refresh extends it. A superadmin session lasts eight hours from sign-in, and a refresh cannot stretch it. Seven days is too long for a person who works in two companies: a still-valid session skips the gate and opens yesterday's company.

The pilot asked for a member session under 24 hours. An office shift and a driver night shift are not the same length of quiet. A night shift runs about 9 to 12 hours. A board left open refreshes every 60 seconds while the tab is visible, so a clock that treated every request as use would never go idle.

The alternatives were one clock for both roles; an idle clock only; an absolute clock only; signing a Driver out during a Ride; and letting a live refresh reset the office idle clock.

## Decision

We will end a Tenant member's session on the active membership's cap, measured from sign-in, and we will not let a refresh extend that cap.

The cap that applies is the cap of the active membership, measured from this sign-in. A refresh does not extend a membership past its cap. Use does not extend the absolute cap. The superadmin clock is unchanged.

### Office

An Admin or a Dispatcher session ends 12 hours after sign-in. It also ends after 30 minutes without a person's action. Typing, a click, or a command resets that idle clock. A live refresh does not. Whichever end comes first signs them out.

The absolute end is enforced on the session. The idle end is enforced in the browser, so a board left refreshing still signs out. The clock is one for every tab of that sign-in: a person's action in any visible tab resets it for all of them, and the end signs every one of those tabs out. There is one shared idle clock for all tabs, but when the shared write throws, or storage and BroadcastChannel are both blocked, each tab keeps its own clock. A hidden tab does not count as a person's action.

About 15 minutes before the 12-hour end, the office is warned. The warning does not sign them out, and they keep working until the cap.

Switching to an office membership after this sign-in has already passed 12 hours ends the session. The person signs in again.

### Driver

A Driver session ends 12 hours after sign-in. There is no idle sign-out.

A Ride holds the session past 12 hours only while it is in progress and its pickup falls in the current operational day. In progress is ADR-0022: the Ride has a Driver, it is not done, a no-show, or cancelled, it is not waiting on acceptance, and its pickup is already in the past. An unclosed Ride from an earlier operational day does not hold the session. An accepted Ride whose pickup is still in the future does not. A must-accept Ride that is still waiting on acceptance does not.

While any such Ride is in progress, the session lasts until every one of them has ended, or until 16 hours from sign-in, whichever comes first. Ended means done, no-show, or cancelled, including when the office marks it. The 16-hour cap signs the Driver out even during a Ride. When the holding Ride ends before that cap, the next use is refused and a new sign-in is required.

The Driver phone warns about 30 minutes before the 12-hour mark. When a Ride is holding the session, that warning says so, and a second warning comes about 30 minutes before the 16-hour cap. If the Ride ends first, the session ends then and the second warning is not shown. Both warnings are a banner. They do not block the screen and they do not need a tap.

The deferral is decided when the session is used. Tenancy asks, through a port, whether this Driver has a holding Ride. It does not import the transfers module. A Ride in another Tenant does not hold the session.

Switching away from the Driver membership stops the deferral. The membership they switch to uses its own cap from the same sign-in.

### What an end does to the draft

An idle end and the 12-hour office end keep the unfinished Transfer, as ADR-0056 says. Pressing sign-out still deletes the active Tenant's draft. Neither end remembers the Tenant for the next sign-in.

### Superseded

In ADR-0019, "A tenant member's session is unchanged." A Tenant member's session is no longer the seven-day session, and a refresh no longer extends it to seven days. In "a refresh cannot stretch it to the normal 7 days," the superadmin rule stands and the seven-day member session does not. The eight-hour superadmin cap, the trigger, and the separate account stand.

## Consequences

A still-open office board signs out after 30 quiet minutes, and a session cannot outlive its absolute cap by refreshing. A Driver on a night shift is not signed out during today's in-progress Ride, and is never kept past 16 hours.

The idle clock is the open screen. A client that never signs out still dies at the absolute cap. A read-only wall display, and any session rule tied to a duty state other than the holding Ride above, are later tickets.
