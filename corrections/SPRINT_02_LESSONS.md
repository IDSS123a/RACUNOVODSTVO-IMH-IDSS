# Sprint 02 — Lessons Learned
Date: 2026-10-21

## Corrections Applied
- The Director asked whether "desktop app on the operator's computer only" was understood → confirmed. The deployment target is now written explicitly into the CONSTITUTION (§1 Deployment) and memory, so no later sprint drifts toward cloud hosting. Rule: M-4 (make implicit institutional constraints explicit).
- A shell `cd` into `src-tauri` persisted between commands, so a heredoc append with relative paths silently failed (nothing written) → re-ran with absolute paths. Use absolute paths in multi-step shell edits.

## Gotchas Discovered
- `tauri build` downloads NSIS and `nsis_tauri_utils` from GitHub (tauri-apps releases, hash-validated) on the first build. This needs internet once on the build machine; record it for offline build machines.
- The installers are unsigned → SmartScreen warns on the operator's PC. Documented in docs/UPUTSTVO-ZA-INSTALACIJU.md. Code signing is a later decision (it costs money: a certificate is needed).
- react-refresh lint warns when a component file also exports factories → moved `new*` factories into `families/factories.ts`.

## Commander Improvement Candidates
- None this sprint.

### 2026-10-21 — Leftover dev server
- When the Director closed the app window, `tauri dev` ended but its Vite child (port 5173) kept running, so the next `tauri dev` failed with "Port 5173 is already in use" → identified the PID as our own `vite.js` from this project before killing it. Gotcha: verify ownership (command line) before killing a process on a shared machine.

### 2026-10-21 — Director walkthrough feedback
- The form allowed two mothers → added a rule (max one MOTHER and one FATHER; others are GUARDIAN) in the domain and the form. Rule: M-4 (the ACA had not asked about family composition; the Director's walkthrough caught it).
- "Platilac" was misleading (the Director asked "what if another family member pays?") → renamed to "Kupac na računu". The help text explains that any family member may pay. Lesson: label accounting roles by what they mean on the document (invoice addressee), not by who sends the money.
- The IBAN check rejected `BA39_1994990021809884` because of the underscore → separators (space, -, _, .) are tolerated, and IBANs are stored in the canonical 4-digit grouping. The IBAN stays optional (needed only for subsidy refunds to BiH citizens).
