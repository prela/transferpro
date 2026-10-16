# 250 Transfer search across days

The command palette stays out. It consumes this read.

## Decisions

- Today and later operational days come first, earliest pickup first. Past operational days follow, newest first. The split is the start of the operational day that contains `now`. The list stops at 20 rows, so a full today-and-later page omits the past.
- The route leaves `now` unset. Tests pass a pinned clock. The query is parsed before a session opens. Guest, Client reference, and flight number are the only match fields. Names come from the catalog modules on the same transaction. Nothing is written, and the query text is not logged.

## Code review

Fixed point `origin/develop`. The reports below are the review of `dbdeae5`.

## Standards

### Hard

None.

### Judgement

None.

## Spec

### (a) Missing or partial

None.

### (b) Scope creep

None.

### (c) Implemented but wrong

None.
