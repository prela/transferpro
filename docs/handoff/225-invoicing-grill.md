# 225 Invoicing grill

Out of scope: code, migrations, and the certified-intermediary module (own CIUS-HR UBL, provider adapters, other countries), which is post-v1.

## Decisions

- #206 step 27 is a grill. It produced ADR-0051, the glossary terms, and the #225 finding. The spec and the tickets are issues, not files; the spec draft left `docs/handoff`.
- v1 invoices go through the Tenant's current tool behind the invoicing port. The repo names neither the tool nor the Tenant, and says nothing about the first Tenant beyond using a tool of its own.
- The finding lists only the official intermediary register. It assesses no vendor and gives no fine amounts.
- ADR-0051 partially supersedes ADR-0015 (invoicing settings audit field names only), ADR-0036 (the issuer, and the Transfer reference unique only among invoices not cancelled or withdrawn), and ADR-0039 (Pozornost holds Warnings for invoices and a reminder not attached to a Ride). `docs/agents/working-rules.md` follows ADR-0015's narrowing.
- Invoicing does not wait on #206 step 26: the line takes the Transfer price, gross, which the step 26 snapshot keeps.
- Two references stay apart: the Transfer reference (the Transfer id, with the partial unique key) and our reference (the invoice id, in the notes, used for a lookup in the current tool).
- After the code review, these were fixed: the first-Tenant wording (the 25% sentence, the eRačun sentence, and "one eRačun channel"); the tool's identifying limits in Context; the ADR-0015 and ADR-0036 supersessions; the step 28 three facts; the step 26 line; 403 for settings and storno; always polling for a storno; the lock wording; the OIB and VAT id wording; the glossary's time zone, withdraw condition, and domestic storno; the source numbering; and the foreign-agency fiscalization marked open.
- Kept as they are, after the review: the post-v1 line names EN 16931, eSLOG, and Peppol because the owner asked for them; the reminder runs only while the Tenant has a sent invoice to a Croatian Client, since without one there is nothing to report; ADR-0033's pilot acceptance reads as an invoice created through the current tool, as ADR-0036 already rereads ADR-0033; the glossary entries stay a little over two sentences where a v1 limit is part of the term; the reminder window is in both the ADR and the glossary, as every other term is.

## Code review

Pasted verbatim, except where marked redacted, and one commit hash that now reads "an earlier commit": this branch rebuilds the reviewed content on `develop` without the earlier commits.

## Standards

The review found two hard violations, both about how ADR-0051 handles earlier ADRs. Everything else is a judgement call. No banned name, vendor name, client name, or key appears in the diff, and the research finding lists only the official register.

**Hard violations**

1. **ADR-0051 contradicts a sentence in ADR-0036 without listing it under Superseded.** This breaks the `docs/adr/README.md` rule that "an accepted ADR is not edited, it is superseded" and the AGENTS.md rule "Do not contradict one".
 - ADR-0036 says: "the Transfer's id as an opaque reference. That reference is unique per Tenant, so a repeated request returns the same invoice … a Transfer's invoice is read by its reference."
 - ADR-0051 says: "The notes carry our reference, which is the invoice's id". It also allows a new invoice for the same Transfer after a storno.
 - Under ADR-0051, the Transfer id is no longer unique per Tenant among invoices, and a repeated request does not return the same invoice. ADR-0051's own Context still repeats ADR-0036's version.
2. **The audit rules now disagree with `docs/agents/working-rules.md`.** That file says: "Entry data holds … for a settings change, the from/to values (ADR-0015)". ADR-0051 records invoicing settings by field names only and says "ADR-0015's values cover the Tenant settings of `tenancy`, not these." That narrows ADR-0015 in a sentence, but ADR-0015 is not in the Superseded section and working-rules was not updated.

**Judgement calls**

- **The glossary format is not followed** (`GLOSSARY-FORMAT.md`: "One or two sentences max. Define what it IS, not what it does").
 - **Invoice** has five sentences.
 - **Storno** includes the rule "Only an Admin asks for one."
 - **Current tool** reads "It numbers, fiscalizes, sends, and keeps …".
 - The existing **Audit entry** entry sets a loose precedent, so this is soft.
- **Terms are used inconsistently across the three documents.**
 - The glossary avoids "credit note", but the research says "a storno or a credit note".
 - The term is "Storno" in the glossary and "storno" in ADR-0051 and the research.
 - "Unique key on the reference" in ADR-0051 is ambiguous (Mysterious Name): a unique key on the invoice's own id cannot enforce one live invoice per Transfer.
- **Duplicated Code: the same facts are written in several places and can drift.**
 - The window "from the 15th to the 20th" is in both ADR-0051 and the glossary. An earlier commit already had to fix it.
 - The tool limits [values redacted for the public repo] appear in ADR-0051's Context and again in its Consequences.
 - The archive periods (6, 10, and 11 years) appear in the research Summary and again under Archive.
 - **Current tool** and **Fiscalization provider** have almost the same definitions ("numbers, fiscalizes, … keeps").
