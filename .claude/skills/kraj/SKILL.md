---
name: kraj
description: End-of-project Commander update — executes the M-22 KRAJ Protocol. Invoke when the Director types KRAJ (or /kraj) at project end.
---

# KRAJ — End-of-Project Commander Update (M-22)

Execute CONSTITUTION.md M-22 exactly. No other interpretation, no
partial execution, no skipped or combined steps.

1. **COLLECT** — read every file in `corrections/`, the project's
   `DECISION_LOG.md`, and the last 3 sprint handoff notes. If
   `corrections/PATTERNS.md` exists (pre-computed by the
   patterns-detect hook), start Step 2a from it instead of a cold read.
2. **ANALYSE** — (a) rules violated more than once → severity-upgrade
   candidates; (b) rules that slowed work without value → deprecation
   candidates (M-17); (c) problems no rule covers → new-rule
   candidates; (d) project decision-log entries → Commander DL-XXX
   candidates.
3. **PROPOSE** — generate `COMMANDER_UPDATE_PROPOSAL.md` in the exact
   M-22 Step 3 format.
4. **CONFIRM** — present it to the Director and wait for explicit
   "odobri" / "approved". Do NOT edit any Commander file before
   approval.
5. **EXECUTE** — apply approved changes to
   github.com/IDSS123a/commander; update AUDIT_LOG.md and
   COMMANDER_CHANGELOG.md; commit as
   `feat: Commander vX.Y — [project name] end-of-project update`.

Every recommendation must cite specific evidence: sprint numbers,
violation counts, file references.
