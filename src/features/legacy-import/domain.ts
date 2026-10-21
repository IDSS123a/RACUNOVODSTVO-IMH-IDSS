import { kmToFenings, sum, type Fenings } from '@/features/billing/money';
import type { LegalEntityCode } from '@/features/price-lists/types';

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
  if (c.t === 'Text') {
    const parsed = Number(c.v.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
  /** Rows skipped or adjusted, with the reason (never silent — E-5). */
  readonly warnings: ReadonlyArray<string>;
}

interface FamilyDraft {
  key: string;
  father: string | null;
  mother: string | null;
  address: string;
  children: Map<string, string>; // child key → name as written
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
export function buildImportPlan(workbook: LegacyWorkbook, existing: ExistingKeys, newId: () => string): { plan: ImportPlan; report: ImportReport } {
  const warnings: string[] = [];
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
  workbook.setting.forEach((row, index) => {
    if (index === 0) return; // header
    const father = personName(cell(row, SETTING.father));
    const mother = personName(cell(row, SETTING.mother));
    const child = personName(cell(row, SETTING.child));
    if (!father && !mother && !child) return;
    if (!father && !mother) {
      warnings.push(`Setting, red ${index + 1}: dijete bez roditelja — preskočeno`);
      return;
    }
    const family = touchFamily(father, mother);
    const address = text(cell(row, SETTING.address));
    if (address && !family.address) family.address = address;
    if (child) family.children.set(nameKey(child), child);
  });

  // 2. Invoices (sheet DB): one row per line, grouped by entity + number.
  const header = findHeaderRow(workbook.db);
  type Group = { rows: Array<{ row: ReadonlyArray<Cell>; excelRow: number }> };
  const groups = new Map<string, Group>();
  workbook.db.forEach((row, index) => {
    if (index <= header) return;
    const number = text(cell(row, DB.number));
    const entity = text(cell(row, DB.entity));
    if (!number && !text(cell(row, DB.description)) && numberOf(cell(row, DB.amount)) === null) return;
    if (!number) {
      warnings.push(`DB, red ${index + 1}: stavka bez broja računa — preskočena`);
      return;
    }
    const key = `${entity}|${number}`;
    const group = groups.get(key) ?? { rows: [] };
    group.rows.push({ row, excelRow: index + 1 });
    groups.set(key, group);
  });

  const plan: ImportPlan = { families: [], children: [], invoices: [], paymentsForExisting: [], sequences: [] };
  const familyIds = new Map<string, string>();
  const childIds = new Map<string, string>();
  const lastNumbers: Record<LegalEntityCode, Record<number, number>> = { IMH: {}, IDSS: {} };
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
    if (entityText !== 'IMH' && entityText !== 'IDSS') {
      warnings.push(`DB, red ${first.excelRow}: račun ${number} ima nepoznatu ustanovu „${entityText}“ — preskočen`);
      continue;
    }
    const entity: LegalEntityCode = entityText;
    const storedNumber = `${entity} ${number}`;
    const seq = sequenceOf(number);
    if (seq) {
      const years = lastNumbers[entity];
      years[seq.year] = Math.max(years[seq.year] ?? 0, seq.sequence);
    }

    const father = personName(cell(first.row, DB.father));
    const mother = personName(cell(first.row, DB.mother));
    const childName = personName(cell(first.row, DB.child))?.replace(/^dijete:\s*/i, '').trim() || null;
    const paidFlag = group.rows.some(({ row }) => nameKey(text(cell(row, DB.status))) === 'plaćeno');

    const already = existing.invoices.get(storedNumber);
    if (already) {
      invoicesExisting += 1;
      const total = sum(group.rows.map(({ row }) => kmToFenings(numberOf(cell(row, DB.amount)) ?? 0)));
      if (paidFlag && already.paid === 0 && total > 0) {
        const due = dateOf(cell(first.row, DB.dueDate)) ?? dateOf(cell(first.row, DB.issueDate));
        if (due) {
          plan.paymentsForExisting.push({
            invoiceId: already.id,
            payment: { id: newId(), paidOn: due, amount: total, payerName: father ?? mother ?? '', note: PAYMENT_NOTE },
          });
          newlyPaid += 1;
        }
      }
      continue;
    }

    if (!father && !mother) {
      warnings.push(`DB, red ${first.excelRow}: račun ${number} nema kupca (otac/majka) — preskočen`);
      continue;
    }
    const issueDate = dateOf(cell(first.row, DB.issueDate));
    if (!issueDate) {
      warnings.push(`DB, red ${first.excelRow}: račun ${number} nema ispravan datum računa — preskočen`);
      continue;
    }
    let dueDate = dateOf(cell(first.row, DB.dueDate));
    if (!dueDate) {
      if (text(cell(first.row, DB.dueDate))) warnings.push(`DB, red ${first.excelRow}: račun ${number} ima neispravan rok „${text(cell(first.row, DB.dueDate))}“ — uzet datum računa`);
      dueDate = issueDate;
    }
    const periodFrom = dateOf(cell(first.row, DB.periodFrom)) ?? issueDate;
    const periodTo = dateOf(cell(first.row, DB.periodTo)) ?? periodFrom;

    const lines: InvoiceDraftLocal['lines'] = [];
    for (const { row } of group.rows) {
      const description = text(cell(row, DB.description));
      const amountValue = numberOf(cell(row, DB.amount)) ?? 0;
      const amount = kmToFenings(amountValue);
      if (!description && amount === 0) continue; // empty template row
      const quantity = numberOf(cell(row, DB.quantity)) ?? 1;
      const price = numberOf(cell(row, DB.price)) ?? amountValue;
      const discount = numberOf(cell(row, DB.discount)) ?? 0;
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
    if (lines.length === 0) {
      warnings.push(`DB, red ${first.excelRow}: račun ${number} nema nijednu stavku — preskočen`);
      continue;
    }
    lineCount += lines.length;
    const total = sum(lines.map((l) => l.amount));
    const kind = /^ko/i.test(number) ? 'CREDIT_NOTE' : 'OTHER';
    const family = touchFamily(father, mother);
    const childKey = childName ? `${family.key}|${nameKey(childName)}` : null;
    if (childName) family.children.set(nameKey(childName), childName);

    totals[entity].invoices += 1;
    if (kind === 'CREDIT_NOTE') totals[entity].creditNotes += 1;
    totals[entity].total += total;
    const payer = father ?? mother ?? '';
    let payment: PlanPayment | null = null;
    if (paidFlag && total > 0) {
      payment = { id: newId(), paidOn: dueDate, amount: total, payerName: payer, note: PAYMENT_NOTE };
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
      issueDate,
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
      warnings,
    },
  };
}
