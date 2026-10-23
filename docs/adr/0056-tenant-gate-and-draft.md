# Tenant gate, switch, and the per-Tenant draft

Status: accepted

Accepted on 23 October 2026 in the #309 grill. It partially supersedes ADR-0038; the sentences are named below. ADR-0011 stays: a session carries one active Tenant and exactly one role. ADR-0019 stays for the superadmin, including the separate account and the eight-hour cap. ADR-0042's way back after a fresh sign-in is this gate. ADR-0057 decides how long the session lasts.

## Context

A person can already accept an invitation to a second Tenant. A fresh session has no active Tenant. One membership is selected on its own. Two or more memberships are refused, so that person lands on the no-access screen after every new sign-in, and again after a password change or a reset. The route that sets the active Tenant exists, and no screen calls it.

ADR-0038 has one sign-in for everyone and no Tenant picker. The profile trigger shows the Tenant name on the desktop and only the initials on the phone. An unfinished Transfer stays in the browser, keyed by user and Tenant, and sign-out removes it.

The pilot needs one person to work in more than one Tenant, one at a time, and to see only that Tenant's data. The active company has to stay visible. Remembering the last Tenant was refused for v1: an explicit choice on each fresh session is the guard against entering a Ride into the wrong company, and it adds no stored state. Working in two Tenants at the same time is a later idea.

The alternatives were a gate only, with no switch until sign-out; a menu only, including the first choice; remembering the last Tenant on the account or on the device; one shell that unions the roles; and letting the superadmin account also be a Member.

## Decision

We will let one person be a Member of more than one Tenant, choose the active Tenant on a fresh session, and switch it from the profile menu. The unfinished Transfer stays with the Tenant it was typed in.

### One person, several memberships

A person may be a Member of more than one Tenant. Each membership is one person in one Tenant with one role: admin, dispatcher, or driver. A second role on the same membership is still refused. The active membership is the only source of the Tenant and the role. Permissions are never the union of memberships. The shell is that role's shell: a Driver lands on their Rides, and office staff land on Home. Settings stay Admin only, and only while the Admin membership is active.

The platform superadmin stays a separate account with no membership. A Member's sign-in never opens the platform screen. ADR-0019 is unchanged on that split.

### The gate

There is still one sign-in for everyone. After it, a session with no active Tenant and two or more working memberships shows a gate before any Tenant data. The gate lists each company and the role the person has there. A deactivated Tenant is not listed, on the gate or in the profile menu. When the list has one company, that company opens and the gate stays hidden. When it has none, the no-access screen stays.

The choice is not remembered. Every fresh session with two or more working memberships shows the gate, including the session after a password change or a reset. A session that already has an active Tenant opens that Tenant, including the next morning while the session is still valid. Accepting an invitation still opens the new Tenant, because that session already has an active Tenant.

### The switch

The profile menu switches Tenant without signing out, on the office shell and on the driver phone. The active Tenant's name is visible without opening the menu: on the desktop as today, and on the phone as well, not only the initials. The driver phone keeps the name in the header.

Switching drops what is on screen and the live refresh of the Tenant they left. One session has one active Tenant, so another tab cannot keep acting as the Tenant that is no longer active.

When the active membership is removed, or that Tenant is deactivated, the no-access screen and its sign-out stay. The next sign-in follows the gate. A deactivated Tenant is never a choice.

### The draft

An unfinished new Transfer stays in the browser, keyed by user and Tenant, for 24 hours. It is never sent to the server except for the entry key on create, as today. Switching away leaves the draft under its key. Switching back offers it. A draft is never restored or saved into another Tenant. A save belongs to the session's active Tenant.

Pressing sign-out deletes the draft of the active Tenant only. Save and discard still delete it. An idle end and the twelve-hour office end do not delete it. Those ends are ADR-0057.

### Superseded

In ADR-0038, "no Tenant picker" in "There is one sign-in for everyone and no Tenant picker." One sign-in for everyone stands. After the gate, or when the gate is not shown, office staff still land on Home, a Driver on their Rides, and the Superadmin on the platform.

In ADR-0038, "and the initials on the phone" in "Its trigger shows the initials and the Tenant name on the desktop, and the initials on the phone." The phone shows the Tenant name as well. The page body still does not repeat it.

In ADR-0038, the draft "is removed on save, on "Odbaci", and on sign-out." Save, discard, and pressing sign-out still remove the active Tenant's draft. Switching, an idle end, and the twelve-hour office end do not. Sign-out does not remove another Tenant's draft.

## Consequences

A person with two companies picks one after each new sign-in and can change company from the menu. The other company's Rides, Clients, and settings stay unreachable. A shared office computer does not keep the last company for the next session, and pressing sign-out still removes the active Tenant's unfinished Transfer.

The draft of the other Tenant can remain in the browser until it is 24 hours old. The key includes the person, so another person's sign-in does not recall it.

No column stores a last Tenant. The active Tenant remains the one on the session.
