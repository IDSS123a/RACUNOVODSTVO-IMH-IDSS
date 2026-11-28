import { invoiceBalance, type BalanceStatus } from './credit-notes';
import type { InvoiceSummary } from './repository';

/**
 * Search in the invoice register (Director, 2026-11-21: „efikasno pretraživanje … da operater ne skrola“).
 * One field finds an invoice by number, child, buyer or family, ignoring case and Bosnian diacritics, and however the
 * number is typed: „12/26“, „012/26“, „imh 12 26“ and „IMH-012/26“ all find IMH-012/26. Several words must all match.
 */

/** Lower case without diacritics: „Đurđa Čolić“ → „djurdja colic“. */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase('bs')
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** An invoice number without separators, also with the leading zeros of its sequence dropped. */
function numberKeys(number: string): string[] {
  const compact = fold(number).replace(/[^a-z0-9]/g, '');
  const unpadded = fold(number)
    .replace(/(^|[^0-9])0+(?=\d)/g, '$1')
    .replace(/[^a-z0-9]/g, '');
  return [compact, unpadded];
}

export type StatusFilter = 'ALL' | BalanceStatus | 'CREDIT_NOTE' | 'OVERDUE';

export const STATUS_FILTER_LABEL: Readonly<Record<StatusFilter, string>> = {
  ALL: 'Svi statusi',
  OPEN: 'Otvoren',
  PARTIALLY_PAID: 'Djelimično plaćen',
  PAID: 'Plaćen',
  OVERPAID: 'Plaćen · višak u pretplati',
  CANCELLED: 'Storniran',
  CREDIT_NOTE: 'Knjižno odobrenje',
  OVERDUE: 'Dospjelo, a neplaćeno',
};

/** True when every word of the query is found in the invoice. */
export function matchesQuery(invoice: InvoiceSummary, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const raw = [invoice.childName, invoice.buyerName, invoice.familyName, invoice.number, invoice.entity].join(' ');
  // „đ“ is typed as „dj“ or as „d“ without Bosnian letters: both are searched
  const text = `${fold(raw)} ${fold(raw.replace(/đ/g, 'd').replace(/Đ/g, 'D'))}`;
  const keys = numberKeys(invoice.number);
  const compactQuery = fold(query).replace(/[^a-z0-9]/g, '');
  // the whole query as a number („imh 12 26“ → „imh1226“)
  if (compactQuery.length >= 3 && /\d/.test(compactQuery) && keys.some((k) => k.includes(compactQuery))) return true;
  return words.every((word) => {
    if (text.includes(word)) return true;
    const compact = word.replace(/[^a-z0-9]/g, '');
    return compact !== '' && /\d/.test(compact) && keys.some((k) => k.includes(compact));
  });
}

export function matchesStatus(invoice: InvoiceSummary, status: StatusFilter, today: string): boolean {
  if (status === 'ALL') return true;
  if (status === 'CREDIT_NOTE') return invoice.kind === 'CREDIT_NOTE';
  if (invoice.kind === 'CREDIT_NOTE') return false;
  const balance = invoiceBalance(invoice);
  if (status === 'OVERDUE') return invoice.status === 'ISSUED' && balance.open > 0 && invoice.dueDate < today;
  return balance.status === status;
}

export function searchInvoices(
  invoices: ReadonlyArray<InvoiceSummary>,
  query: string,
  status: StatusFilter,
  today: string,
): InvoiceSummary[] {
  return invoices.filter((i) => matchesStatus(i, status, today) && matchesQuery(i, query));
}
