import { formatKM, sum, type Fenings } from '@/features/billing/money';
import { BALANCE_LABEL, invoiceBalance } from '@/features/invoices/credit-notes';
import { amountDue } from '@/features/invoices/pdf';
import type { InvoiceSummary, NamedBalance } from '@/features/invoices/repository';
import { para, table } from '@/lib/export/docx';
import { onLetterhead } from '@/lib/export/letterhead';
import { buildWorkbook, type Cell } from '@/lib/export/xlsx';
import { formatDate } from '@/lib/format';

/**
 * Reporting exports (DEFINICIJA-APLIKACIJE M7, §4 task 3 — operations on existing data only): the invoice register
 * as XLSX (summary, invoices, by month, open by family), CSV and a DOCX report. Every figure is on the register's one
 * balance definition (`invoiceBalance`, `amountDue`, M-7); amounts in KM with two decimals.
 */

export interface ReportMeta {
  /** e.g. „IMH, 01.09.2026. – 30.11.2026.“ */
  readonly title: string;
  readonly createdOn: string;
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  MONTHLY: 'Mjesečna',
  INSTALMENT: 'Mjesečna (rate)',
  ENROLMENT_FEES: 'Upis',
  OTHER: 'Ostalo',
  CREDIT_NOTE: 'Knjižno odobrenje',
};

const km = (f: Fenings): number => f / 100;

export const REGISTER_HEADER: ReadonlyArray<string> = [
  'Broj', 'Vrsta', 'Ustanova', 'Datum izdavanja', 'Rok plaćanja', 'Period od', 'Period do', 'Dijete', 'Kupac', 'Porodica',
  'Iznos (KM)', 'Knjižna odobrenja (KM)', 'Za uplatu (KM)', 'Uplaćeno (KM)', 'Saldo (KM)', 'Status', 'Izvor',
];

/** One row per invoice, oldest first. */
export function registerRows(invoices: ReadonlyArray<InvoiceSummary>): Cell[][] {
  return [...invoices]
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number))
    .map((i) => {
      const b = invoiceBalance(i);
      const isCredit = i.kind === 'CREDIT_NOTE';
      return [
        i.number,
        KIND_LABEL[i.kind] ?? i.kind,
        i.entity,
        formatDate(i.issueDate),
        formatDate(i.dueDate),
        formatDate(i.periodFrom),
        formatDate(i.periodTo),
        i.childName,
        i.buyerName,
        i.familyName,
        km(i.total),
        km(i.credited),
        km(amountDue(i)),
        isCredit ? null : km(b.paid),
        isCredit ? null : km(b.open), // an excess is the child's prepayment, not a negative invoice (Q4)
        isCredit ? 'Knjižno odobrenje' : BALANCE_LABEL[b.status],
        i.source === 'LEGACY' ? 'Uvezeno (Excel)' : 'Aplikacija',
      ];
    });
}

interface Totals {
  readonly count: number;
  readonly invoiced: Fenings;
  readonly paid: Fenings;
  readonly open: Fenings;
  readonly overdue: Fenings;
}

/** Totals over invoices that count (no credit-note documents, nothing cancelled). */
export function totals(invoices: ReadonlyArray<InvoiceSummary>, today: string): Totals {
  const rows = invoices.filter((i) => i.kind !== 'CREDIT_NOTE' && i.status === 'ISSUED').map((i) => ({ i, b: invoiceBalance(i) }));
  return {
    count: rows.length,
    invoiced: sum(rows.map((r) => r.b.net)),
    paid: sum(rows.map((r) => Math.min(r.b.paid, r.b.net))),
    open: sum(rows.map((r) => r.b.open)),
    overdue: sum(rows.filter((r) => r.b.open > 0 && r.i.dueDate < today).map((r) => r.b.open)),
  };
}

/** Per billing month (by period): invoiced, paid, open. */
export function byMonth(invoices: ReadonlyArray<InvoiceSummary>, today: string): Array<{ month: string } & Totals> {
  const months = [...new Set(invoices.map((i) => i.periodFrom.slice(0, 7)))].sort();
  return months.map((month) => ({ month, ...totals(invoices.filter((i) => i.periodFrom.slice(0, 7) === month), today) }));
}

/** Open amount per family, largest first. */
export function openByFamily(invoices: ReadonlyArray<InvoiceSummary>): Array<{ family: string; buyer: string; count: number; open: Fenings }> {
  const map = new Map<string, { family: string; buyer: string; count: number; open: Fenings }>();
  for (const i of invoices) {
    if (i.kind === 'CREDIT_NOTE' || i.status !== 'ISSUED') continue;
    const open = invoiceBalance(i).open;
    if (open <= 0) continue;
    const entry = map.get(i.familyId) ?? { family: i.familyName, buyer: i.buyerName, count: 0, open: 0 };
    map.set(i.familyId, { ...entry, count: entry.count + 1, open: entry.open + open });
  }
  return [...map.values()].sort((a, b) => b.open - a.open);
}

const monthText = (ym: string): string => `${ym.slice(5, 7)}.${ym.slice(0, 4)}.`;

/** The children in prepayment (saldo below zero) or with prepaid money, for the accountant (specs/family-advance, K1). */
export function prepaymentRows(balances: ReadonlyArray<NamedBalance>): Cell[][] {
  return balances
    .filter((b) => b.saldo < 0 || b.prepaid > 0)
    .sort((a, b) => a.entity.localeCompare(b.entity) || a.familyName.localeCompare(b.familyName, 'bs') || a.childName.localeCompare(b.childName, 'bs'))
    .map((b) => [b.entity, b.familyName, b.childName || 'Računi bez djeteta', km(b.charged), km(b.received), km(b.transferredIn - b.transferredOut), km(b.refunded), km(b.prepaid), km(b.saldo)]);
}

