import { buildWorkbook, type Cell } from '@/lib/export/xlsx';
import type { Fenings } from '@/features/billing/money';

/**
 * Legacy import diagnostics (specs/legacy-import-diagnostics). Every inconsistency of the old workbook
 * is one Finding in exactly one category. Nothing is resolved silently (E-5), and REVIEW/INFO never
 * change an imported number or amount (BR-32). Severities confirmed by the Director (2026-11-21, Q2).
 *
 * Reasons never contain personal data (BR-22): an entry is identified by entity, invoice number and
 * Excel rows; names are shown only in the preview, from the workbook itself.
 */

/** BLOCK — nothing is imported · ISOLATE — this record is not imported · REVIEW — imported, to be checked · INFO — listed only. */
export type Severity = 'BLOCK' | 'ISOLATE' | 'REVIEW' | 'INFO';

export const SEVERITY_ORDER: ReadonlyArray<Severity> = ['BLOCK', 'ISOLATE', 'REVIEW', 'INFO'];

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  BLOCK: 'Blokira uvoz',
  ISOLATE: 'Ne uvozi se',
  REVIEW: 'Uvozi se — za provjeru',
  INFO: 'Uvozi se — informativno',
};

interface CategoryDefinition {
  readonly severity: Severity;
  /** Short title (also the Excel sheet name, ≤ 31 characters). */
  readonly title: string;
  readonly description: string;
}

/** The single list of categories (M-7). Numbers follow SPEC.md. */
export const FINDING_CATEGORIES = {
  AMOUNT_UNREADABLE: { severity: 'BLOCK', title: 'Iznos nije broj', description: 'Ćelija iznosa sadrži tekst koji nije broj.' },
  ENTITY_UNKNOWN: { severity: 'BLOCK', title: 'Nepoznata ustanova', description: 'Oznaka ustanove nije IMH ni IDSS.' },
  LINE_WITHOUT_NUMBER: { severity: 'BLOCK', title: 'Stavka bez broja računa', description: 'Red sa sadržajem nema broj računa.' },
  NUMBER_REUSED_OTHER_PARTY: { severity: 'ISOLATE', title: 'Broj ponovljen - drugi kupac', description: 'Isti broj u odvojenom bloku za drugog kupca ili dijete; ne spaja se s prvim računom.' },
  NUMBER_REUSED_SAME_PARTY: { severity: 'ISOLATE', title: 'Broj ponovljen - isti kupac', description: 'Isti broj u odvojenom bloku istog kupca, s iznosom; ne spaja se s prvim računom.' },
  NO_BUYER: { severity: 'ISOLATE', title: 'Račun bez kupca', description: 'Nema ni oca ni majke kao kupca.' },
  ISSUE_DATE_INVALID: { severity: 'ISOLATE', title: 'Neispravan datum računa', description: 'Datum računa nedostaje ili nije stvaran datum.' },
  INVOICE_WITHOUT_LINES: { severity: 'ISOLATE', title: 'Račun bez stavki', description: 'Svi redovi računa su prazni (bez opisa i iznosa).' },
  REGISTER_ROW_WITHOUT_PARENTS: { severity: 'ISOLATE', title: 'Registar - dijete bez roditelja', description: 'Red u listu „Setting“ ima dijete, ali ni oca ni majku.' },
  DUE_DATE_INVALID: { severity: 'REVIEW', title: 'Rok plaćanja neispravan', description: 'Rok nedostaje ili nije stvaran datum; uzet je datum računa.' },
  PERIOD_INVALID: { severity: 'REVIEW', title: 'Obračunski period neispravan', description: 'Period nedostaje (uzet je datum računa) ili „do“ je prije „od“.' },
  NUMBER_YEAR_MISMATCH: { severity: 'REVIEW', title: 'Godina broja ≠ godina datuma', description: 'Godina u broju računa nije godina datuma računa.' },
  ISSUE_DATE_IN_FUTURE: { severity: 'REVIEW', title: 'Datum računa u budućnosti', description: 'Datum računa je poslije dana uvoza.' },
  PAID_PARTIALLY_FLAGGED: { severity: 'REVIEW', title: 'Plaćeno samo na dijelu stavki', description: 'Oznaka „plaćeno“ je samo na dijelu stavki; knjižena je uplata u iznosu označenih stavki (odluka Direktora, Q1).' },
  STATUS_TEXT_UNKNOWN: { severity: 'REVIEW', title: 'Nepoznat status plaćanja', description: 'Status nije „plaćeno“ ni prazan; račun je uvezen kao neplaćen.' },
  LINE_AMOUNT_MISMATCH: { severity: 'REVIEW', title: 'Iznos ≠ količina × cijena', description: 'Iznos stavke se razlikuje od količina × cijena − rabat za više od 0,01 KM; uvezen je iznos kako piše.' },
  DISCOUNT_OUT_OF_RANGE: { severity: 'REVIEW', title: 'Rabat izvan 0-100 %', description: 'Rabat je manji od 0 ili veći od 100 %.' },
  AMOUNT_ROUNDED: { severity: 'REVIEW', title: 'Iznos s više od 2 decimale', description: 'Iznos ima više od dvije decimale i zaokružen je na feninge.' },
  CREDIT_NOTE_UNLINKED: { severity: 'REVIEW', title: 'Knjižno odobrenje bez veze', description: 'Knjižno odobrenje (KO) nema vezu na račun koji poništava.' },
  CREDIT_NOTE_INCONSISTENT: { severity: 'REVIEW', title: 'Knjižno odobrenje nelogično', description: 'Knjižno odobrenje ima pozitivan iznos ili oznaku „plaćeno“.' },
  ZERO_TOTAL: { severity: 'REVIEW', title: 'Račun na 0 KM', description: 'Račun ima stavke, ali je ukupan iznos 0.' },
  NO_CHILD: { severity: 'REVIEW', title: 'Račun bez djeteta', description: 'Na računu nije upisano dijete.' },
  FAMILY_NOT_IN_REGISTER: { severity: 'REVIEW', title: 'Porodica nije u registru', description: 'Kupac (otac/majka) nije u listu „Setting“.' },
  CHILD_NOT_IN_REGISTER: { severity: 'REVIEW', title: 'Dijete nije u registru', description: 'Dijete nije u listu „Setting“ uz ove roditelje.' },
  CHILD_IN_TWO_FAMILIES: { severity: 'REVIEW', title: 'Isto dijete u više porodica', description: 'Isto ime djeteta je u registru uz različite roditelje.' },
  LINES_DISAGREE: { severity: 'REVIEW', title: 'Stavke se ne slažu', description: 'Stavke istog računa imaju različitog kupca, dijete ili datume; uzet je prvi red.' },
  EMPTY_BLOCK_ABSORBED: { severity: 'INFO', title: 'Prazan ponovljeni blok', description: 'Prazni redovi istog računa na drugom mjestu u listu; pridruženi računu.' },
  NEGATIVE_LINE: { severity: 'INFO', title: 'Negativna stavka', description: 'Obični račun ima stavku s negativnim iznosom.' },
  ITEM_UNRECOGNISED: { severity: 'INFO', title: 'Neprepoznat opis stavke', description: 'Opis stavke nije prepoznat; stavka je uvezena kao „Ostalo“.' },
  NUMBER_GAPS: { severity: 'INFO', title: 'Praznine u numeraciji', description: 'U seriji brojeva (ustanova, godina) nedostaju brojevi.' },
  B_SERIES: { severity: 'INFO', title: 'Serija -B', description: 'IMH broj sa sufiksom -B; uvezen kao običan IMH račun (odluka Direktora).' },
} as const satisfies Record<string, CategoryDefinition>;

