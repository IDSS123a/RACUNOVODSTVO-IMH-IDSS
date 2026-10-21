import { invoke } from '@tauri-apps/api/core';
import type { ZodType } from 'zod';

/**
 * Typed bridge to Tauri commands (Infrastructure layer, DL-P001).
 * Every response is parsed with Zod before the app trusts it (E-2), and every
 * call returns the Commander standard shape (E-5) instead of throwing.
 */

export type Result<T> = { success: true; data: T } | { success: false; error: string; code: string };

interface BackendError {
  code: string;
  message: string;
}

function isBackendError(value: unknown): value is BackendError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

/** User-facing Bosnian messages per backend error code; technical detail goes to the console. */
const FRIENDLY: Readonly<Record<string, string>> = {
  DATABASE: 'Greška u bazi podataka. Pokušajte ponovo.',
  IO: 'Fajl ili folder nije dostupan.',
  CRYPTO: 'Fajl nije moguće dešifrovati (pogrešan ključ ili oštećen fajl).',
  KEY_STORE: 'Ključ baze nije dostupan na ovom Windows nalogu.',
  VALIDATION: 'Podaci nisu ispravni.',
  NOT_FOUND: 'Traženi podatak nije pronađen.',
  CONFLICT: 'Podatak je u međuvremenu promijenjen ili već postoji.',
  JSON: 'Neispravan format podataka.',
  RESPONSE: 'Aplikacija je dobila neočekivan odgovor.',
  UNKNOWN: 'Neočekivana greška.',
};

/**
 * Call a command and validate its response.
 * @param command Rust command name
 * @param schema Zod schema of the expected response
 * @param args command arguments (already validated by the caller)
 */
export async function call<T>(command: string, schema: ZodType<T>, args?: Record<string, unknown>): Promise<Result<T>> {
  try {
    const raw: unknown = await invoke(command, args);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[${new Date().toISOString()}] ${command}: invalid response`, parsed.error.issues);
      return { success: false, error: FRIENDLY.RESPONSE ?? 'Greška', code: 'RESPONSE' };
    }
    return { success: true, data: parsed.data };
  } catch (error: unknown) {
    const code = isBackendError(error) ? error.code : 'UNKNOWN';
    const detail = isBackendError(error) ? error.message : String(error);
    console.error(`[${new Date().toISOString()}] ${command} failed: ${code}`, detail);
    // Validation messages from the backend are written for the operator; others are generic.
    const message = code === 'VALIDATION' || code === 'KEY_STORE' || code === 'NOT_FOUND' ? detail : FRIENDLY[code] ?? detail;
    return { success: false, error: message, code };
  }
}
