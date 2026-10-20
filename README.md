# Fakturisanje IMH & IDSS

Offline Windows desktop application for billing tuition and fees of two
separate legal entities:
- **IMH** — Toddlers, Preschoolers and IDSS Preschoolers;
- **IDSS** — primary school I–IX.

It covers payment plans, payments, reminders, the monthly ministry
subsidy cycle and refunds.

Governed by **Commander v1.6.2**. Start with:
- `CLAUDE.md` — standing orders for AI coding assistants;
- `CONSTITUTION.md` — project scope and binding business rules;
- `DECISION_LOG.md` — stack and architecture decisions;
- `sprints/` — sprint plans and handoff notes;
- `docs/business-rules/` — cited business-rule analysis (Bosnian);
- `docs/forensics/` — forensic analysis of the legacy application (Bosnian).

## Stack

Tauri 2, React and TypeScript (strict), built with Vite. Data is stored in an
encrypted local SQLite database (SQLCipher). See DECISION_LOG DL-P001 / DL-P004.

## Prerequisites (Windows)

- Node.js ≥ 22
- Rust ≥ 1.90 (`rustup update stable`)
- Microsoft C++ Build Tools (MSVC) and WebView2 runtime (Tauri prerequisites)

## Commands

| Command | Purpose |
|---|---|
| `npm install` | install dependencies |
| `npm run tauri dev` | run the desktop app in development |
| `npm run typecheck` | TypeScript check |
| `npm test` | unit tests (Vitest) |
| `npm run guard` | Commander project-guard scan (forbidden patterns) |
| `npm run tauri build` | build the Windows installer |
