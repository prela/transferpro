# A Vehicle seat count and a passenger warning

Status: accepted

The product owner decided this in #545. It partially supersedes ADR-0034: the sentence "A Vehicle has no seat count in v1" and the consequence "A Transfer for more guests than a Vehicle seats is not caught." Capacity stays about time. ADR-0054 stands: a group too large for one Vehicle is a main Transfer and its extra vehicles. ADR-0058 stands: stops and an escort are a later feature, and an escort is not a passenger.

## Context

ADR-0034 kept capacity to time, so a Vehicle had no seat count and the office could assign a Vehicle that cannot carry the Ride's passengers. During testing a Transfer for more passengers than one vehicle holds was assigned to a single Vehicle with no sign of a problem. Suggesting another Vehicle, or refusing the assignment, would decide the split for the office. The owner asked for the minimum: a count on the Vehicle and a warning.

## Decision

A Vehicle records a maximum passenger seat count, not counting the Driver. The lowest allowed value is 1. The count is required when a Vehicle is created or saved. A Vehicle that already exists keeps an empty count until the office fills it. An empty count shows no warning.

When a Ride's passenger count is greater than its Vehicle's seat count, the office sees a non-blocking warning in the assign dialog, on the board row, and on the Ride detail. The warning suggests adding an extra vehicle, as text only. The assignment still saves. No confirmation is asked. Done, a no-show, and a correction are not blocked. The capacity judge is unchanged. A correction that raises the passenger count shows the warning again, because the comparison is made when the screen is read.

The audit entry for the Vehicle records the field name `seatCount` and not the number.

## Consequences

The office can see that one Vehicle is too small before the guests are left standing, and can still assign that Vehicle. An old Vehicle with no count stays quiet until the office fills the count, so the warning does not appear for the whole existing fleet on the day this lands. Capacity still does not count seats, and nothing proposes a second Vehicle.
