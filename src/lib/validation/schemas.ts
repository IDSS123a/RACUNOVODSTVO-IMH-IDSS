import { z } from 'zod';

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
