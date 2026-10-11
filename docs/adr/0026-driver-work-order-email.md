# Driver work orders by email

Status: accepted

Damir accepted this on 11 October 2026. This does not supersede ADR-0009, ADR-0020, or ADR-0023.

## Context

A Driver does not hear about a Ride except by opening the phone list. Nikša asked for a work order by email when a Ride is assigned, changed, reassigned, or cancelled, and for a phone message as well when pickup is inside 8 hours. The Driver row has a phone and an optional member link, and it has no email. The sign-in email lives on the account. The tenant-scoped role cannot read that account table. Invitation mail already goes through a mailer port (ADR-0013). ADR-0009 and ADR-0020 show the Driver a price only for cash, and hide card and invoice-to-agency. ADR-0023 sends no mail for the unassigned alarm. Issue #8 leaves email, SMS, and push out of dispatcher alerts.

The alternatives were a second email the office types even for a linked Driver, an SMS or WhatsApp message inside 8 hours, a card or voucher mark so a non-cash Ride still has a payment line, and rolling the Ride back when the send fails.

## Decision

We will send a work order by email only. One notification port has a single adapter in v1, the existing mailer, from `Transferpro <noreply@transfers.prela.net>`. SMS, WhatsApp, and PWA push are later adapters on that port. There is no night quiet period and no scheduled send at 8 hours. ADR-0023 is unchanged: the unassigned alarm still sends no mail. Dispatcher warnings still send no mail.

A Driver has one email. When the Driver has an account, that email is the sign-in email, it is required, and the office does not type a different one. Linking an account copies the sign-in email over whatever was stored. Removing the link leaves the address in place and the office may then edit or clear it. When the Driver has no account, the email may be blank, and a blank address sends nothing. There is no screen in v1 to change a sign-in email. Any later change of that address updates the linked Driver email in the same write. The copy uses the privileged path that already reads the sign-in email. The tenant-scoped role never reads the account table to send. The send reads the Driver email.

The office sees one result per Driver on the action that saved the Ride: sent, no email, or send failed. The Ride stays saved when the send fails. The send is not retried. The action waits for the attempt. Audit records the Ride change as it does today. It does not record the address, and it does not gain an "email sent" entry. A Driver change still does not record the email. Logs do not record the address, the guest, the places, or the tabla.

The mail is in the Tenant's default locale and the Tenant's time zone. Its subject is the status, the departure time, and the pickup place. The body starts with the status: assigned, changed, cancelled, or no longer yours. It then states the departure, the pickup, the drop-off, the guest name, the tabla, the passenger count, the luggage count, the child-seat count, the flight number when one is recorded, the client, the vehicle name and plate, and the note. On assigned and changed, a cash Ride also states the price and that payment is cash. Cancelled and no longer yours state no price. Card and invoice-to-agency have no payment line. ADR-0009 and ADR-0020 stay as they are for the Driver's phone.

One successful action sends one mail to each affected Driver, after the Ride has saved. Assign and the new Driver on a reassign use assigned. Clear, and the previous Driver on a reassign, use no longer yours. Cancel uses cancelled. A real change uses changed: pickup time, pickup place, drop-off, flight number, guest name, passenger count, luggage, child seats, airport mark, tabla, note, vehicle, client, payment method, and the price while payment is cash. A save that changes none of those sends nothing. Decline, done, no-show, and a landing-time change send nothing. A Ride with no Driver sends nothing. A change that returns an accepted Ride to assigned still uses changed. The mail does not ask the Driver to accept, and it has no link.

## Consequences

An External Driver with a blank email can be assigned, and the office sees that no work order was sent. A linked Driver cannot be given a different address from the sign-in email. A card or invoice-to-agency Ride, and a switch from one to the other, can produce a changed mail whose body matches the previous one. An airport-mark-only change can do the same. Removing cash removes the cash line and adds no sentence in its place. The 8-hour phone message is not built. Adding it is a new adapter, not a second sender.
