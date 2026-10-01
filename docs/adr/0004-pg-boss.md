# Job queue: pg-boss on Postgres

Status: accepted

## Context

v1 needs scheduled work, starting with the dispatcher warning for Rides that are still unassigned or not accepted before pickup. Redis with BullMQ is the usual queue, and it adds a second datastore to back up and restore. An in-process timer dies with the process and does not survive a restart. Other Postgres queues exist. The owner locked the library while charting the v1 decision set, rather than leaving "pg-boss or similar" open.

## Decision

We will run background jobs with pg-boss on the same PostgreSQL instance. v1 will not use Redis. Jobs will be reached through a port. Domain and application code will not import pg-boss.

## Consequences

A job and the Ride change it follows can commit together, and the queue is included in the Postgres backup. There is no Redis to operate. Throughput is bounded by that one database, which is enough for a Tenant with about twenty Rides a day. Choosing a different library later means a new infrastructure adapter and a migration of queued jobs.
