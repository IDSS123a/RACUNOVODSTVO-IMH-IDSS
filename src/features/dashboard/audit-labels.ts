/**
 * Bosnian labels of the audit log (BR-30; specs/dashboard-audit). Every action and entity code written by the
 * backend (`repo::audit` in src-tauri/src) has a label; a test reads the Rust sources and fails when one is missing.
 * An unknown code is still shown, as it is — never hidden.
 */

export const ACTION_LABEL: Readonly<Record<string, string>> = {
  ISSUE: 'Izdat račun',
  PAYMENT: 'Evidentirana uplata',
  PAYMENT_REVERSAL: 'Storno uplate',
  CREDIT_NOTE: 'Izdato knjižno odobrenje',
  CREDIT_NOTE_LINK: 'Povezano uvezeno knjižno odobrenje',
  CREDIT_MOVE: 'Prenesen kredit porodice',
  CREDIT_REFUND: 'Povrat kredita porodice',
  SAVE: 'Sačuvano',
  UPSERT: 'Sačuvano',
  UPDATE: 'Izmijenjeno',
  DELETE: 'Obrisano',
  EXPORT: 'Izvezen dokument',
  MAIL_DRAFT: 'Pripremljen e-mail (Outlook)',
  IMPORT: 'Uvoz iz Excela',
  RESOLVE: 'Riješen nalaz uvoza',
  BACKUP: 'Rezervna kopija',
  RESTORE: 'Vraćena rezervna kopija',
  SEED: 'Početni podaci',
  ACKNOWLEDGE: 'Potvrđen ključ za oporavak',
  BREAKFAST_ON: 'Doručak uključen',
  BREAKFAST_OFF: 'Doručak isključen',
};

export const ENTITY_LABEL: Readonly<Record<string, string>> = {
  invoice: 'Račun',
  payment: 'Uplata',
  payment_plan: 'Plan plaćanja',
  document: 'Dokument',
  family: 'Porodica',
  child: 'Dijete',
  enrolment: 'Upis',
  import_finding: 'Nalaz uvoza',
  legacy: 'Excel datoteka',
  legal_entity: 'Podaci ustanove',
  settings: 'Postavke',
  database: 'Baza podataka',
  recovery_key: 'Ključ za oporavak',
  reference_data: 'Cjenovnik i ustanove',
  ministry_approval: 'Saglasnost ministarstva',
  board_rules: 'Pravila naplate (odbor)',
};

export const actionLabel = (code: string): string => ACTION_LABEL[code] ?? code;
export const entityLabel = (code: string): string => ENTITY_LABEL[code] ?? code;

/** Entity kinds whose name the backend resolves; a missing name then means the record was deleted. */
const NAMED = new Set(['invoice', 'payment', 'family', 'child', 'enrolment']);

/** Readable object of an entry: its kind and name, „(obrisano)“ when the named record no longer exists. */
export function objectText(entry: { readonly entity: string; readonly entityId: string; readonly subject: string | null }): string {
  const kind = entityLabel(entry.entity);
  if (entry.subject) return `${kind}: ${entry.subject}`;
  if (NAMED.has(entry.entity) && entry.entityId) return `${kind} (obrisano)`;
  return entry.entityId ? `${kind}: ${entry.entityId}` : kind;
}
