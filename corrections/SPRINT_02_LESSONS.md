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