export type FindingCategory = keyof typeof FINDING_CATEGORIES;

export interface Finding {
  readonly category: FindingCategory;
  readonly severity: Severity;
  /** IMH / IDSS, or '' for register-level findings. */
  readonly entity: string;
  /** Invoice number as written in the workbook, or a series such as "…/26". */
  readonly number: string;
  /** Sheet and rows, e.g. "DB 412–414" or "Setting 15, 230". */
  readonly excelRows: string;
  /** What exactly is wrong — no personal data. */
  readonly reason: string;
  /** The amount concerned, in fenings, when one applies. */
  readonly amount: Fenings | null;
}

/** A finding as stored with the import (migration 009). */
export interface PlanFinding {
  /** Stable across re-imports of a newer workbook: category, entity and number (+ an ordinal when repeated). */
  readonly findingKey: string;
  readonly category: FindingCategory;
  readonly severity: Exclude<Severity, 'BLOCK'>;
  readonly entity: string;
  readonly number: string;
  readonly excelRows: string;
  readonly reason: string;
  readonly amount: Fenings | null;
}

/**
 * Findings to store with the import. The key deliberately excludes Excel rows (they shift between versions of the
 * workbook) and names (BR-22); a category that repeats for the same invoice or register gets an ordinal.
 */
export function toPlanFindings(findings: ReadonlyArray<Finding>): PlanFinding[] {
  const seen = new Map<string, number>();
  const out: PlanFinding[] = [];
  for (const f of findings) {
    if (f.severity === 'BLOCK') continue;
    const base = `${f.category}|${f.entity}|${f.number}`;
    const ordinal = (seen.get(base) ?? 0) + 1;
    seen.set(base, ordinal);
    out.push({
      findingKey: ordinal === 1 ? base : `${base}|${ordinal}`,
      category: f.category,
      severity: f.severity,
      entity: f.entity,
      number: f.number,
      excelRows: f.excelRows,
      reason: f.reason,
      amount: f.amount,
    });
  }
  return out;
}

