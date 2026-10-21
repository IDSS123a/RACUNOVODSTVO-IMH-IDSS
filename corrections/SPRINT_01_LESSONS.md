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

### 2026-10-21 — Sprint 01 implementation
- 🔄 Course correction (DL-P004): the SQLCipher plan needed OpenSSL and a native Perl build on Windows, neither of which exists → switched to pure-Rust AES-256-GCM encrypted snapshots of an in-memory SQLite, with the key protected by DPAPI (crate `windows`). Fewer native dependencies; verified by 15 Rust tests.
- Gotcha: `cargo add keyring --features windows-native` failed (keyring v4 renamed features to `*-keyring-store`) → replaced keyring with direct DPAPI, which is simpler.
- Gotcha: the shadcn CLI (v4.22) asks for a preset interactively even with `--yes`; pass `--preset nova --base radix --template vite`. The new shadcn uses the package `cn` (by shadcn) instead of clsx + tailwind-merge — verified maintainer before accepting (supply-chain check).
- Gotcha: the shadcn CLI installs itself into `dependencies`; it was moved to `devDependencies`.
- Data finding: IMH Pravilnik 2025/26 lists annual "subsequent child" amounts 7.000 / 7.970 KM for IDSS Preschoolers, which do not equal 12 × monthly (6.960 / 8.040). The app stores the monthly amounts (580 / 670) as authoritative for IMH. Old year only, so there is no billing impact.

- Gotcha / course correction: driving the native window with synthetic mouse clicks on the Director's desktop is unsafe. `SetForegroundWindow` was refused by Windows' focus-stealing protection, and one click landed in another application (it opened a menu in Notepad; it was closed with ESC and no change was made). → Never send synthetic input to the Director's desktop. Verify native UI through tests, logs and DB state, and let the Director do the visual walkthrough (C-7).
- Commander Improvement Candidate: ENGINEERING_RULES E-12 (or DONE_CHECKLIST) should state that desktop-app UI verification must not use OS-level synthetic input on a shared user desktop. Use an isolated session/VM or the framework's own test driver (e.g. tauri-driver) instead.

### 2026-10-21 — Pre-existing repository contained secrets
- The Director chose to reuse repo `IDSS123a/RACUNOVODSTVO-IMH-IDSS`. Inspection before touching it found a full browser profile (`Login Data`, `Cookies`), Psiphon VPN data, AI-agent conversation logs and an Excel file with real family data, all committed by an earlier AI tool.
- Resolved: the Director explicitly approved (M-23a) replacing all 4 commits and the branches `fix/m1-invoice-number-integrity` and `fix/m3-backup-handle` with the clean project via `--force-with-lease`. Remote state was verified live right before the push (M-23b).
- Commander Improvement Candidate: E-4 "pre-push secret audit" should also cover **pre-existing target repositories** that are reused. Inspect `git ls-files` for browser profiles (`.browser_data/`, `Login Data`, `Cookies`) and AI-agent working folders before adopting a repo.
