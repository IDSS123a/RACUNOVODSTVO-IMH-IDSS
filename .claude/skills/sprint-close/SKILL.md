---
name: sprint-close
description: Commander sprint close-out — Done Checklist, lessons consolidation, compliance score, handoff note, commit. Invoke at the end of every sprint (/sprint-close).
---

# Sprint Close-Out (M-13, M-18, DONE_CHECKLIST)

1. Fetch and run the full Commander `DONE_CHECKLIST.md`
   (raw.githubusercontent.com/IDSS123a/commander/main/DONE_CHECKLIST.md).
   Report each item PASS or FAIL. Fix every FAIL, then re-check it.
2. Consolidate `corrections/SPRINT_[current]_LESSONS.md`: merge
   duplicate entries, sharpen wording, and ensure the three summary
   sections exist at the top — `## Corrections Applied`,
   `## Gotchas Discovered`, `## Commander Improvement Candidates`
   (write "None this sprint." where a section is empty).
3. Fill in the Commander Compliance score per DONE_CHECKLIST.md.
4. Commit the lessons file: `docs: sprint XX lessons learned`
5. Write the handoff note. Include the line:
   "Lessons captured: [N] entries in corrections/SPRINT_XX_LESSONS.md".
