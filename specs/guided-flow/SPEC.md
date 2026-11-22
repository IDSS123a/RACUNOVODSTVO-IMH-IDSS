# SPEC — Vođeni tok za FAS (raspored koraka)

*Commander v1.8.1 · izvor: `docs/DEFINICIJA-APLIKACIJE.md` · Direktor je odobrio raspored 2026-11-21, s dopunama za B i E (ispod)*

## Početni ekran
**„Dobar dan, <ime>. Šta ćemo danas raditi?“**

Tri velike kartice:
1. **Fakturisanje** (školarine, upisnine, materijal, produženi boravak, doručak);
2. **Ostalo fakturisanje** (sve van cjenovnika: ljetna škola, sekcija, izlet …);
3. **Izvještavanje.**

Na dnu, sitno: *Podaci (porodice i djeca) · Postavke*.

## Izbor ustanove
Poslije izbora posla dvije velike kartice s logom: **IMH** (zelena) i **IDSS** (plava). Od tog trenutka cijeli ekran nosi boju ustanove. Ustanova i posao stoje u zaglavlju, uz „← Nazad“ i „Početna“.

## 1. Fakturisanje — koraci (mjesec: zadano **naredni**)
| Korak | Šta FAS radi | Šta radi sistem |
|---|---|---|
| **A. Provjeri spisak djece** | pregleda djecu koja se fakturišu za mjesec; po potrebi doda novo dijete, ispiše dijete ili ispravi podatke | izračuna cijenu svakog djeteta po cjenovniku i braći/sestrama; prikaže djecu bez upisa i učenike IDSS bez plana, s prijedlogom za odobrenje |
| **B. Kreiraj fakture** | pregleda prijedlog i klikne „Kreiraj sve“ (**bulk**); ili izabere jedno dijete (**pojedinačno**) | jedan račun po djetetu sa svim troškovima; upisnina i materijal kad dospiju |
| **C. Štampaj fakture** | klikne „PDF“ ili „DOCX“ | sve fakture mjeseca u jednu mapu ili ZIP |
| **D. Pošalji Office Manageru** | klikne „Pošalji“ | Outlook nacrt s PDF-ovima na adresu Office Managera; FAS samo pritisne „Pošalji“ |
| **E. Prati naplatu** | evidentira uplatu iz izvoda (pretraga, iznos predložen) | prikaže otvoreno, dospjelo i plaćeno |

Gotovi koraci dobijaju **✓**, a sljedeći korak je istaknut.

### Dopune Direktora (2026-11-21)
- **B. Kreiraj fakture:** sistem prepoznaje ranije fakturisanje.
  - **Dijete koje je već u sistemu** (nastavlja): na fakturi je samo **rata školarine** (i doručak / produženi boravak ako ih ima). Upisnina, depozit i potrošni materijal se ne predlažu, jer su već fakturisani ili se ne plaćaju ponovo (BR-9, BR-10).
  - **Tek upisano dijete:** **rata školarine + upisnina + depozit + potrošni materijal**, po pravilima cjenovnika.
  - Materijal se plaća jednom svake školske godine, pa ga dijete koje nastavlja dobija na prvoj fakturi nove školske godine.
- **E. Prati naplatu — djelimična uplata:**
  - Faktura od 1.000 KM i uplata od 500 KM → status **„Djelimično plaćena“**: uplaćeno 500, **ostatak 500 KM**.
  - Faktura ostaje na listi za naplatu i na kontrolnom panelu („Djelimično plaćeni“) dok se ostatak ne uplati.
  - Za sljedeću uplatu sistem predlaže upravo ostatak.
  - Više uplata na istu fakturu je dozvoljeno. Preplata postaje kredit porodice (DL-P011).
  - Ostatak se ne prenosi sam na fakturu narednog mjeseca: svaka faktura je zaseban dokument.

## 2. Ostalo fakturisanje — koraci
| Korak | Šta FAS radi |
|---|---|
| **A. Unesi fakturu/e** | izabere uslugu iz šablona (ljetna škola, sekcija, izlet …), cijenu, osnov i **jedno ili više djece** (npr. izlet za cijelu grupu = **bulk**); po jedna faktura za svako dijete |
| **B. Štampaj** | PDF / DOCX |
| **C. Pošalji Office Manageru** | Outlook nacrt |

**Promjena pravila, za vašu potvrdu:** prema definiciji, „ostale usluge“ mogu imati i **upisana djeca** (npr. sekcija, izlet). Zato se ukida pravilo iz DL-P014 da je ručni račun samo za neupisanu djecu. Ostala usluga ide na **zasebnu fakturu**, a mjesečna faktura ostaje samo za cjenovnik.

## 3. Izvještavanje — samo čitanje (Direktor, 2026-11-21)
Izvještavanje radi samo nad postojećim podacima: nema unosa, uplate ni storna. Prikazuje samo izabranu ustanovu.
- **Kontrolni panel** te ustanove: kompaktan financijski prikaz; fakturisano, naplaćeno, otvoreno i dospjelo, po mjesecima.
- **Registar faktura** s pretragom, samo za pregled.
- **Izvoz:**
  - XLSX (kompletan sadržaj);
  - CSV;
  - DOCX izvještaj na memorandumu ustanove, A4 (DL-P021).
- **Dnevnik izmjena** obuhvata cijelu aplikaciju, pa ostaje u gornjoj traci, a ne u izvještavanju.

## Šta ostaje kako jeste (već urađeno, ulazi u korake)
- presretanje greške i šabloni;
- jedan račun po djetetu;
- prijedlog plana IDSS;
- PDF;
- Outlook nacrt;
- kontrolni panel;
- pretraga;
- brisanje uz potvrdu.

## Šta je novo
1. Početni ekran i izbor ustanove u bojama.
2. Koraci A–E s oznakama i ✓.
3. DOCX.
4. Bulk „ostalo fakturisanje“ za više djece.
5. Kompletan XLSX izvoz.
