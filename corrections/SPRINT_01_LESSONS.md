# Sprint 01 — Lessons Learned
Date: 2026-10-20 (bootstrap + business-rule analysis, before Sprint 01 implementation)

## Corrections Applied
- Read IMH Pravilnik 2026/27 art. 4 ("3.+ child exempt") as a binding rule and treated it as a conflict with the Director's rule → the Director corrected it: the only truth is −20% for every subsequent child, no child is free → recorded as D2 and in CONSTITUTION BR-4. Rule: M-4 (a document text is not automatically the institution's rule; confirm with the Director).
- Used a draft rulebook recovered from git history (deleted on purpose) as a source → the Director ordered it ignored → D8. Rule: M-4 / M-10 (a file deleted on purpose by its owner is not a source).
- Proposed counting "subsequent child" across IMH and IDSS (legacy Excel did this) → IMH and IDSS are separate legal entities; the discount always goes to the younger child within the same entity → BR-6. Rule: M-3 (institution rules first).
- Assumed the subsidy reduces what the parent pays → the parent always pays the full invoice; IMH invoices the ministry monthly and refunds parents → BR-16/17.

## Gotchas Discovered
- Law PDFs in repo `porodice-3plus` use custom font encodings, so text extraction returns garbage → resolved by rendering the pages to images and reading them visually.
- `pdftotext` cannot open file names containing `Š` on Windows Git Bash → copy the file under an ASCII name via Python first.
- GitHub CLI `gh` is not installed on the Director's machine → the GitHub repo cannot be created from the session; the Director creates it by hand (one step).
- The IDSS Pravilnik 2026/27 contains template leftovers: heading year 2025/2026, account reference "član 4" (it is in član 3), footer address Buka 11 (IMH's address) → institution master data is taken from the official letterheads instead.

- `npx tauri init` (CLI 2.12) generates `rust-version = "1.90"` and `edition = "2024"`, but the machine has Rust 1.83 → `cargo build` cannot run yet; `rustup update stable` is the first task of Sprint 01.
- npm 11.17 blocks dependency install scripts by default ("allow-scripts", e.g. esbuild postinstall) → `vite build` still works via the prebuilt platform package; keep an eye on it if native packages misbehave (`npm approve-scripts`).
- `npm create vite` rejects a folder name starting with `__` as a package name and silently waits on a prompt → use a valid package name for the temp folder.
- Zod 3.25.x is installed — Commander E-2 named pitfall (`.default()` + `z.infer`) applies; hand-write interfaces where defaults are used.

## Commander Improvement Candidates
- INITIAL_INSTRUCTIONS Step 3 assumes `gh` is available. Add an explicit fallback check (`gh --version`) as the very first scaffold step, so the Director's one manual step is asked up front, not discovered mid-run.
- M-4: add a "Learned from" note — a document deleted from a repository on purpose by its owner must never be restored from git history and used as a source without asking.