export const PREPAYMENT_HEADER: ReadonlyArray<string> = [
  'Ustanova', 'Porodica', 'Dijete', 'Zaduženo (KM)', 'Uplaćeno (KM)', 'Preneseno od/na brata/sestru (KM)', 'Vraćeno (KM)', 'Pretplata na raspolaganju (KM)', 'Saldo (KM)',
];

/** Σ of the negative saldos: what the institution holds in prepayments. */
export function prepaidTotal(balances: ReadonlyArray<{ readonly saldo: number }>): Fenings {
  return sum(balances.map((b) => Math.min(0, b.saldo)));
}

export function buildRegisterXlsx(invoices: ReadonlyArray<InvoiceSummary>, meta: ReportMeta, balances: ReadonlyArray<NamedBalance> = []): Uint8Array {
  const t = totals(invoices, meta.createdOn);
  return buildWorkbook([
    {
      name: 'Sažetak',
      rows: [
        ['Izvještaj o fakturisanju i naplati'],
        ['Obuhvat', meta.title],
        ['Datum izvještaja', formatDate(meta.createdOn)],
        [],
        ['Broj faktura', t.count],
        ['Fakturisano (KM)', km(t.invoiced)],
        ['Naplaćeno (KM)', km(t.paid)],
        ['Otvoreno (KM)', km(t.open)],
        ['Od toga dospjelo (KM)', km(t.overdue)],
        ['U pretplati na dan izvještaja (KM)', km(prepaidTotal(balances))],
      ],
    },
    { name: 'Fakture', rows: [[...REGISTER_HEADER], ...registerRows(invoices)] },
    {
      name: 'Po mjesecima',
      rows: [
        ['Mjesec', 'Broj faktura', 'Fakturisano (KM)', 'Naplaćeno (KM)', 'Otvoreno (KM)', 'Dospjelo (KM)'],
        ...byMonth(invoices, meta.createdOn).map((m) => [monthText(m.month), m.count, km(m.invoiced), km(m.paid), km(m.open), km(m.overdue)]),
      ],
    },
    {
      name: 'Otvoreno po porodicama',
      rows: [['Porodica', 'Kupac', 'Otvorenih faktura', 'Otvoreno (KM)'], ...openByFamily(invoices).map((f) => [f.family, f.buyer, f.count, km(f.open)])],
    },
    { name: 'Pretplate', rows: [[...PREPAYMENT_HEADER], ...prepaymentRows(balances)] },
  ]);
}

function csvField(value: Cell): string {
  if (value === null) return '';
  // decimal comma for the Bosnian Excel; every text field quoted, quotes doubled; a leading = + - @ is neutralised (E-4)
  if (typeof value === 'number') return value.toFixed(2).replace('.', ',');
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** The register as CSV: „;“-separated, UTF-8 with BOM, so Excel opens it with č/ć/š/ž/đ intact. */
export function buildRegisterCsv(invoices: ReadonlyArray<InvoiceSummary>): Uint8Array {
  const lines = [REGISTER_HEADER.map(csvField).join(';'), ...registerRows(invoices).map((row) => row.map(csvField).join(';'))];
  const CRLF = String.fromCharCode(13, 10);
  return new TextEncoder().encode(`${String.fromCharCode(0xfeff)}${lines.join(CRLF)}${CRLF}`);
}

/**
 * A Word report on the institution's letterhead (an official document, Director 2026-11-21): place and date, summary,
 * months, largest open amounts, and the line for the signature.
 */
export function buildRegisterDocx(invoices: ReadonlyArray<InvoiceSummary>, meta: ReportMeta, letterhead: Uint8Array): Uint8Array {
  const t = totals(invoices, meta.createdOn);
  const parts = [
    para(`Sarajevo, ${formatDate(meta.createdOn)} godine`, { size: 10, align: 'right' }),
    para(''),
    para('Izvještaj o fakturisanju i naplati', { bold: true, size: 16 }),
    para(`${meta.title} · izvještaj od ${formatDate(meta.createdOn)}`, { size: 10 }),
    para(''),
    table([5000, 3000], [
      ['Broj faktura', String(t.count)],
      ['Fakturisano', formatKM(t.invoiced)],
      ['Naplaćeno', formatKM(t.paid)],
      ['Otvoreno', formatKM(t.open)],
      ['Od toga dospjelo', formatKM(t.overdue)],
    ], { right: [1] }),
    para(''),
    para('Po mjesecima', { bold: true, size: 12 }),
    table([2000, 1400, 2200, 2200, 2200], [
      ['Mjesec', 'Faktura', 'Fakturisano', 'Naplaćeno', 'Otvoreno'],
      ...byMonth(invoices, meta.createdOn).map((m) => [monthText(m.month), String(m.count), formatKM(m.invoiced), formatKM(m.paid), formatKM(m.open)]),
    ], { header: true, right: [1, 2, 3, 4] }),
    para(''),
    para('Najveći otvoreni iznosi po porodicama', { bold: true, size: 12 }),
    table([3500, 3500, 1200, 2000], [
      ['Porodica', 'Kupac', 'Faktura', 'Otvoreno'],
      ...openByFamily(invoices).slice(0, 25).map((f) => [f.family, f.buyer, String(f.count), formatKM(f.open)]),
    ], { header: true, right: [2, 3] }),
    para(''),
    para(''),
    para('Izvještaj sastavio/la: ______________________', { size: 10 }),
  ];
  return onLetterhead(letterhead, parts);
}
