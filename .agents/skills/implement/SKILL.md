---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

A local agent that is told a branch name and is not already on it runs `git fetch origin` and then `git switch -c <branch> origin/develop`, before any edit. If the branch already exists, stop and report; never switch to it.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.
