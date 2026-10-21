import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import { BoardBillingRulesSchema } from '@/lib/validation/schemas';
import type { SchoolYear } from '@/features/price-lists/types';
import type { BoardBillingRules } from './types';

/** Board billing rules and breakfast opt-in — Infrastructure layer (A-3). */

export function listBoardRules(schoolYear: SchoolYear): Promise<Result<BoardBillingRules[]>> {
  return call('list_board_rules', z.array(BoardBillingRulesSchema), { schoolYear });
}

export function saveBoardRules(rules: BoardBillingRules): Promise<Result<null>> {
  return call('save_board_rules', z.null(), { rules: BoardBillingRulesSchema.parse(rules) });
}

/** Enrolment ids with breakfast in the school year. */
export function listBreakfast(schoolYear: SchoolYear): Promise<Result<string[]>> {
  return call('list_breakfast', z.array(z.string()), { schoolYear });
}

export function setBreakfast(enrolmentId: string, on: boolean): Promise<Result<null>> {
  return call('set_breakfast', z.null(), { enrolmentId, on });
}
