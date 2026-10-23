# Spec: Tenant choice for a person with two Tenants

Parent: #309. Decision records: ADR-0056 and ADR-0057.

## Problem Statement

A person who belongs to two companies can sign in, and then cannot work. A fresh session has no active Tenant. One membership is chosen on its own. Two or more memberships are refused, so every new sign-in, password change, and reset ends on the no-access screen. Nothing on the screen chooses the company, and the phone does not show the company name. A seven-day session would also skip that choice the next morning and open yesterday's company.

## Solution

After sign-in, a person with two or more working memberships picks the company, and sees the role they have there, before any of that company's data. They can switch later from the profile menu without signing out. The company name stays visible, including on the phone. They see only the active company's data, in that membership's role.

An office session ends 12 hours after sign-in, and also after 30 minutes with no person's action. A driver session ends 12 hours after sign-in, unless today's in-progress Ride is holding it, and never lasts past 16 hours. The next fresh sign-in asks again. The unfinished Transfer stays with the company it was typed in.

## User Stories

1. As a person who is a Member of two Tenants, I want to pick the company after I sign in, so that I enter Rides into the company I mean.
2. As that person, I want the gate to show each company's name and my role there, so that I can tell the driver company from the office company.
3. As a person with one membership, I want to land in that company with no gate, so that a single company stays as quick as today.
4. As a person with two memberships, I want every fresh sign-in to ask again, so that yesterday's company is not assumed.
5. As a person with two memberships, I want a password change or a reset to ask again, so that the new session does not skip the choice.
6. As a person whose session is still valid, I want to return to the company already on that session, so that I am not asked again in the middle of the same sign-in.
7. As a Dispatcher in both companies, I want to switch from the profile menu without signing out, so that a booking for the other company does not wait on a new sign-in.
8. As a Driver in one company and a Dispatcher in the other, I want the phone when the driver company is active and the office when the other is active, so that I never see both jobs at once.
9. As an Admin in one company and a Dispatcher in the other, I want settings only while the Admin membership is active, so that the other company cannot be reconfigured from the wrong role.
10. As any Member, I want the active company's name visible on the phone without opening the menu, so that I can see which company I am in.
11. As a Driver, I want the company name to stay in the phone header, so that the list still says whose Rides these are.
12. As a person who switches company, I want the previous company's screen and live refresh to drop, so that I do not keep looking at the wrong Rides.
13. As a Dispatcher, I want an unfinished Transfer to stay with the company I typed it in, so that switching away does not throw it away.
14. As a Dispatcher, I want that draft offered when I switch back, so that I can finish it in the same company.
15. As a Dispatcher, I want a draft from one company to be impossible to save into the other, so that a guest and a price cannot land on the wrong invoice.
16. As a Dispatcher who presses sign-out, I want the active company's draft removed, so that the next person at the desk does not continue it under my sign-in.
17. As a Dispatcher who is signed out for being idle, or because 12 hours have passed, I want the draft kept, so that the next sign-in into that company can offer it while it is under 24 hours old.
18. As a Dispatcher, I want another company's draft left in place when I sign out, so that it is still there if I pick that company next, until it is 24 hours old.
19. As an Admin or a Dispatcher, I want the session to end 12 hours after sign-in even if I am still clicking, so that a long-lived cookie cannot skip the next choice.
20. As an Admin or a Dispatcher, I want the session to end after 30 minutes without typing, clicking, or a command, so that a board left open on a shared computer does not stay signed in.
21. As an Admin or a Dispatcher, I want the board's own refresh not to count as me working, so that a visible tab cannot keep the session alive by itself.
22. As an Admin or a Dispatcher, I want a warning about 15 minutes before the 12-hour end, so that I can finish or switch before the session goes.
23. As an Admin or a Dispatcher, I want that warning not to sign me out, so that I can keep working until the cap.
24. As a Driver, I want no idle sign-out, so that a quiet stretch of a night shift does not drop the phone.
25. As a Driver, I want the session to end 12 hours after sign-in when no Ride is holding it, so that the next shift starts with a new sign-in.
26. As a Driver, I want a banner about 30 minutes before that 12-hour mark, so that I know the phone is about to need a sign-in.
27. As a Driver with a Ride in progress whose pickup is today, I want the session held until that Ride ends, so that I am not signed out while I am driving it.
28. As a Driver with several such Rides, I want the session held until each of them has ended, or until 16 hours from sign-in, so that one finished Ride does not drop another that is still in progress today.
29. As a Driver, I want an unclosed Ride from an earlier day not to hold the session, so that yesterday's open Ride cannot keep me signed in all night.
30. As a Driver, I want a Ride that has not reached its pickup, or that is still waiting on acceptance, not to hold the session, so that only a Ride already in progress today extends it.
31. As a Driver whose Ride is holding the session, I want the 12-hour banner to say so, and another banner about 30 minutes before 16 hours, so that I know the phone will still end.
32. As a Driver, I want those banners not to block the screen and not to need a tap, so that I do not have to leave the road to dismiss them.
33. As a Driver, I want the session to end when the holding Ride ends, even before 16 hours, so that I sign in again before the next job.
34. As a Driver, I want the session to end at 16 hours from sign-in even during a Ride, so that a Ride that runs long cannot keep the phone open without a new sign-in.
35. As a Driver, I want a Ride in the other company not to hold the session, so that the company I am not in cannot extend this one.
36. As a person who switches from Driver to office after 12 hours have already passed, I want the session to end, so that the office cap is not skipped by a driver deferral.
37. As a person whose active membership is removed, or whose active Tenant is deactivated, I want the no-access screen and sign-out, so that I do not keep acting in a company that is closed to me.
38. As that person, I want the next sign-in to show the gate when two or more working memberships remain, and to open the only company when one remains, so that I can still reach a company I belong to.
39. As any Member, I want a deactivated Tenant left off the gate and off the menu, so that I cannot choose it.
40. As the platform superadmin, I want my own account, with no membership, so that the platform screen stays separate from company work.
41. As a Member, I want my sign-in never to open the platform screen, so that company work and platform work stay on different accounts.
42. As a person accepting an invitation, I want to land in the new Tenant, so that joining a company still opens it.
43. As a Dispatcher saving a Transfer, I want the save to belong to the active Tenant only, so that another tab still showing the old company cannot write it into the new one.

