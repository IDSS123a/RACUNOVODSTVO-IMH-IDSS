import { z } from 'zod';
import {
  addressField,
  emailField,
  FORMAT,
  fullNameField,
  ibanField,
  isRealDate,
  nameField,
  normalizeBankAccount,
  normalizeDocumentNumber,
  normalizeIban,
  normalizeJib,
  normalizeName,
  normalizeRegistration,
  normalizeSwift,
  normalizeWebsite,
  optionalField,
  optionalTextField,
  phoneField,
  requiredField,
  textField,
} from './formats';

/**
 * All Zod schemas of the application (Commander E-2: one file, imported everywhere).
 * Every value crossing the Tauri boundary (both directions) is parsed with these.
 *
 * WHY no `.default()`: Zod 3.25.x mis-infers optionality with defaults (Commander E-2
 * named pitfall). Defaults are applied explicitly in the domain layer instead.
 */

const fenings = z.number().int().safe();
const basisPoints = z.number().int().min(0).max(10_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'datum mora biti u formatu GGGG-MM-DD');
const schoolYear = z.string().regex(/^\d{4}\/\d{4}$/, 'školska godina mora biti u formatu 2026/2027');

export const LegalEntityCodeSchema = z.enum(['IMH', 'IDSS']);
export const ProgramCodeSchema = z.enum(['TODDLERS', 'PRESCHOOLERS', 'IDSS_PRESCHOOLERS', 'PRIMARY_1_4', 'PRIMARY_5_9']);
export const ResidencySchema = z.enum(['DOMESTIC', 'FOREIGN']);
export const PriceItemCodeSchema = z.enum([
  'ENROLMENT_FEE',
  'ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL',
  'MATERIALS',
  'DEPOSIT',
  'TUITION',
  'EXTENDED_STAY',
  'BREAKFAST',
]);
export const SiblingTierSchema = z.enum(['ANY', 'FIRST', 'SUBSEQUENT', 'SECOND', 'THIRD_PLUS']);
export const BillingBasisSchema = z.enum(['ONE_TIME', 'MONTHLY', 'ANNUAL']);

/** One price-list row (DL-P005). */
export const PriceListItemSchema = z.object({
  schoolYear,
  program: ProgramCodeSchema,
  item: PriceItemCodeSchema,
  residency: ResidencySchema,
  tier: SiblingTierSchema,
  basis: BillingBasisSchema,
  amount: fenings.nonnegative(),
  source: z.string().min(1),
});

/** Institution master data from the official letterheads (BR-2). */
export const InstitutionSchema = z.object({
  code: LegalEntityCodeSchema,
  fullName: z.string().min(3),
  shortName: z.string().min(2),
  address: z.string().min(3),
  phone: z.string(),
  fax: z.string(),
  mobile: z.string(),
  email: z.string().email().or(z.literal('')),
  website: z.string(),
  taxId: z.string().regex(/^\d{13}$/, 'ID broj mora imati 13 cifara'),
  registrationNumber: z.string().min(3),
  bankName: z.string().min(2),
  bankAccount: z.string().regex(/^[\d ]{16,24}$/, 'broj računa sadrži samo cifre i razmake'),
  iban: z.string().regex(/^BA\d{2}[\d ]{16,20}$/, 'IBAN mora počinjati s BA'),
  swift: z.string().regex(/^[A-Z0-9]{8,11}$/),
  /** Printed on every invoice (PDV / tax note); a legal statement entered by the operator, no default (M-4). */
  invoiceNote: z.string().max(500),
});

/** Operator profile — the only user (DL-P002). Stored only in the database (BR-22). */
export const OperatorSchema = z.object({
  fullName: z.string().trim().min(3, 'unesite ime i prezime'),
  jobTitle: z.string().trim(),
  email: z.string().trim().email('neispravan email').or(z.literal('')),
  phone: z.string().trim(),
});

/** Application settings. */
export const SettingsSchema = z.object({
  operator: OperatorSchema,
  backupFolder: z.string(),
  activeSchoolYear: schoolYear,
});

/** Written ministry approval for a price increase (D16, BR-20). */
export const MinistryApprovalSchema = z.object({
  schoolYear,
  documentNumber: z.string().trim().min(1, 'unesite broj akta'),
  documentDate: isoDate,
  note: z.string(),
});

/** Status of the encrypted database, returned by the backend. */
export const DatabaseStatusSchema = z.object({
  ready: z.boolean(),
  firstRun: z.boolean(),
  databasePath: z.string(),
  schemaVersion: z.number().int(),
});

