# GLOSSARY.md — Transferpro glossary

Ubiquitous language for Transferpro. Seeded from `CHARTER.md`; every entry is **draft** until crystallized via grill-with-docs.

- **Tenant** — a transfer/taxi company using Transferpro; = Company = Better Auth organization. *(draft)*
- **Transfer** — the booking. *(draft)*
- **Ride** — the execution of a Transfer; one Transfer may have several Rides (legs). *(draft)*
- **Driver** — person who drives a Ride; sees only own Rides. *(draft)*
- **Vehicle** — vehicle assigned to a Ride together with a Driver. *(draft)*
- **Partner** — subcontractor company a Ride is handed to. *(draft)*
- **Client** — agency, hotel, or individual who books a Transfer. *(draft)*
- **BookingSource** — port through which bookings are imported (manual, email, platforms). *(draft)*
- **ExternalRef** — `source` + `external_id` identifying an imported booking; makes import idempotent. *(draft)*
- **No-show** — the guest did not appear for a Ride; exact definition still open. *(draft)*
- **Dispatcher** — office staff/owner who manages Transfers, Rides, and assignment. *(draft)*
- **Work package (WP)** — unit of planned work (`0.1`, `1.2`, …); one branch, one PR. *(draft)*
- **Charter** — `CHARTER.md`, the owner-locked project charter. *(draft)*
