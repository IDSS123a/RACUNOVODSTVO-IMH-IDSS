---
name: commander-audit
description: Annual Commander Audit per M-19 — reviews every rule for status, usage, severity, overlap, and deprecation. Invoke once per year or after every 5 completed projects (/commander-audit).
---

# Commander Audit (M-19)

Read all Commander documents at github.com/IDSS123a/commander, then for
EVERY rule (M-XX, E-XX, C-XX) run the five checks:

1. **STATUS** — still `[ACTIVE]`? Has the ecosystem (libraries, APIs,
   frameworks) made it outdated?
2. **USAGE** — was it triggered in the last 3 projects' `corrections/`
   folders? (Project list: PROMPT_LIBRARY/commander-audit.md —
   maintained there, not duplicated here.)
3. **SEVERITY** — is 🔴/🟡/🟢 still accurate? Upgrade repeat-violation
   rules; downgrade never-triggered ones.
4. **OVERLAP** — can it be consolidated with another rule?
5. **DEPRECATION** — should M-17 retire it? With what replacement?

**Governance/product ratio (no extra session cost — computed only
here):** for the commander repo and each audited project repo, run
`git log --since <date of last audit> --oneline | wc -l` and report
`commander commits : sum(product commits)` as one line in the AUDIT
REPORT. Exclude any project repo whose history was reset/rewritten
since the last audit (note it by name with the reason instead of
computing a misleading count from it).

Produce the AUDIT REPORT in the format defined in
PROMPT_LIBRARY/commander-audit.md (counts, severity changes,
deprecations, consolidations, new rules, ready-to-append AUDIT_LOG.md
entry). **Wait for Director approval before changing anything**, then
follow the post-audit checklist in that same file.