/** Result of creating a backup. */
export const BackupResultSchema = z.object({
  filePath: z.string(),
  bytes: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export const PriceListItemsSchema = z.array(PriceListItemSchema);
export const InstitutionsSchema = z.array(InstitutionSchema);
export const MinistryApprovalsSchema = z.array(MinistryApprovalSchema);

export { basisPoints as BasisPointsSchema, fenings as FeningsSchema };

// ---------- Families (Sprint 02) ----------

const uuid = z.string().uuid();
const nonEmpty = (message: string) => z.string().trim().min(1, message);

export const GuardianRoleSchema = z.enum(['MOTHER', 'FATHER', 'GUARDIAN']);
export const EnrolmentStatusSchema = z.enum([
  'AWAITING_ENROLMENT_PAYMENT',
  'ACTIVE',
  'WITHDRAWAL_NOTIFIED',
  'WITHDRAWN',
  'SUSPENDED',
  'COMPLETED',
]);

/** Parent / guardian. The payer receives invoices; the IBAN is used for subsidy refunds (D5). */
export const GuardianSchema = z.object({
  id: uuid,
  familyId: uuid,
  fullName: nonEmpty('unesite ime i prezime'),
  role: GuardianRoleSchema,
  email: z.string().trim().email('neispravan email').or(z.literal('')),
  phone: z.string().trim(),
  iban: z.string().trim(),
  isPayer: z.boolean(),
});

export const FamilySchema = z.object({
  id: uuid,
  displayName: nonEmpty('unesite naziv porodice (npr. prezime)'),
  address: z.string().trim(),
});

export const ChildSchema = z.object({
  id: uuid,
  familyId: uuid,
  firstName: nonEmpty('unesite ime'),
  lastName: nonEmpty('unesite prezime'),
  /** Null only for children imported from the previous solution until the operator enters it (BR-32). */
  dateOfBirth: isoDate.nullable(),
  residency: ResidencySchema,
  /** Program 16/26 eligibility facts (subsidy, IMH only). */
  citizenBih: z.boolean(),
  residenceKs: z.boolean(),
  /** Imported data still to be checked by the operator; cleared when the child is saved. */
  importReview: z.boolean(),
});

/** The child form: the operator always enters the date of birth (also when completing an imported child). */

export const EnrolmentSchema = z.object({
  id: uuid,
  childId: uuid,
  program: ProgramCodeSchema,
  schoolYear,
  startsOn: isoDate,
  endsOn: isoDate.nullable(),
  status: EnrolmentStatusSchema,
});

export const FamilySummarySchema = z.object({
  id: uuid,
  displayName: z.string(),
  childCount: z.number().int().nonnegative(),
  payerName: z.string().nullable(),
});

export const FamilyDetailSchema = z.object({
  family: FamilySchema,
  guardians: z.array(GuardianSchema),
  children: z.array(ChildSchema),
  enrolments: z.array(EnrolmentSchema),
});

export const FamilySummariesSchema = z.array(FamilySummarySchema);

// ---------- Invoices (Sprint 03) ----------

export const InvoiceKindSchema = z.enum(['MONTHLY', 'ENROLMENT_FEES', 'INSTALMENT', 'OTHER', 'CREDIT_NOTE']);

/** Unit of measure of a line (document `vNew`: JM): proposed units or any other short unit (Director, 2026-11-22). */
export const LineUnitSchema = z.string().min(1).max(10);

export const InvoiceLineSchema = z
  .object({
  /** A price-list item, or `OTHER` = a service outside the price list (monthly or manual invoice). */
  itemCode: z.union([PriceItemCodeSchema, z.literal('OTHER')]),
  description: z.string().trim().min(1),
  childId: z.string().min(1),
  /** Empty only on a manual invoice for a child not enrolled in the institution (Director, 2026-11-21). */
  enrolmentId: z.string(),
  program: z.union([ProgramCodeSchema, z.literal('')]),
  listAmount: fenings.nonnegative(),
  boardDecisionId: z.string().nullable(),
  amount: fenings.nonnegative(),
  /** Whole quantity 1–999 (migration 013); omitted = 1. */
  quantity: z.number().int().min(1).max(999).optional(),
  /** Omitted = derived from the item code. */
  unit: LineUnitSchema.nullable().optional(),
  })
  .refine((l) => l.itemCode === 'OTHER' || (l.enrolmentId !== '' && l.program !== ''), {
    message: 'stavka cjenovnika mora imati upis',
  });

export const PlanItemRefSchema = z.object({ planId: z.string().min(1), sequence: z.number().int().min(1).max(12) });

export const InvoiceDraftSchema = z.object({
  id: uuid,
  entity: LegalEntityCodeSchema,
  kind: InvoiceKindSchema,
  familyId: uuid,
  childId: uuid,
  childName: z.string().min(1),
  buyerName: z.string().min(1),
  buyerAddress: z.string(),
  issueDate: isoDate,
  dueDate: isoDate,
  periodFrom: isoDate,
  periodTo: isoDate,
  lines: z.array(InvoiceLineSchema).min(1),
  total: fenings.nonnegative(),
  planItems: z.array(PlanItemRefSchema),
  /** Basis of a manual invoice (M11); omitted for the other kinds. */
  reason: z.string().optional(),
});

export const InvoiceSummarySchema = z.object({
  id: z.string(),
  number: z.string(),
  entity: LegalEntityCodeSchema,
  kind: InvoiceKindSchema,
  familyId: z.string(),
  familyName: z.string(),
  childId: z.string(),
  childName: z.string(),
  source: z.enum(['APP', 'LEGACY']),
  buyerName: z.string(),
  buyerAddress: z.string(),
  issueDate: isoDate,
  dueDate: isoDate,
  periodFrom: isoDate,
  periodTo: isoDate,
  total: fenings,
  /** Effective paid: payments without a reversal, plus credit moved in, minus credit moved out (migration 010). */
  paid: fenings,
  status: z.enum(['ISSUED', 'CANCELLED']),
  /** Sum of the credit notes that cancel this invoice (≤ 0). */
  credited: fenings.max(0),
  creditsInvoiceId: z.string().nullable(),
  reason: z.string(),
  /** Prepayment applied to this invoice — „Umanjeno za primljenu pretplatu“ on its PDF (specs/family-advance Q3). */
  appliedPrepayment: fenings.min(0).optional(),
});

export const PaymentSchema = z.object({
  id: uuid,
  invoiceId: z.string().min(1),
  paidOn: isoDate,
  amount: fenings.positive('iznos mora biti veći od nule'),
  payerName: z.string().trim().min(1, 'unesite ko je uplatio'),
  /** Relation of the payer to the child (roditelj, baka, tetka …); empty on older payments (migration 016). */
  payerRelation: z.string().trim().optional(),
  reference: z.string().trim(),
  note: z.string().trim(),
  /** Set by the backend when the payment was reversed (S4); never sent when booking a payment. */
  reversedOn: isoDate.nullable().optional(),
  reversalReason: z.string().nullable().optional(),
});

/** A stored line: imported lines (BR-32) have empty child/enrolment/program and free item codes. */
export const InvoiceDetailLineSchema = z.object({
  itemCode: z.string().min(1),
  description: z.string(),
  childId: z.string(),
  enrolmentId: z.string(),
  program: z.union([ProgramCodeSchema, z.literal('')]),
  listAmount: fenings,
  boardDecisionId: z.string().nullable(),
  amount: fenings,
  quantity: z.number().int().min(1),
  unit: LineUnitSchema.nullable(),
});

export const InvoiceDetailSchema = z.object({
  invoice: InvoiceSummarySchema,
  lines: z.array(InvoiceDetailLineSchema),
  payments: z.array(PaymentSchema),
  creditNotes: z.array(z.object({ id: z.string(), number: z.string(), issueDate: isoDate, total: fenings.max(-1), reason: z.string() })),
  creditedLines: z.array(z.object({ position: z.number().int().min(1), amount: fenings.max(0) })),
});

export const InvoiceSummariesSchema = z.array(InvoiceSummarySchema);

/** IDSS payment plan (BR-11). Amounts are produced by the domain; the backend re-checks the sums. */
export const PaymentPlanSchema = z.object({
  id: z.string().min(1),
  enrolmentId: z.string().min(1),
  childId: z.string().min(1),
  itemCode: z.enum(['TUITION', 'EXTENDED_STAY']),
  instalments: z.number().int().min(1).max(12),
  total: fenings.nonnegative(),
  items: z.array(
    z.object({
      sequence: z.number().int().min(1).max(12),
      dueDate: isoDate,
      amount: fenings.nonnegative(),
      invoiceId: z.string().nullable(),
    }),
  ),
});
export const PaymentPlansSchema = z.array(PaymentPlanSchema);

/** Billing parameters decided by the board per school year (BR-11); never assumed by the app. */
export const BoardBillingRulesSchema = z.object({
  schoolYear: z.string().regex(/^\d{4}\/\d{4}$/),
  entity: LegalEntityCodeSchema,
  lastInstalmentBy: isoDate.nullable(),
  breakfastMonths: z.array(z.number().int().min(1).max(12)),
  decisionRef: z.string().trim().min(1, 'unesite broj i datum odluke odbora'),
});

// ---------- Import from the previous Excel solution (BR-32) ----------

export const LegacyCellSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('Empty') }),
  z.object({ t: z.literal('Text'), v: z.string() }),
  z.object({ t: z.literal('Number'), v: z.number() }),
  z.object({ t: z.literal('Date'), v: z.string() }),
]);