## Implementation Decisions

- Tenancy owns the gate, the active membership, and the absolute caps. The active Tenant is the session's active organization, set with the existing set-active call. Nothing stores a last Tenant.
- One membership still carries exactly one role. The shell and the authorization follow that role. Admin and dispatcher stay different. A Driver in one Tenant and an office role in another never share a permission.
- The gate runs only when the session has no active Tenant and two or more working memberships. Working excludes a deactivated Tenant. One working membership opens that Tenant. None leaves the no-access screen.
- A session that already has an active Tenant, including one created by accepting an invitation, does not show the gate.
- Removing the active membership, or deactivating that Tenant, keeps today's no-access screen and sign-out. It does not clear the Tenant inside the same session.
- The office and driver caps are measured from sign-in. Refresh does not extend them, and use does not extend the absolute cap. The cap applied is the active membership's cap. The superadmin eight-hour cap is unchanged.
- The office idle clock lives on the open office screen. A person's action resets it. The live refresh does not. The 12-hour office end is also enforced on the session, so a screen that never signs itself out still stops.
- The driver deferral is decided when the session is used. Tenancy asks through a port whether this Driver has a holding Ride, and does not import transfers. A holding Ride is in progress, in ADR-0022's sense, and its pickup is in the current operational day. Several such Rides hold the session until all of them have ended or 16 hours have passed. A Ride in another Tenant does not count. When the last holding Ride ends, the next use is refused.
- Switching to a membership whose cap from this sign-in has already passed ends the session.
- The unfinished Transfer stays in the browser under the person and the Tenant for 24 hours. Recall and save both require that same Tenant to be the active one. Pressing sign-out deletes only the active Tenant's draft. The idle end and the 12-hour office end do not.
- The office phone shows the Tenant name in the always-visible trigger, as the desktop already does. The driver phone keeps it in the header. The page body still does not repeat it.
- The driver warnings are banners. They do not open a dialog and they do not need a tap. The office warning before the 12-hour end does not sign the person out.
- No new issuer field, and no move of a Transfer between Tenants. The company the Transfer was entered in remains the company that invoices it. The invoicing settings stay one account per Tenant.
- No migration that stores a last Tenant. A member session's lifetime changes so a refresh cannot restore the seven-day member session. The superadmin trigger stays.

## Testing Decisions

A good test shows what a person can see and do, and what is refused. It does not pin a private helper.

The session boundary is the seam for authorization, the gate, the role, the caps, and a refused cross-Tenant save. One sign-in with two memberships gets no Tenant data until a company is chosen. After the choice, the role and the Tenant are that membership's. A Driver membership is refused on an office command, and an office membership is refused on the driver phone's commands. A fresh sign-in does not restore the previous company. A deactivated Tenant is not a choice. Removing the active membership returns no-access until sign-out, and the next sign-in follows the gate. An office session is refused after 12 hours from sign-in, and a refresh does not move that end. A driver session is refused after 12 hours unless a holding Ride in the active Tenant defers it, and is refused after 16 hours even then. Ending that Ride makes the next use refused. The prior art is the existing membership and session tests, including the cross-Tenant refusal.

The browser is the seam for what never reaches the server: the gate's company and role, the company name on the phone, the menu switch, and the draft. Switching away and back offers the same draft. A draft is not offered in the other company and cannot be saved there. Pressing sign-out removes the active company's draft and leaves the other's until it expires. An idle end keeps the draft. A live refresh does not stand in for a person's action on the idle clock. The prior art is the existing sign-in end-to-end spec. Phone and desktop, both themes, and the accessibility check, follow that spec.

## Out of Scope

- Remembering the last Tenant. That can be revisited after the pilot.
- Working in two Tenants at the same time. That is the post-pilot idea #485.
- A read-only wall display.
- Any session rule tied to a driver or vehicle duty state beyond the holding Ride in this spec.
- Which catalogue rows an import loads, what a price-list link means, and importing bookings from an export or from email. Those wait for a separate import grill. When an import is built, it still runs inside the active Tenant, the company column only filters, another company's rows are refused, and a cross-Tenant test is required.
- An issuer chosen per Transfer, a later change of issuer, or a move of a Transfer to the other Tenant.
- Changing the superadmin account, its eight-hour cap, or its lack of a membership.
- A CRM, or any Client, Partner, Location, price, Driver, Vehicle, Transfer, or invoice shared between Tenants.

## Further Notes

ADR-0056 is the gate, the switch, the name on the phone, and the draft. ADR-0057 is the office and driver lengths, the idle clock, the warnings, and the caps. ADR-0011 stays. The superseded sentences are the ones named in those two records.

The glossary sentence for Member is the one this grill settled: one person in one Tenant with one role, and a person may hold several memberships, each in its own Tenant.

The Charter does not forbid two memberships. The superadmin's lack of routine access to tenant data stands.