/** Format a list of 1-based row numbers compactly: [4,5,6,9] → "4–6, 9". */
export function formatRows(rows: ReadonlyArray<number>, limit = 30): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] ?? 0) + 1) j += 1;
    ranges.push(i === j ? String(sorted[i]) : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return ranges.length > limit ? `${ranges.slice(0, limit).join(', ')} … (+${ranges.length - limit})` : ranges.join(', ');
}

/** Collects findings; the severity always comes from the category (M-7). */
export class FindingCollector {
  private readonly items: Finding[] = [];

  add(category: FindingCategory, where: { entity?: string; number?: string; excelRows: string }, reason = '', amount: Fenings | null = null): void {
    const definition = FINDING_CATEGORIES[category];
    this.items.push({
      category,
      severity: definition.severity,
      entity: where.entity ?? '',
      number: where.number ?? '',
      excelRows: where.excelRows,
      reason: reason || definition.description,
      amount,
    });
  }

  list(): ReadonlyArray<Finding> {
    return this.items;
  }

  of(severity: Severity): ReadonlyArray<Finding> {
    return this.items.filter((f) => f.severity === severity);
  }
}

export interface CategoryCount {
  readonly category: FindingCategory;
  readonly severity: Severity;
  readonly title: string;
  readonly count: number;
}

/** Counts per category, in severity order, then in the order of FINDING_CATEGORIES. Empty categories are left out. */
export function countByCategory(findings: ReadonlyArray<Finding>): ReadonlyArray<CategoryCount> {
  const counts = new Map<FindingCategory, number>();
  for (const f of findings) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  const keys = Object.keys(FINDING_CATEGORIES) as FindingCategory[];
  return SEVERITY_ORDER.flatMap((severity) =>
    keys
      .filter((k) => FINDING_CATEGORIES[k].severity === severity && (counts.get(k) ?? 0) > 0)
      .map((k) => ({ category: k, severity, title: FINDING_CATEGORIES[k].title, count: counts.get(k) ?? 0 })),
  );
}

// ---------- Excel report for the accountant (Q3) ----------

type ReportCell = Cell;

const DETAIL_HEADER: ReadonlyArray<string> = ['Težina', 'Kategorija', 'Ustanova', 'Broj računa', 'Excel redovi', 'Razlog', 'Iznos (KM)'];

function detailRow(f: Finding): ReportCell[] {
  return [SEVERITY_LABEL[f.severity], FINDING_CATEGORIES[f.category].title, f.entity, f.number, f.excelRows, f.reason, f.amount === null ? null : f.amount / 100];
}

/**
 * The findings as an .xlsx workbook: a summary sheet, then one sheet per category that has findings.
 * @param findings all findings of one import preview
 * @param meta file name of the workbook and the date of the report (ISO)
 * @returns the bytes of the .xlsx file
 */
export function buildFindingsWorkbook(findings: ReadonlyArray<Finding>, meta: { fileName: string; date: string }): Uint8Array {
  const counts = countByCategory(findings);
  const sheets: Array<{ name: string; rows: ReportCell[][] }> = [];
  const summary: ReportCell[][] = [
    ['Izvještaj o uvozu iz starog rješenja (Excel)'],
    ['Dokument', meta.fileName],
    ['Datum izvještaja', meta.date],
    ['Ukupno nalaza', findings.length],
    [],
    ['Težina', 'Kategorija', 'Broj', 'Značenje'],
    ...counts.map((c) => [SEVERITY_LABEL[c.severity], c.title, c.count, FINDING_CATEGORIES[c.category].description]),
  ];
  sheets.push({ name: 'Sažetak', rows: summary });
  sheets.push({ name: 'Svi nalazi', rows: [DETAIL_HEADER as ReportCell[], ...orderFindings(findings).map(detailRow)] });
  for (const c of counts) {
    const rows = findings.filter((f) => f.category === c.category).map(detailRow);
    sheets.push({ name: c.title, rows: [DETAIL_HEADER as ReportCell[], ...rows] });
  }

  return buildWorkbook(sheets.map((sh) => ({ name: sh.name, rows: sh.rows })));
}

/** Findings in severity order, then category order, then entity and number. */
export function orderFindings(findings: ReadonlyArray<Finding>): ReadonlyArray<Finding> {
  const keys = Object.keys(FINDING_CATEGORIES);
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      keys.indexOf(a.category) - keys.indexOf(b.category) ||
      a.entity.localeCompare(b.entity) ||
      a.number.localeCompare(b.number, 'bs', { numeric: true }),
  );
}