export const LegacyWorkbookSchema = z.object({
  fileName: z.string(),
  db: z.array(z.array(LegacyCellSchema)),
  setting: z.array(z.array(LegacyCellSchema)),
});

export const LegacyKeysSchema = z.object({
  families: z.array(z.tuple([z.string(), z.string()])),
  children: z.array(z.tuple([z.string(), z.string()])),
  invoices: z.array(z.tuple([z.string(), z.string(), fenings])),
});

export const LegacyImportResultSchema = z.object({
  families: z.number().int(),
  children: z.number().int(),
  invoices: z.number().int(),
  payments: z.number().int(),
  findings: z.number().int(),
  nextNumbers: z.array(z.tuple([LegalEntityCodeSchema, z.number().int(), z.number().int()])),
});

/** One stored finding of the legacy import (migration 009, specs/legacy-import-diagnostics). */
export const ImportFindingRowSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  severity: z.enum(['ISOLATE', 'REVIEW', 'INFO']),
  entity: z.string(),
  number: z.string(),
  invoiceId: z.string().nullable(),
  buyerName: z.string(),
  childName: z.string(),
  excelRows: z.string(),
  reason: z.string(),
  amount: z.number().int().nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  lastSeenFile: z.string(),
  resolvedAt: z.string().nullable(),
  resolutionNote: z.string(),
});

