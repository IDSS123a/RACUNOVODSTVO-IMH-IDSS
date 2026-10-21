# DECISION_LOG.md — Fakturisanje IMH & IDSS
# Project-level decisions (Commander DECISION_LOG applies unless overridden here)

---

## DL-P001 — Stack: Tauri 2 + React + TypeScript + Vite + encrypted SQLite (M-16 deviation)

**Date:** 2026-10-20 · **Approved by:** Director (accepted proposal 4 of the bootstrap)

**Decision:** an offline Windows desktop application.
- Presentation: React + TypeScript (strict) + Vite, with Tailwind CSS + shadcn/ui (DL-011).
- Shell: Tauri 2.
- Persistence: a local SQLite database encrypted at rest.
- Not used: Next.js, Supabase or Vercel.

**Rationale:**
- There is one operator, so there is no shared-data requirement.
- The data is sensitive (children, parents, bank accounts; Zakon čl. 53h), and keeping it local avoids a cloud data processor.
- The Director requires a desktop application that works without internet.
- The legacy app was a browser-bundled HTML file whose source is not available. A rebuild is needed in any case, so M-16's "keep the working codebase" does not apply.

**Layer translation (A-1):**
- Presentation: `src/features/*/components`.
- Application: `src/features/*/actions.ts` (orchestration, Zod validation).
- Domain: `src/features/*/domain.ts` (pure TypeScript, no Tauri imports, fully unit-tested).
- Infrastructure: `src/features/*/repository.ts`, which calls Tauri commands. The commands are implemented in Rust (`src-tauri/src`) and own all SQL.
- External: SQLite file and file system.

**Alternative rejected:** Next.js + Supabase (EU region). It would give automatic cloud backup and multi-device access, but requires internet and login and places child data with a cloud processor.

**Upgrade path:** if a second user or remote access is ever required, the Domain layer (pure TypeScript) moves unchanged to a Next.js + Supabase app. Only the Infrastructure layer is rewritten.

---

## DL-P002 — No authentication / RBAC layer

**Date:** 2026-10-20

**Decision:** single operator (Director, 2026-10-20), so the app has no login and no roles. Access control is:
- the operator's Windows account;
- the database encryption key bound to that account (DL-P004).

**Consequence:** Commander E-6 steps "authenticate / authorise" collapse to "the encrypted database could be opened". Every write is still recorded in the audit log with a timestamp.

---

## DL-P003 — Money as integer fenings, one rounding point

**Date:** 2026-10-20

**Decision:** all amounts are stored and computed as integer fenings.
- Rounding happens once per invoice line (half away from zero), in `src/features/billing/money.ts`.
- Totals are sums of rounded lines.
- Percentages are stored as basis points (12,5 % = 1250).

**Rationale:** the forensic analysis (docs/forensics) found 1-fening drifts between form, PDF and database, and percentage truncation (12,5 % → 13 %). Both were caused by mixed float rounding in several places (M-7).

---

## DL-P004 — Database encryption at rest  `[DECIDED 2026-10-21 — supersedes the SQLCipher proposal of 2026-10-20]`

**Decision:** in-memory SQLite (`rusqlite`, bundled) with **encrypted snapshots**.
- After every committed write, the whole database is serialised and encrypted with **AES-256-GCM**, using crate `aes-gcm` (pure Rust, RustCrypto). A fresh random nonce is used per write.
- The snapshot is written atomically (temp file + rename). The previous snapshot is kept as `.prev`.
- The 256-bit data key is protected with **Windows DPAPI** (`CryptProtectData`, crate `windows` by Microsoft), so it is bound to the operator's Windows account.
- A one-time **recovery key** (base64) is shown on first run, to be printed and kept by the Director. Restoring a backup on another machine or account uses it.
- Backups are the same encrypted snapshot format (`*.fkbak`).

**🔄 Course correction:** the SQLCipher proposal (`bundled-sqlcipher`) needs OpenSSL and a native Perl build on Windows. Neither exists on the build machine. Pure-Rust AES-GCM avoids the native crypto toolchain completely. Keyring was replaced with direct DPAPI, which has fewer moving parts.

**Why:** Zakon o predškolskom odgoju KS čl. 53h requires cryptographic protection of personal data.

**Trade-off:** each write rewrites the whole file. This is fine for the expected size (a few MB).

**New dependencies (M-12):** `rusqlite`, `aes-gcm`, `rand`, `base64`, `thiserror`, `chrono`, `windows`, `tauri-plugin-dialog`. All are part of the approved "encrypted local database" proposal (bootstrap answer 4). Listed here for the record.

**Verified by tests:**
- the file on disk is not readable SQLite;
- a wrong key or a tampered file fails;
- the DPAPI round trip works, and the raw key is never stored in clear;
- restore with the recovery key works on another key store.

---

## DL-P005 — Price lists are data, versioned per school year

**Date:** 2026-10-20

**Decision:** every price (both entities, all items, first/subsequent child, domestic/foreign) is a row in `price_list_items`, keyed by school year.
- The seeds for 2025/26 and 2026/27 are transcribed from the official documents and cite their source.
- No price literal may appear in application code.

---

*Commander v1.6.2 — IDSS123a Organisation*
