# 260 Duplicate, return journey, and print the day

No server change and no migration. Duplicate and return only prefill the Transfer form. Print is styling.

## Decisions

- A duplicate copies the booking, including the pickup in the Tenant time zone, and drops the Transfer id and the Ride id.
- A return swaps from and to. It keeps the Client, Client reference, guest, passengers, luggage, child seats, and payment. Time, flight number, tabla, price, note, and the airport mark start empty.
- The prefill replaces any browser draft and is stored as that same draft, so a reload does not bring the previous unfinished entry back. The server still sees nothing until save.
- "Ispiši dan" prints every Ride of the loaded day, not the filtered rows. Groups are Vehicles ordered by earliest pickup. Unassigned Rides are last. The sheet is teleported to `body` and uses written light colours. The print rule only hides the page when that sheet is present.

## Changed specs

- `e2e/correct-transfer.spec.ts` — a cancelled Ride used to have no actions button. It now has Dupliciraj and Povratni transfer, and still has no Ispravi transfer.
- `e2e/duplicate-return-print.spec.ts` — new. A return saved from the detail is a second Transfer with no id link. Print in the dark theme is light, grouped, with unassigned last, in Croatian and English.

e2e was not run in this session: another agent is using the machine.