/** Resolution note entered by the operator (mirrors the backend limit). */
export const ResolutionNoteSchema = z.string().trim().min(1, 'upišite kako je nalaz riješen').max(500, 'najviše 500 znakova');


// ---------- Storno, credit notes, payment correction (specs/storno-credit-notes) ----------

/** Reason or note entered by the operator (mirrors the backend limit of 500 characters). */
const operatorText = (what: string) => z.string().trim().min(1, `upišite ${what}`).max(500, 'najviše 500 znakova');

export const CreditNoteLineSchema = z.object({
  position: z.number().int().min(1),
  amount: fenings.max(-1, 'iznos knjižnog odobrenja mora biti negativan'),
});

export const CreditNoteDraftSchema = z.object({
  id: uuid,
  invoiceId: z.string().min(1),
  issueDate: isoDate,
  reason: operatorText('razlog knjižnog odobrenja'),
  lines: z.array(CreditNoteLineSchema).min(1, 'odaberite barem jednu stavku'),
});

export const IssuedCreditNoteSchema = z.object({ number: z.string().min(1), cancelled: z.boolean() });

export const PaymentReversalSchema = z.object({
  paymentId: z.string().min(1),
  reversedOn: isoDate,
  reason: operatorText('razlog storna uplate'),
});

// ---------- Form input schemas: canonical formats (Director, 2026-11-21; DL-P017) ----------
// Stored data is read with the lenient schemas above; everything the operator types is validated and normalized here,
// so every saved value has exactly one format.

const today = (): string => new Date().toISOString().slice(0, 10);
const pastDate = (message: string) => isoDate.refine((d) => isRealDate(d) && d <= today(), message);

