import type { z } from 'zod';
import type { InstitutionSchema } from '@/lib/validation/schemas';

/**
 * Institution master data, transcribed from the official letterheads (BR-2):
 * - IMH: Memorandum_IMH.pdf
 * - IDSS: MEMORANDUM_IDSS_OD_20042026.dotx (registration number MBSU per D14)
 *
 * Used once to seed the database; afterwards edited only in Settings.
 */
export const INSTITUTIONS_SEED: ReadonlyArray<z.infer<typeof InstitutionSchema>> = [
  {
    code: 'IMH',
    fullName: 'Privatna predškolska ustanova “International Montessori House” Sarajevo',
    shortName: 'P.P.U. International Montessori House',
    address: 'Buka 11, 71 000 Sarajevo, Bosna i Hercegovina',
    phone: '+387 33 267 965',
    fax: '+387 33 267 966',
    mobile: '',
    email: 'info-mejtas@montessorihouse.ba',
    website: 'www.montessorihouse.ba',
    taxId: '4201731140006',
    registrationNumber: 'Reg. broj 65-01-0165-12',
    bankName: 'SPARKASSE BANK d.d., Sarajevo',
    bankAccount: '1990 4900 5848 7943',
    iban: 'BA39 1990 4900 5848 7943',
    swift: 'ABSBBA22',
  },
  {
    code: 'IDSS',
    fullName: 'Privatna ustanova „INTERNATIONALE DEUTSCHE SCHULE SARAJEVO“ – Međunarodna Njemačka Škola Sarajevo',
    shortName: 'P.U. Internationale Deutsche Schule Sarajevo',
    address: 'Buka 13, 71 000 Sarajevo, Bosna i Hercegovina',
    phone: '+387 33 560 520',
    fax: '',
    mobile: '+387 60 345 1275',
    email: 'info@idss.ba',
    website: 'www.idss.edu.ba',
    taxId: '4202220420007',
    registrationNumber: 'MBSU 65-05-0013-16',
    bankName: 'SPARKASSE BANK d.d., Sarajevo',
    bankAccount: '1994 9900 2180 9884',
    iban: 'BA39 1994 9900 2180 9884',
    swift: 'ABSBBA22',
  },
];
