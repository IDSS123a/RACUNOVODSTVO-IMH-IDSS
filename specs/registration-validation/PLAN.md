# PLAN — Presretanje grešaka pri unosu porodice, djeteta i upisa

*FEATURE_LIFECYCLE Step 2 · SPEC odobren 2026-11-27 · grana `feat/registration-validation`*

## Korak 1 — A5–A9 (ovaj korak)

### A5 Imena
`normalizeName` (`src/lib/validation/formats.ts`):
- Slova se provjeravaju klasom `\p{L}\p{M}`, s Unicode zastavicom.
- Kvačice se čuvaju u NFC obliku.
- Isto pravilo ponavlja `formats.rs`, i za imena (`is_canonical_name`), i to pri spremanju roditelja, djeteta i porodice.

### A6 Prefiksi
- Lista partikula ostaje mala slova unutar imena, a prva riječ uvijek počinje velikim slovom.
- Mješovita slova („McKenzie“) se ne diraju, kao i do sada.

### A7 Vidljive ispravke
Komponenta `CorrectedHint` ispod polja imena, naziva porodice, telefona i e-maila prikazuje „Ispravljeno u: …“ kada se normalizovana vrijednost razlikuje od upisane.

### A8 Telefon
`normalizePhone` i `is_canonical_phone` odbijaju pretplatnički dio koji ima sve iste cifre.

### A9 Grupe
- **Programi:**
  - `ENROLLABLE_PROGRAMS` dobija `TODDLERS`;
  - oznake su „Toddlers“ i „Preschoolers“;
  - `PROGRAM_AGE`: TODDLERS [0, 3], PRESCHOOLERS [2, 6], isto u TS i Rust.
- **Upis:** prijedlog grupe po starosti (`suggestedGroup`).
- **„Promijeni grupu“:**
  - Rust komanda `change_enrolment_group` mijenja samo TODDLERS ↔ PRESCHOOLERS na aktivnom upisu.
  - Provjerava starost na izabrani datum.
  - Upisuje se u dnevnik izmjena.
  - Ne dira račune ni jednokratne stavke.
- **Migracija 015:** PRESCHOOLERS → TODDLERS za upise djece mlađe od 2 godine na dan početka. Upit je deterministički, a ostali upisi se ne diraju.
- **Upozorenje u koraku A:** Toddler koji puni 4 godine prije kraja školske godine.

### Testovi
- Svi primjeri iz prijedloga (imena, telefon, e-mail, datumi), red po red, kao tabela.
- Rust testovi za imena, telefon, granice grupa, promjenu grupe i migraciju.

## Korak 2 — B (duplikati, upozorenja)
Poseban PLAN nakon Direktorove provjere koraka 1.

## Korak 3 — C (pregled prije spremanja)
Kao korak 2.

## Korak 4 — D (adresa po dijelovima, migracija)
Kao korak 2.