export const InstitutionFormSchema = InstitutionSchema.extend({
  fullName: textField(200, 'puni naziv'),
  shortName: textField(120, 'skraćeni naziv'),
  address: addressField(),
  phone: phoneField(),
  fax: phoneField(),
  mobile: phoneField(),
  email: emailField(),
  website: optionalField(normalizeWebsite, `Neispravna web adresa. Format: ${FORMAT.website}.`),
  taxId: requiredField(normalizeJib, `Neispravan ID broj. Format: ${FORMAT.jib}.`),
  registrationNumber: requiredField(normalizeRegistration, `Neispravan registarski broj. Format: ${FORMAT.registration}.`),
  bankName: textField(120, 'naziv banke'),
  bankAccount: requiredField(normalizeBankAccount, `Neispravan broj računa (kontrolni broj). Format: ${FORMAT.bankAccount}.`),
  iban: requiredField(normalizeIban, `Neispravan IBAN. Format: ${FORMAT.iban}.`),
  swift: requiredField(normalizeSwift, `Neispravan SWIFT. Format: ${FORMAT.swift}.`),
  invoiceNote: optionalTextField(500),
});

export const OperatorFormSchema = OperatorSchema.extend({
  fullName: fullNameField(),
  jobTitle: optionalTextField(60),
  email: emailField(),
  phone: phoneField(),
});

export const GuardianFormSchema = GuardianSchema.extend({
  fullName: fullNameField(),
  email: emailField(),
  phone: phoneField(),
  iban: ibanField(),
});

export const FamilyFormSchema = FamilySchema.extend({
  displayName: requiredField(normalizeName, `Neispravan naziv porodice. Dozvoljeno: ${FORMAT.name} (npr. Begić).`),
  address: addressField(),
});

export const ChildInputSchema = ChildSchema.extend({
  firstName: nameField(),
  lastName: nameField(),
  dateOfBirth: pastDate('unesite stvarni datum rođenja (ne u budućnosti)')
    // a child of the institutions is at most 16 (Director, 2026-11-22: a kindergarten child born in 1998 was accepted)
    .refine((d) => d >= `${Number(today().slice(0, 4)) - 17}${today().slice(4)}`, 'dijete bi imalo više od 16 godina — provjerite datum rođenja')
    .nullable()
    .refine((d) => d !== null, 'unesite datum rođenja'),
});

export const MinistryApprovalFormSchema = MinistryApprovalSchema.extend({
  documentNumber: requiredField(normalizeDocumentNumber, `Neispravan broj akta. Format: ${FORMAT.documentNumber}.`),
  documentDate: pastDate('unesite stvarni datum akta (ne u budućnosti)'),
  note: optionalTextField(200),
});

// ---------- Child prepayment (specs/family-advance, migration 016) ----------

/** One child's ledger card in one institution; childId null = invoices without a child. saldo < 0 = u pretplati. */
export const ChildBalanceSchema = z.object({
  entity: LegalEntityCodeSchema,
  childId: z.string().nullable(),
  charged: fenings,
  received: fenings,
  transferredIn: fenings,
  transferredOut: fenings,
  refunded: fenings,
  prepaid: fenings.min(0),
  saldo: fenings,
});

/** A child's card with the names (reports). */
export const NamedBalanceSchema = ChildBalanceSchema.extend({ familyId: z.string(), familyName: z.string(), childName: z.string() });

export const PrepaymentUseSchema = z.object({
  id: z.string(),
  invoiceId: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  amount: fenings,
  usedOn: isoDate,
  note: z.string(),
  reversedOn: isoDate.nullable(),
  reversalReason: z.string().nullable(),
});

export const PrepaymentRowSchema = z.object({
  id: z.string(),
  entity: LegalEntityCodeSchema,
  childId: z.string(),
  paidOn: isoDate,
  amount: fenings.positive(),
  payerName: z.string(),
  payerRelation: z.string(),
  reference: z.string(),
  note: z.string(),
  reversedOn: isoDate.nullable(),
  reversalReason: z.string().nullable(),
  remaining: fenings.min(0),
  uses: z.array(PrepaymentUseSchema),
});

export const PrepaidSourceSchema = z.object({
  kind: z.enum(['PREPAYMENT', 'EXCESS']),
  id: z.string(),
  date: isoDate,
  label: z.string(),
  remaining: fenings.positive(),
});

export const PrepaymentInputSchema = z.object({
  id: uuid,
  familyId: z.string().min(1),
  entity: LegalEntityCodeSchema,
  childId: z.string().min(1, 'izaberite dijete'),
  paidOn: isoDate,
  amount: fenings.positive('iznos mora biti veći od nule'),
  payerName: z.string().trim().min(1, 'unesite ko je uplatio'),
  payerRelation: z.string().trim().min(1, 'izaberite ili upišite odnos prema djetetu'),
  reference: z.string().trim(),
  note: z.string().trim(),
});
