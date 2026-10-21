import { listBoardRules, saveBoardRules, setBreakfast } from '@/features/board-rules/repository';
import { getFamily, listFamilies, saveChild, saveEnrolment } from '@/features/families/repository';
import { saveFamilyWithGuardians } from '@/features/families/actions';
import type { Child, Enrolment, Guardian } from '@/features/families/types';
import { proposeIdssPlan, type PlanItemCode } from '@/features/invoices/plans';
import { savePaymentPlan } from '@/features/invoices/repository';
import { listPriceItems } from '@/features/price-lists/repository';
import type { ProgramCode, SchoolYear } from '@/features/price-lists/types';
import type { Result } from '@/lib/tauri/invoke';

/**
 * DEVELOPMENT ONLY — fictional demo families for walkthroughs on the developer PC.
 * Loaded through a button that exists only when `import.meta.env.DEV` is true, so this module is
 * never part of the build installed for the operator. All names are invented and marked "(demo)".
 */

interface DemoChild {
  readonly firstName: string;
  readonly dateOfBirth: string;
  readonly program: ProgramCode;
  readonly plans?: ReadonlyArray<{ item: PlanItemCode; instalments: number }>;
  readonly breakfast?: boolean;
}

interface DemoFamily {
  readonly lastName: string;
  readonly address: string;
  readonly guardians: ReadonlyArray<{ fullName: string; role: Guardian['role']; isPayer: boolean }>;
  readonly children: ReadonlyArray<DemoChild>;
}

const DEMO_MARK = 'Demo';

const FAMILIES: ReadonlyArray<DemoFamily> = [
  {
    lastName: 'Begić',
    address: 'Ulica Demo 1, 71000 Sarajevo',
    guardians: [
      { fullName: 'Amra Begić (demo)', role: 'MOTHER', isPayer: true },
      { fullName: 'Edin Begić (demo)', role: 'FATHER', isPayer: false },
    ],
    children: [
      { firstName: 'Emina', dateOfBirth: '2017-09-01', program: 'PRIMARY_1_4', plans: [{ item: 'TUITION', instalments: 10 }], breakfast: true },
      { firstName: 'Lejla', dateOfBirth: '2021-03-10', program: 'IDSS_PRESCHOOLERS' },
      { firstName: 'Tarik', dateOfBirth: '2023-05-02', program: 'TODDLERS' },
    ],
  },
  {
    lastName: 'Kovač',
    address: 'Ulica Demo 2, 71000 Sarajevo',
    guardians: [{ fullName: 'Mirza Kovač (demo)', role: 'FATHER', isPayer: true }],
    children: [
      { firstName: 'Adnan', dateOfBirth: '2014-02-11', program: 'PRIMARY_5_9', plans: [{ item: 'TUITION', instalments: 12 }, { item: 'EXTENDED_STAY', instalments: 10 }] },
      { firstName: 'Sara', dateOfBirth: '2018-06-20', program: 'PRIMARY_1_4', plans: [{ item: 'TUITION', instalments: 10 }] },
    ],
  },
  {
    lastName: 'Marić',
    address: 'Ulica Demo 3, 71000 Sarajevo',
    guardians: [{ fullName: 'Ivana Marić (demo)', role: 'MOTHER', isPayer: true }],
    children: [{ firstName: 'Nora', dateOfBirth: '2022-01-15', program: 'PRESCHOOLERS' }],
  },
  {
    // Deliberately without a payment plan: the monthly preview must list this child as a problem.
    lastName: 'Hadžić',
    address: 'Ulica Demo 4, 71000 Sarajevo',
    guardians: [{ fullName: 'Selma Hadžić (demo)', role: 'MOTHER', isPayer: true }],
    children: [{ firstName: 'Dino', dateOfBirth: '2016-11-30', program: 'PRIMARY_1_4' }],
  },
];

function fail(error: string): Result<never> {
  return { success: false, error, code: 'DEMO' };
}

/** Load the demo families into the (test) database. Refuses when demo families already exist. */
export async function loadDemoData(schoolYear: SchoolYear): Promise<Result<string>> {
  const existing = await listFamilies();
  if (!existing.success) return existing;
  if (existing.data.some((f) => f.displayName.startsWith(DEMO_MARK))) return fail('demo podaci su već učitani');
  const prices = await listPriceItems(schoolYear);
  if (!prices.success) return prices;
  const start = `${schoolYear.slice(0, 4)}-09-01`;

  const rules = await listBoardRules(schoolYear);
  if (!rules.success) return rules;
  if (!rules.data.some((r) => r.entity === 'IDSS')) {
    const saved = await saveBoardRules({
      schoolYear, entity: 'IDSS', lastInstalmentBy: null, breakfastMonths: [9, 10, 11, 12, 1, 2, 3, 4, 5, 6], decisionRef: 'DEMO — nije stvarna odluka',
    });
    if (!saved.success) return saved;
  }

  let children = 0;
  for (const demo of FAMILIES) {
    const familyId = crypto.randomUUID();
    const guardians: Guardian[] = demo.guardians.map((g) => ({ id: crypto.randomUUID(), familyId, fullName: g.fullName, role: g.role, email: '', phone: '', iban: '', isPayer: g.isPayer }));
    const family = await saveFamilyWithGuardians({ id: familyId, displayName: `${DEMO_MARK} ${demo.lastName}`, address: demo.address }, guardians);
    if (!family.success) return family;

    const enrolments: Array<{ enrolment: Enrolment; demo: DemoChild }> = [];
    for (const c of demo.children) {
      const child: Child = { id: crypto.randomUUID(), familyId, firstName: c.firstName, lastName: demo.lastName, dateOfBirth: c.dateOfBirth, residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: false };
      const savedChild = await saveChild(child);
      if (!savedChild.success) return savedChild;
      const enrolment: Enrolment = { id: crypto.randomUUID(), childId: child.id, program: c.program, schoolYear, startsOn: start, endsOn: null, status: 'ACTIVE' };
      const savedEnrolment = await saveEnrolment(enrolment);
      if (!savedEnrolment.success) return savedEnrolment;
      enrolments.push({ enrolment, demo: c });
      children += 1;
    }

    const detail = await getFamily(familyId);
    if (!detail.success) return detail;
    for (const { enrolment, demo: c } of enrolments) {
      for (const plan of c.plans ?? []) {
        const proposal = proposeIdssPlan(detail.data, prices.data, enrolment.id, plan.item, plan.instalments, null);
        const saved = await savePaymentPlan({
          id: crypto.randomUUID(), enrolmentId: enrolment.id, childId: enrolment.childId, itemCode: plan.item,
          instalments: proposal.items.length, total: proposal.total, items: proposal.items.map((i) => ({ ...i, invoiceId: null })),
        });
        if (!saved.success) return saved;
      }
      if (c.breakfast) {
        const saved = await setBreakfast(enrolment.id, true);
        if (!saved.success) return saved;
      }
    }
  }
  return { success: true, data: `Učitano ${FAMILIES.length} demo porodice, ${children} djece, planovi plaćanja i pravila ŠO (demo).` };
}