- **The public-repo rule is at risk in ADR-0051's Context.** It names no product, but this exact set of limits could identify the vendor: [list redacted for the public repo]. Consider keeping only the limits the Decision depends on.
- **Speculative Generality in ADR-0051 "After v1"** ("other countries follow (EN 16931, eSLOG, Peppol)"). It goes beyond v1 scope (AGENTS.md: "Stay inside v1 scope"). One line pointing to post-v1 would be enough.
- **ADR-0033 is reread without being superseded.** ADR-0051 says ADR-0033 "stands", yet changes its pilot acceptance from "issued through the provider" to "created through the current tool". The repo has done this before ("reads as" in ADR-0036), but here the meaning changes, because a created invoice may still be unsent.
- **The research Summary states as fact what open point 1 says is unconfirmed.** It says a foreign agency gets "no fiscalization", while open point 1 says no tax-authority answer covers this case.
- **The research source tags skip S8, S9, S14, and S16.** It reads like sources were removed. Renumber them or say why they are gone.

## Spec

**(a) Missing or partial**

- **Step 28's three facts.** The owner decision says: "step 28 proves three facts … the gross total, the lookup by our reference, and the storno's negative invoice. If one fails, stop and re-grill." ADR-0051 Consequences names only the gross price as the stop condition. The lookup and the storno facts are missing.
- **Step 26.** The owner decision says: "Invoicing does not wait on step 26 … step 26 turns into a snapshot." The ADR does not mention step 26. It says "Step 24 inherits that meaning" instead.
- **Settings are Admin only.** The owner decision says: "Invoicing settings and the token are Admin only." The ADR only says "An Admin keeps the invoicing settings". It never says that a Dispatcher is refused. Issuing has an explicit 403 line; the settings have none.
- **Reminder time zone in the glossary.** The owner decision says: "from the 15th to the 20th of each month, in the Tenant's time zone." The ADR has the time zone. The glossary entry for Payment-reporting reminder leaves it out.
- **Withdraw in the glossary.** The owner decision says: "withdraw a failed invoice after a lookup confirms the current tool never created it." The ADR is correct. The glossary entry for Failed invoice says only "an Admin withdraws it" and drops the lookup condition.

**(b) Not asked for**

- **A condition on the reminder.** The ADR adds "while the Tenant has a sent invoice to a Croatian Client". Decision 12 sets no such condition.
- **A new reading of ADR-0033.** The ADR says "ADR-0033's pilot acceptance reads as a real invoice created through the current tool…" and also "step 35 decides how the privacy documents name it". This changes how an ADR-0033 sentence is read while saying "ADR-0033 stands", and no owner decision covers it.
- **Payment correction.** The ADR says "Correcting the payment to `invoice_to_agency` … makes the Transfer invoiceable." This is harmless but was not decided.
- **A storno counts as an unsent invoice.** The glossary entry for Unsent invoice includes a Storno. Decision 8 does not. The ADR limits this to a *domestic* storno, while the glossary entry says any storno, so the two disagree.

**(c) Present but looks wrong**

- **Confidentiality.** [Quotes redacted for the public repo.] Two ADR-0051 sentences about the first Tenant, read with the finding's table, reveal a fact about the first Tenant that must stay out of the repo. Use "25 to start" and drop the Tenant-specific wording.
- **What frees a locked Transfer.** Decision 5 says the Transfer is locked "until a storno or a withdraw". The ADR says "A storno is the only way to free those three fields." This contradicts the decision, even though a failed invoice is already outside the locking states.
- **Storno polling.** Decision 10 says the storno is "called once; the negative invoice is then found by polling." The ADR says "after an unknown outcome, the status job looks for the negative invoice". That reads as polling only after a timeout. Because the tool returns no id, the ADR should say polling always runs.
- **OIB and VAT id.** The glossary says "the OIB or a VAT id". The ADR says the OIB is "required when the country is Croatia" and the VAT id is "(optional otherwise)". The glossary reads as either one, and the ADR's "optional otherwise" is unclear. The spec draft says the VAT id is always optional.

These owner decisions are recorded and consistent across the ADR, glossary and research finding:
- the gross price at 25%;
- issuing by Admin and Dispatcher;
- the guest-name checkbox starting off;
- the token under AES-256-GCM with `INVOICING_SECRET_KEY` and the Tenant id as associated data, write-only;
- all five issuing safeguards: the attempt written before the call, one create in flight per Tenant, creates at least 10 seconds apart, a lookup by our reference after a timeout, and retries after 1, 5, and 30 minutes;
- `INVOICING=none` as the default;
- a vendor-neutral finding that lists only the official register, with both accountant points;
- status lines and index rows for ADR-0036 and ADR-0039.

No vendor or Tenant names appear in the diff.
