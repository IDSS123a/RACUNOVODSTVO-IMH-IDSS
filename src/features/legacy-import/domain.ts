import { kmToFenings, sum, type Fenings } from '@/features/billing/money';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { FINDING_CATEGORIES, FindingCollector, formatRows, toPlanFindings, type Finding, type FindingCategory, type PlanFinding } from './diagnostics';

/**
 * Import from the previous Excel solution (CONSTITUTION BR-32, SPRINT_03 "Legacy import").
 * Pure functions: raw cells in, an import plan and a report out. Nothing is recalculated:
 * every invoice keeps its original number and amounts. Decisions of the Director (2026-10-21):
 * - invoices AND the family register (sheet `Setting`) are imported; dates of birth come later;
 * - new numbering continues after the imported state (next free number per entity and year);
 * - the `-B` series is an ordinary IMH invoice with its number as written;
 * - "plaćeno" becomes one payment of the full amount on the due date, noted as taken from Excel.
 */

export type Cell =
  | { readonly t: 'Empty' }
  | { readonly t: 'Text'; readonly v: string }
  | { readonly t: 'Number'; readonly v: number }
  | { readonly t: 'Date'; readonly v: string };

export interface LegacyWorkbook {
  readonly fileName: string;
  readonly db: ReadonlyArray<ReadonlyArray<Cell>>;
  readonly setting: ReadonlyArray<ReadonlyArray<Cell>>;
}

/** What earlier imports already wrote: legacy key → id, and imported invoices by stored number. */
export interface ExistingKeys {
  readonly families: ReadonlyMap<string, string>;
  readonly children: ReadonlyMap<string, string>;
  readonly invoices: ReadonlyMap<string, { readonly id: string; readonly paid: Fenings }>;
}

export class LegacyImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyImportError';
  }
}

export const PAYMENT_NOTE = 'Uplata preuzeta iz Excela — stvarni datum uplate nepoznat';

/** Column positions in sheet `DB` (0-based); checked against the header row before reading. */
const DB = {
  institution: 0,
  entity: 1,
  number: 2,
  periodFrom: 3,
  periodTo: 4,
  issueDate: 5,
  dueDate: 6,
  father: 7,
  mother: 8,
  child: 9,
  description: 10,
  quantity: 13,
  price: 14,
  discount: 16,
  amount: 19,
  status: 20,
} as const;

const DB_HEADERS: ReadonlyArray<[number, string]> = [
  [DB.institution, 'ustanova'],
  [DB.entity, 'broj računa'],
  [DB.periodFrom, 'od'],
  [DB.periodTo, 'do'],
  [DB.issueDate, 'datum računa'],
  [DB.dueDate, 'rok plaćanja'],
  [DB.father, 'otac'],
  [DB.mother, 'majka'],
  [DB.child, 'dijete'],
  [DB.description, 'naziv usluge'],
  [DB.amount, 'iznos'],
];

/** Sheet `Setting`: row 1 is the header; one row per child. */
const SETTING = { father: 1, mother: 2, child: 3, address: 4 } as const;

// ---------- cell helpers ----------

function cell(row: ReadonlyArray<Cell> | undefined, index: number): Cell {
  return row?.[index] ?? { t: 'Empty' };
}

function text(c: Cell): string {
  if (c.t === 'Text') return c.v.replace(/\s+/g, ' ').trim();
  if (c.t === 'Number') return String(c.v);
  if (c.t === 'Date') return c.v;
  return '';
}

/** A person's name; "-", "0" and blanks mean "none". */
function personName(c: Cell): string | null {
  if (c.t !== 'Text') return null;
  const name = text(c);
  return name === '' || name === '-' || name === '—' || name === '0' ? null : name;
}

function numberOf(c: Cell): number | null {
  if (c.t === 'Number') return c.v;
  if (c.t === 'Text') return decimalOf(c.v);
  return null;
}

/**
 * A number typed as text: bs-BA ("1.234,50", "450,00 KM") or plain ("919.19", "-125").
 * A dot followed by groups of exactly three digits is a thousands separator ("1.500" → 1500);
 * a leading zero keeps it decimal ("0.125"). Anything else is null — never a guess.
 */
export function decimalOf(raw: string): number | null {
  let s = raw.replace(/\s/g, '').replace(/(KM|BAM)$/i, ''); // \s also matches the no-break space
  if (s === '') return null;
  if (s.includes(',')) {
    if (!/^-?(\d{1,3}(\.\d{3})+|\d+),\d+$/.test(s)) return null;
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** A text cell in the amount column that is not a number (a dash or blank is an empty line). */
function isInvalidAmount(c: Cell): boolean {
  if (c.t !== 'Text') return false;
  const value = c.v.trim();
  return value !== '' && value !== '-' && value !== '—' && decimalOf(value) === null;
}

/** Excel date cell or text "dd.mm.yyyy" (with or without the final dot); anything else → null. */
function dateOf(c: Cell): string | null {
  if (c.t === 'Date') return /^\d{4}-\d{2}-\d{2}$/.test(c.v) ? c.v : null;
  if (c.t !== 'Text') return null;
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/.exec(c.v.trim());
  if (!match) return null;
  const [, d, m, y] = match;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().startsWith(iso) ? iso : null;
}

/** Normalised key part: case-, space- and Unicode-form-insensitive (diacritics are kept). */
export function nameKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('bs');
}

function familyKey(father: string | null, mother: string | null): string {
  return `${nameKey(father ?? '')}|${nameKey(mother ?? '')}`;
}

function surname(fullName: string): string {
  const parts = fullName.split(' ');
  return parts[parts.length - 1] ?? fullName;
}

/** Item code from the free-text description of the old solution. */
export function itemCodeOf(description: string): string {
  const d = description.toLocaleLowerCase('bs');
  if (/školarin|skolarin|tuition/.test(d)) return 'TUITION';
  if (/materijal/.test(d)) return 'MATERIALS';
  if (/upisnin/.test(d)) return 'ENROLMENT_FEE';
  if (/doru[čc]/.test(d)) return 'BREAKFAST';
  if (/produžen|produzen/.test(d)) return 'EXTENDED_STAY';
  if (/depozit/.test(d)) return 'DEPOSIT';
  if (/summer|ljetn/.test(d)) return 'SUMMER_SCHOOL';
  if (/stipend/.test(d)) return 'SCHOLARSHIP';
  return 'OTHER';
}

/** Numeric part and year of an old number: "754-B/26" → 754, 2026; credit notes "KO-…" → null. */
export function sequenceOf(number: string): { sequence: number; year: number } | null {
  if (/^ko/i.test(number)) return null;
  const match = /^(\d+)\D.*\/(\d{2})$/.exec(number) ?? /^(\d+)\/(\d{2})$/.exec(number);
  if (!match) return null;
  return { sequence: Number(match[1]), year: 2000 + Number(match[2]) };
}

// ---------- plan ----------

export interface PlanGuardian {
  readonly id: string;
  readonly familyId: string;
  readonly fullName: string;
  readonly role: 'FATHER' | 'MOTHER';
  readonly email: string;
  readonly phone: string;
  readonly iban: string;
  readonly isPayer: boolean;
}

export interface ImportPlan {
  readonly families: Array<{ family: { id: string; displayName: string; address: string }; legacyKey: string; guardians: PlanGuardian[] }>;
  readonly children: Array<{
    child: { id: string; familyId: string; firstName: string; lastName: string; dateOfBirth: null; residency: 'DOMESTIC'; citizenBih: boolean; residenceKs: boolean; importReview: true };
    legacyKey: string;
  }>;
  readonly invoices: Array<{
    id: string;
    number: string;
    entity: LegalEntityCode;
    kind: 'OTHER' | 'CREDIT_NOTE';
    familyId: string;
    childId: string | null;
    buyerName: string;
    buyerAddress: string;
    issueDate: string;
    dueDate: string;
    periodFrom: string;
    periodTo: string;
    total: Fenings;
    lines: Array<{ itemCode: string; description: string; listAmount: Fenings; amount: Fenings }>;
    payment: PlanPayment | null;
  }>;
  readonly paymentsForExisting: Array<{ invoiceId: string; payment: PlanPayment }>;
  readonly sequences: Array<{ entity: LegalEntityCode; year: number; lastNumber: number }>;
  /** Findings stored with the import for later review (migration 009); BLOCK findings never reach a plan. */
  readonly findings: PlanFinding[];
}

export interface PlanPayment {
  readonly id: string;
  readonly paidOn: string;
  readonly amount: Fenings;
  readonly payerName: string;
  readonly note: string;
}

export interface EntityTotals {
  readonly invoices: number;
  readonly creditNotes: number;
  readonly total: Fenings;
  readonly paid: number;
  /** Highest imported number per year, e.g. { 2026: 896 } */
  readonly lastNumbers: Readonly<Record<number, number>>;
}

export interface ImportReport {
  readonly fileName: string;
  readonly familiesNew: number;
  readonly familiesExisting: number;
  readonly childrenNew: number;
  readonly invoicesNew: number;
  readonly invoicesExisting: number;
  readonly newlyPaid: number;
  readonly lines: number;
  readonly byEntity: Readonly<Record<LegalEntityCode, EntityTotals>>;
  /** Every inconsistency of the workbook, one finding per category and invoice (never silent — E-5). */
  readonly findings: ReadonlyArray<Finding>;
  /**
   * Invoices NOT imported because their number was already used by another invoice in the workbook
   * (a different buyer or child, or a second invoice with money). They are never merged into the
   * first one (Director's rule from the previous app: isolate and report, resolve by hand).
   */
  readonly isolated: ReadonlyArray<IsolatedInvoice>;
}

export interface IsolatedInvoice {
  readonly entity: string;
  readonly number: string;
  /** Excel rows of the isolated block, e.g. "412–414". */
  readonly excelRows: string;
  readonly buyerName: string;
  readonly childName: string;
  readonly total: Fenings;
  readonly reason: string;
}

interface FamilyDraft {
  key: string;
  father: string | null;
  mother: string | null;
  address: string;
  children: Map<string, string>; // child key → name as written
}

/** Child name from the "dijete: …" cell, or null. */
function childNameOf(row: ReadonlyArray<Cell>): string | null {
  return personName(cell(row, DB.child))?.replace(/^dijete:\s*/i, '').trim() || null;
}

/** One message listing every blocking finding, grouped by category. */
function blockingMessage(blocking: ReadonlyArray<Finding>): string {
  const byCategory = new Map<FindingCategory, Finding[]>();
  for (const f of blocking) byCategory.set(f.category, [...(byCategory.get(f.category) ?? []), f]);
  const order = Object.keys(FINDING_CATEGORIES);
  const sorted = [...byCategory].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  const parts = sorted.map(([category, list]) => {
    const rows = list.map((f) => f.excelRows.replace(/^DB /, '')).slice(0, 10).join(', ');
    return `${FINDING_CATEGORIES[category].title}: ${list.length} (list „DB“, red: ${rows}${list.length > 10 ? ' …' : ''})`;
  });
  return `Uvoz nije moguć dok se u Excelu ne isprave: ${parts.join('; ')}.`;
}

function findHeaderRow(rows: ReadonlyArray<ReadonlyArray<Cell>>): number {
  const index = rows.findIndex((row) => nameKey(text(cell(row, DB.institution))) === 'ustanova' && nameKey(text(cell(row, DB.entity))) === 'broj računa');
  if (index < 0) throw new LegacyImportError('list „DB“ nema zaglavlje „ustanova / broj računa“ — ovo nije dokument s fakturama');
  for (const [column, label] of DB_HEADERS) {
    if (nameKey(text(cell(rows[index], column))) !== label) {
      throw new LegacyImportError(`struktura lista „DB“ se promijenila: u koloni ${column + 1} očekuje se „${label}“`);
    }
  }
  return index;
}

/**
 * Build the import plan from the workbook and what earlier imports already wrote.
 * @param newId id generator (UUID v4 in the app; deterministic in tests)
 */
export function buildImportPlan(
  workbook: LegacyWorkbook,
  existing: ExistingKeys,
  newId: () => string,
  options: { readonly today?: string } = {},
): { plan: ImportPlan; report: ImportReport } {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const findings = new FindingCollector();
  const families = new Map<string, FamilyDraft>();
  const touchFamily = (father: string | null, mother: string | null): FamilyDraft => {
    const key = familyKey(father, mother);
    let draft = families.get(key);
    if (!draft) {
      draft = { key, father, mother, address: '', children: new Map() };
      families.set(key, draft);
    }
    return draft;
  };

  // 1. Family register (sheet Setting): one row per child.
  const childRows = new Map<string, { families: Set<string>; rows: number[] }>();
  workbook.setting.forEach((row, index) => {
    if (index === 0) return; // header
    const father = personName(cell(row, SETTING.father));
    const mother = personName(cell(row, SETTING.mother));
    const child = personName(cell(row, SETTING.child));
    if (!father && !mother && !child) return;
    if (!father && !mother) {
      findings.add('REGISTER_ROW_WITHOUT_PARENTS', { excelRows: `Setting ${index + 1}` });
      return;
    }
    const family = touchFamily(father, mother);
    const address = text(cell(row, SETTING.address));
    if (address && !family.address) family.address = address;
    if (child) {
      family.children.set(nameKey(child), child);
      const entry = childRows.get(nameKey(child)) ?? { families: new Set<string>(), rows: [] };
      entry.families.add(family.key);
      entry.rows.push(index + 1);
      childRows.set(nameKey(child), entry);
    }
  });
  for (const entry of childRows.values()) {
    if (entry.families.size > 1) {
      findings.add('CHILD_IN_TWO_FAMILIES', { excelRows: `Setting ${formatRows(entry.rows)}` }, `Isto ime djeteta uz ${entry.families.size} različita para roditelja.`);
    }
  }
  const registerFamilies = new Set(families.keys());
  const registerChildren = new Set([...families.values()].flatMap((f) => [...f.children.keys()].map((c) => `${f.key}|${c}`)));

  // 2. Invoices (sheet DB): one row per line. Lines of one invoice are ADJACENT rows with the same
  //    entity + number. The same number in a later, separate block is a different invoice unless it
  //    is an empty block of the same buyer and child; it is isolated and reported, never merged.
  const header = findHeaderRow(workbook.db);
  type Row = { row: ReadonlyArray<Cell>; excelRow: number };
  type Group = { rows: Row[] };
  const rowsLabel = (rows: ReadonlyArray<Row>): string => `DB ${formatRows(rows.map((r) => r.excelRow))}`;
  const blocks: Array<{ key: string; entity: string; number: string; rows: Row[] }> = [];
  workbook.db.forEach((row, index) => {
    if (index <= header) return;
    const number = text(cell(row, DB.number));
    const entity = text(cell(row, DB.entity));
    const amountCell = cell(row, DB.amount);
    if (isInvalidAmount(amountCell)) {
      findings.add('AMOUNT_UNREADABLE', { entity, number, excelRows: `DB ${index + 1}` }, `Iznos „${text(amountCell).slice(0, 40)}“ nije broj.`);
    }
    if (!number && !text(cell(row, DB.description)) && numberOf(amountCell) === null) return;
    if (!number) {
      findings.add('LINE_WITHOUT_NUMBER', { entity, excelRows: `DB ${index + 1}` });
      return;
    }
    const key = `${entity}|${number}`;
    const last = blocks[blocks.length - 1];
    if (last && last.key === key) last.rows.push({ row, excelRow: index + 1 });
    else blocks.push({ key, entity, number, rows: [{ row, excelRow: index + 1 }] });
  });
  const unknownEntities = new Set<string>();
  for (const block of blocks) {
    if ((block.entity === 'IMH' || block.entity === 'IDSS') || unknownEntities.has(block.key)) continue;
    unknownEntities.add(block.key);
    findings.add('ENTITY_UNKNOWN', { entity: block.entity, number: block.number, excelRows: rowsLabel(block.rows) }, `Oznaka ustanove „${block.entity.slice(0, 20)}“.`);
  }
  const blocking = findings.of('BLOCK');
  if (blocking.length > 0) throw new LegacyImportError(blockingMessage(blocking));

  const partyOf = (rows: ReadonlyArray<Row>): string => {
    const first = rows[0]?.row ?? [];
    return [DB.father, DB.mother, DB.child].map((column) => nameKey(personName(cell(first, column)) ?? '')).join('|');
  };
  const fenings = (row: ReadonlyArray<Cell>): Fenings => kmToFenings(numberOf(cell(row, DB.amount)) ?? 0);
  const amountOf = (rows: ReadonlyArray<Row>): Fenings => sum(rows.map(({ row }) => fenings(row)));
  const isolated: IsolatedInvoice[] = [];
  const isolate = (category: FindingCategory, entity: string, number: string, rows: ReadonlyArray<Row>, reason = ''): void => {
    const where = { entity, number, excelRows: rowsLabel(rows) };
    const total = amountOf(rows);
    findings.add(category, where, reason, total);
    const first = rows[0]?.row ?? [];
    isolated.push({
      ...where,
      buyerName: personName(cell(first, DB.father)) ?? personName(cell(first, DB.mother)) ?? '',
      childName: childNameOf(first) ?? '',
      total,
      reason: FINDING_CATEGORIES[category].title,
    });
  };

  const groups = new Map<string, Group>();
  for (const block of blocks) {
    const previous = groups.get(block.key);
    if (!previous) {
      groups.set(block.key, { rows: [...block.rows] });
      continue;
    }
    const sameParty = partyOf(previous.rows) === partyOf(block.rows);
    if (sameParty && amountOf(block.rows) === 0) {
      previous.rows.push(...block.rows); // empty template rows of the same invoice
      findings.add('EMPTY_BLOCK_ABSORBED', { entity: block.entity, number: block.number, excelRows: rowsLabel(block.rows) });
      continue;
    }
    if (sameParty && amountOf(previous.rows) === 0) {
      findings.add('EMPTY_BLOCK_ABSORBED', { entity: block.entity, number: block.number, excelRows: rowsLabel(previous.rows) });
      previous.rows.unshift(...block.rows); // the first block was the empty one; this one carries the invoice
      continue;
    }
    isolate(sameParty ? 'NUMBER_REUSED_SAME_PARTY' : 'NUMBER_REUSED_OTHER_PARTY', block.entity, block.number, block.rows);
  }

  const plan: ImportPlan = { families: [], children: [], invoices: [], paymentsForExisting: [], sequences: [], findings: [] };
  const familyIds = new Map<string, string>();
  const childIds = new Map<string, string>();
  const lastNumbers: Record<LegalEntityCode, Record<number, number>> = { IMH: {}, IDSS: {} };
  const series: Record<LegalEntityCode, Map<number, Set<number>>> = { IMH: new Map(), IDSS: new Map() };
  const totals: Record<LegalEntityCode, { invoices: number; creditNotes: number; total: Fenings; paid: number }> = {
    IMH: { invoices: 0, creditNotes: 0, total: 0, paid: 0 },
    IDSS: { invoices: 0, creditNotes: 0, total: 0, paid: 0 },
  };
  let invoicesExisting = 0;
  let newlyPaid = 0;
  let lineCount = 0;

  type InvoiceDraftLocal = ImportPlan['invoices'][number] & { familyKey: string; childKey: string | null };
  const drafts: InvoiceDraftLocal[] = [];

  for (const [key, group] of groups) {
    const first = group.rows[0];
    if (!first) continue;
    const [entityText, number] = key.split('|') as [string, string];
    const entity = entityText as LegalEntityCode; // unknown entities were blocked above
    const storedNumber = `${entity} ${number}`;
    const where = { entity, number, excelRows: rowsLabel(group.rows) };
    const isCreditNote = /^ko/i.test(number);
    const seq = sequenceOf(number);
    if (seq) {
      const years = lastNumbers[entity];
      years[seq.year] = Math.max(years[seq.year] ?? 0, seq.sequence);
      const set = series[entity].get(seq.year) ?? new Set<number>();
      set.add(seq.sequence);
      series[entity].set(seq.year, set);
    }
    if (/-B\//i.test(number)) findings.add('B_SERIES', where);
    const already = existing.invoices.get(storedNumber);

    const father = personName(cell(first.row, DB.father));
    const mother = personName(cell(first.row, DB.mother));
    const childName = childNameOf(first.row);
    if (!already && !father && !mother) {
      isolate('NO_BUYER', entity, number, group.rows);
      continue;
    }
    const issueDate = dateOf(cell(first.row, DB.issueDate));
    if (!already && !issueDate) {
      const written = text(cell(first.row, DB.issueDate));
      isolate('ISSUE_DATE_INVALID', entity, number, group.rows, written ? `Datum računa „${written.slice(0, 20)}“ nije stvaran datum.` : 'Datum računa nije upisan.');
      continue;
    }

    // Lines of one invoice must agree on the header; the first row is used.
    const contentRows = group.rows.filter(({ row }) => text(cell(row, DB.description)) !== '' || fenings(row) !== 0);
    const headerColumns = [DB.institution, DB.periodFrom, DB.periodTo, DB.issueDate, DB.dueDate, DB.father, DB.mother, DB.child];
    const disagreeing = contentRows.filter(({ row }) => headerColumns.some((c) => text(cell(row, c)) !== text(cell(first.row, c))));
    if (disagreeing.length > 0) findings.add('LINES_DISAGREE', { ...where, excelRows: rowsLabel(disagreeing) });

    // Dates (the invoice is imported; defaults are reported, never silent).
    let dueDate = dateOf(cell(first.row, DB.dueDate));
    if (!dueDate) {
      const written = text(cell(first.row, DB.dueDate));
      findings.add('DUE_DATE_INVALID', where, written ? `Rok „${written.slice(0, 20)}“ nije stvaran datum; uzet je datum računa.` : 'Rok nije upisan; uzet je datum računa.');
      dueDate = issueDate ?? '';
    }
    const fromWritten = dateOf(cell(first.row, DB.periodFrom));
    const toWritten = dateOf(cell(first.row, DB.periodTo));
    if (!fromWritten || !toWritten) findings.add('PERIOD_INVALID', where, 'Obračunski period nije potpuno upisan; uzet je datum računa.');
    else if (toWritten < fromWritten) findings.add('PERIOD_INVALID', where, 'Kraj obračunskog perioda je prije početka.');
    const periodFrom = fromWritten ?? issueDate ?? '';
    const periodTo = toWritten ?? periodFrom;
    if (issueDate && seq && Number(issueDate.slice(0, 4)) !== seq.year) {
      findings.add('NUMBER_YEAR_MISMATCH', where, `Broj je iz ${seq.year}. godine, a datum računa je ${issueDate}.`);
    }
    if (issueDate && issueDate > today) findings.add('ISSUE_DATE_IN_FUTURE', where, `Datum računa ${issueDate} je poslije dana uvoza ${today}.`);

    // Lines.
    const lines: InvoiceDraftLocal['lines'] = [];
    const rounded: Row[] = [];
    const badDiscount: Row[] = [];
    const mismatch: Row[] = [];
    const negative: Row[] = [];
    const unrecognised: Row[] = [];
    for (const r of group.rows) {
      const { row } = r;
      const description = text(cell(row, DB.description));
      const amountValue = numberOf(cell(row, DB.amount)) ?? 0;
      const amount = kmToFenings(amountValue);
      if (!description && amount === 0) continue; // empty template row
      if (Math.abs(amountValue * 100 - Math.round(amountValue * 100)) > 1e-6) rounded.push(r);
      const quantityRaw = numberOf(cell(row, DB.quantity));
      const priceRaw = numberOf(cell(row, DB.price));
      const discount = numberOf(cell(row, DB.discount)) ?? 0;
      if (discount < 0 || discount > 1) badDiscount.push(r);
      if (quantityRaw !== null && priceRaw !== null && amount !== 0) {
        const expected = Math.round(quantityRaw * priceRaw * (1 - discount) * 100);
        if (Math.abs(expected - amount) > 1) mismatch.push(r);
      }
      if (!isCreditNote && amount < 0) negative.push(r);
      if (description && itemCodeOf(description) === 'OTHER') unrecognised.push(r);
      const quantity = quantityRaw ?? 1;
      const price = priceRaw ?? amountValue;
      const details = [
        quantity !== 1 && quantity !== 0 ? `${quantity} × ${price.toLocaleString('bs-BA', { minimumFractionDigits: 2 })} KM` : '',
        discount ? `rabat ${Math.round(discount * 100)}%` : '',
      ].filter(Boolean);
      lines.push({
        itemCode: itemCodeOf(description),
        description: (description || 'Stavka bez opisa') + (details.length ? ` (${details.join(', ')})` : ''),
        listAmount: kmToFenings(quantity * price),
        amount,
      });
    }
    if (rounded.length) findings.add('AMOUNT_ROUNDED', { ...where, excelRows: rowsLabel(rounded) });
    if (badDiscount.length) findings.add('DISCOUNT_OUT_OF_RANGE', { ...where, excelRows: rowsLabel(badDiscount) });
    if (mismatch.length) findings.add('LINE_AMOUNT_MISMATCH', { ...where, excelRows: rowsLabel(mismatch) });
    if (negative.length) findings.add('NEGATIVE_LINE', { ...where, excelRows: rowsLabel(negative) });
    if (unrecognised.length) findings.add('ITEM_UNRECOGNISED', { ...where, excelRows: rowsLabel(unrecognised) }, `${unrecognised.length} stavki s neprepoznatim opisom (uvezeno kao „Ostalo“).`);
    if (lines.length === 0) {
      if (!already) isolate('INVOICE_WITHOUT_LINES', entity, number, group.rows);
      continue;
    }

    const total = sum(lines.map((l) => l.amount));
    if (total === 0) findings.add('ZERO_TOTAL', where);
    if (!childName) findings.add('NO_CHILD', where);
    const famKey = familyKey(father, mother);
    if (!registerFamilies.has(famKey)) findings.add('FAMILY_NOT_IN_REGISTER', where);
    else if (childName && !registerChildren.has(`${famKey}|${nameKey(childName)}`)) findings.add('CHILD_NOT_IN_REGISTER', where);

    // Payment status (Q1): a payment equals the flagged lines; partly flagged invoices are reviewed.
    const statuses = group.rows.map(({ row }) => nameKey(text(cell(row, DB.status))));
    const unknownStatus = [...new Set(statuses.filter((s) => s !== '' && s !== 'plaćeno'))];
    if (unknownStatus.length) findings.add('STATUS_TEXT_UNKNOWN', where, `Status „${unknownStatus.join('“, „').slice(0, 40)}“ nije prepoznat; uvezeno kao neplaćeno.`);
    const moneyRows = group.rows.filter(({ row }) => fenings(row) !== 0);
    const flaggedRows = group.rows.filter(({ row }) => nameKey(text(cell(row, DB.status))) === 'plaćeno');
    const flaggedMoney = moneyRows.filter(({ row }) => nameKey(text(cell(row, DB.status))) === 'plaćeno');
    const fullyPaid = moneyRows.length > 0 && flaggedMoney.length === moneyRows.length;
    const paidAmount = fullyPaid ? total : sum(flaggedMoney.map(({ row }) => fenings(row)));
    if (flaggedRows.length > 0 && !fullyPaid) {
      findings.add('PAID_PARTIALLY_FLAGGED', where, `„Plaćeno“ je označeno na ${flaggedMoney.length} od ${moneyRows.length} stavki s iznosom; knjižena je uplata označenih stavki.`, paidAmount);
    }
    if (isCreditNote) {
      findings.add('CREDIT_NOTE_UNLINKED', where, '', total);
      if (total > 0 || flaggedRows.length > 0) findings.add('CREDIT_NOTE_INCONSISTENT', where, total > 0 ? 'Knjižno odobrenje ima pozitivan iznos.' : 'Knjižno odobrenje je označeno „plaćeno“.', total);
    }

    if (already) {
      invoicesExisting += 1;
      if (paidAmount > 0 && already.paid === 0 && dueDate) {
        plan.paymentsForExisting.push({
          invoiceId: already.id,
          payment: { id: newId(), paidOn: dueDate, amount: paidAmount, payerName: father ?? mother ?? '', note: PAYMENT_NOTE },
        });
        newlyPaid += 1;
      }
      continue;
    }

    lineCount += lines.length;
    const kind = isCreditNote ? 'CREDIT_NOTE' : 'OTHER';
    const family = touchFamily(father, mother);
    const childKey = childName ? `${family.key}|${nameKey(childName)}` : null;
    if (childName) family.children.set(nameKey(childName), childName);

    totals[entity].invoices += 1;
    if (kind === 'CREDIT_NOTE') totals[entity].creditNotes += 1;
    totals[entity].total += total;
    const payer = father ?? mother ?? '';
    let payment: PlanPayment | null = null;
    if (paidAmount > 0) {
      payment = { id: newId(), paidOn: dueDate, amount: paidAmount, payerName: payer, note: PAYMENT_NOTE };
      totals[entity].paid += 1;
    }
    drafts.push({
      id: newId(),
      number: storedNumber,
      entity,
      kind,
      familyId: '',
      childId: null,
      buyerName: payer,
      buyerAddress: '',
      issueDate: issueDate ?? '',
      dueDate,
      periodFrom,
      periodTo,
      total,
      lines,
      payment,
      familyKey: family.key,
      childKey,
    });
  }

  // Gaps in each numbering series (entity, year) — the old numbers are reserved, gaps are only reported.
  for (const entity of ['IMH', 'IDSS'] as const) {
    for (const [year, numbers] of series[entity]) {
      const max = Math.max(...numbers);
      const missing: number[] = [];
      for (let n = 1; n <= max; n += 1) if (!numbers.has(n)) missing.push(n);
      if (missing.length) {
        findings.add('NUMBER_GAPS', { entity, number: `…/${String(year).slice(2)}`, excelRows: '' }, `Nedostaje ${missing.length} brojeva: ${formatRows(missing, 20)}.`);
      }
    }
  }

  // 3. Families and children: reuse what earlier imports created, create the rest.
  let familiesExisting = 0;
  for (const family of families.values()) {
    const existingId = existing.families.get(family.key);
    const familyId = existingId ?? newId();
    familyIds.set(family.key, familyId);
    if (existingId) familiesExisting += 1;
    else {
      const firstChild = family.children.values().next().value as string | undefined;
      const displayName = surname(firstChild ?? family.father ?? family.mother ?? 'Porodica');
      const guardians: PlanGuardian[] = [];
      if (family.father) guardians.push({ id: newId(), familyId, fullName: family.father, role: 'FATHER', email: '', phone: '', iban: '', isPayer: true });
      if (family.mother) guardians.push({ id: newId(), familyId, fullName: family.mother, role: 'MOTHER', email: '', phone: '', iban: '', isPayer: !family.father });
      plan.families.push({ family: { id: familyId, displayName, address: family.address }, legacyKey: family.key, guardians });
    }
    for (const [childKeyPart, childName] of family.children) {
      const key = `${family.key}|${childKeyPart}`;
      const existingChild = existing.children.get(key);
      if (existingChild) {
        childIds.set(key, existingChild);
        continue;
      }
      const id = newId();
      childIds.set(key, id);
      const parts = childName.split(' ');
      const lastName = parts.length > 1 ? (parts.pop() ?? '') : surname(family.father ?? family.mother ?? childName);
      plan.children.push({
        child: { id, familyId, firstName: parts.join(' '), lastName, dateOfBirth: null, residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: true },
        legacyKey: key,
      });
    }
  }
  for (const draft of drafts) {
    const { familyKey: fk, childKey: ck, ...invoice } = draft;
    const family = families.get(fk);
    plan.invoices.push({
      ...invoice,
      familyId: familyIds.get(fk) ?? '',
      childId: ck ? (childIds.get(ck) ?? null) : null,
      buyerAddress: family?.address ?? '',
    });
  }
  for (const entity of ['IMH', 'IDSS'] as const) {
    for (const [year, last] of Object.entries(lastNumbers[entity])) plan.sequences.push({ entity, year: Number(year), lastNumber: last });
  }

  plan.findings.push(...toPlanFindings(findings.list()));

  const byEntity = Object.fromEntries(
    (['IMH', 'IDSS'] as const).map((entity) => [entity, { ...totals[entity], lastNumbers: lastNumbers[entity] }]),
  ) as Record<LegalEntityCode, EntityTotals>;
  return {
    plan,
    report: {
      fileName: workbook.fileName,
      familiesNew: plan.families.length,
      familiesExisting,
      childrenNew: plan.children.length,
      invoicesNew: plan.invoices.length,
      invoicesExisting,
      newlyPaid,
      lines: lineCount,
      byEntity,
      findings: findings.list(),
      isolated,
    },
  };
}
