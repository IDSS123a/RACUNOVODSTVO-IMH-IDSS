# SPEC — Pretplata djeteta: uplata bez računa, višak uplate, uplatilac iz šire porodice

*FEATURE_LIFECYCLE Step 1 · Commander v1.8.1 · **Direktor odobrio 2026-11-28**, uključujući izmjenu BR-24; Q1–Q6 odlučeni jedno po jedno istog dana · izvor: Direktor, 2026-11-28: „nema zaduženja a korisnik plati = u pretplati“ i „predvidi uplatu koju izvrši neki drugi član obitelji (deda, baka, tetka i slično) za neko dijete“ · nadovezuje se na DL-P034 (saldo s predznakom), DL-P033 (upozorenja pri uplati), storno S3/S4 i DL-P026 (račun ne prikazuje uplate). **Mijenja** S3 (Q4) i DL-P026 (Q3).*

## Svrha
Roditelj, ili neko iz šire porodice, ponekad uplati novac **prije** nego što je izdat račun: unaprijed, za ljetnu školu, ili greškom. Ponekad uplati i **više** nego što račun traži. Taj novac je stvarno primljen. Mora biti zapisan isti dan, i nijedan fening ne smije nestati niti stajati na pogrešnom mjestu.

Danas se svaka uplata mora knjižiti na izdat račun (`payments.invoice_id NOT NULL`, stari BR-24). Višak ostaje na računu kao „kredit“, a uplatilac je samo ime, bez veze s djetetom.

## Računovodstveno pravilo (prikaz, ne glavna knjiga)
Svako dijete ima svoju **karticu** u svakoj ustanovi (Q1). Na njoj je:
- **saldo = zaduženo − uplaćeno + vraćeno**;
- **zaduženo** su izdati računi djeteta umanjeni za knjižna odobrenja;
- **uplaćeno** su sve nestornirane uplate: na račun i bez računa;
- **vraćeno** je povrat novca.

Saldo veći od 0 znači **duguje**, 0 znači **izmireno**, a manji od 0 znači **u pretplati**. Saldo porodice u ustanovi je zbir salda njene djece. IMH i IDSS se nikad ne miješaju (BR-1).

U knjigama je pretplata obaveza prema kupcu (primljeni avans), a ne potraživanje. Kako se knjiži, određuje knjigovođa (K1).

## Korisničke priče
- Kao **FAS**, kad stigne uplata za koju nema računa, evidentiram je na kartici djeteta: ustanova, dijete, datum, iznos, uplatilac i odnos, referenca i svrha. Saldo djeteta odmah pokazuje npr. **−1.000,00 KM (u pretplati)**.
- Kao **FAS**, kad baka plati za unuka, zapišem nju kao uplatioca s odnosom „baka“ i dijete za koje plaća. Ona ne postaje roditelj u evidenciji, a račun i dalje glasi na roditelja.
- Kao **FAS**, kad djetetu u pretplati izdam račun, aplikacija predloži „Primijeni pretplatu X KM na …“. Ja potvrdim, i račun pokazuje „Umanjeno za primljenu pretplatu“.
- Kao **FAS**, pretplatu mogu vratiti roditelju, a pogrešnu uplatu bez računa stornirati s razlogom.
- Kao **roditelj**, na zahtjev dobijem „Potvrdu o uplati“ na memorandumu.
- Kao **Direktor**, vidim pretplatu po djetetu, porodici i ustanovi, i da vrijedi: primljeno = primijenjeno + vraćeno + preostalo, do feninga.

## Odluke Direktora (2026-11-28)
- **Q1 — Saldo za svako dijete posebno.**
  - Svako dijete ima svoj saldo po ustanovi, a „Za dijete“ je obavezno na svakoj uplati.
  - Pretplata djeteta primjenjuje se na račune **tog** djeteta.
  - Na račun brata ili sestre ide samo izričitim prenosom, s obaveznom napomenom.
- **Q2 — Prijedlog i potvrda.**
  - Poslije izdavanja računa djetetu u pretplati aplikacija predlaže primjenu, najviše do otvorenog iznosa računa.
  - Bez potvrde FAS-a ništa se ne primjenjuje.
- **Q3 — Red „Umanjeno za primljenu pretplatu: −X KM“ na PDF-u računa** (izuzetak od DL-P026, samo za pretplatu).
  - Ispod UKUPNO i knjižnih odobrenja: „Umanjeno za primljenu pretplatu“, pa **„Za uplatu“** = ukupno − knjižna odobrenja − primijenjena pretplata.
  - Uplatnica i QR glase na taj iznos.
  - Kad je sve pokriveno, nema uplatnice i piše „Plaćeno iz pretplate — ne uplaćujte“.
  - Stavke, UKUPNO i broj računa se ne mijenjaju. Obične uplate se i dalje ne prikazuju na računu.
- **Q4 — Višak uplate na računu prelazi u pretplatu djeteta.**
  - Kad je na računu uplaćeno više od „Za uplatu“ (preplata, ili knjižno odobrenje poslije uplate), račun je **„Plaćen“**, a višak je pretplata djeteta s tog računa u istoj ustanovi.
  - Postojeći viškovi (npr. IMH-897/26) prelaze isto: račun „Plaćen“, a dijete −1.000,00 KM. Ništa se ne briše.
  - Ovim se mijenja S3: višak se više ne vodi kao „kredit na računu“.
- **Q5 — „Potvrda o uplati“ na zahtjev.** Dugme na svakoj uplati, na račun i bez računa, daje PDF A4 od jedne strane na memorandumu ustanove. Potvrda sadrži:
  - datum, iznos, uplatioca i odnos, dijete, svrhu i referencu;
  - **saldo djeteta poslije uplate**, s predznakom.

  Potvrda nema uplatnicu.
- **Q6 — Uplatilac se ne pamti.**
  - Ime i odnos se upisuju pri svakoj uplati. Roditelji iz evidencije biraju se iz izbora i popune se sami.
  - Lista uplatilaca na porodici se ne vodi.

## Rješenje

### 1. Uplatilac i dijete na svakoj uplati
- **Uplatilac:** ime i prezime s izvoda, uz iste provjere imena kao za roditelja (DL-P017, A5–A7, vidljiva ispravka). Izbor nudi i roditelje porodice.
- **Odnos prema djetetu:** roditelj / staratelj, djed, baka, tetka, ujak, stric, brat / sestra ili drugo uz slobodan unos (šablon + slobodan unos).
- **Dijete:**
  - kod uplate na račun to je dijete s računa (jedan račun po djetetu);
  - kod uplate bez računa bira se iz djece porodice u toj ustanovi, a ako je dijete jedno, popuni se samo.
- **Postojeće uplate:** odnos je „nije zabilježeno“, a dijete je ono s računa.
- **Dnevnik izmjena** bilježi id, iznos i odnos, nikad ime uplatioca ni referencu (BR-22).

### 2. Uplata bez računa
- **„Evidentiraj uplatu bez računa (pretplata)…“** nalazi se na kartici porodice, u „Saldo porodice“, uz svako dijete.
- **Provjere:** datum nije u budućnosti, a iznos je od 0,01 do 100.000,00 KM.
- **Upozorenja s potvrdom** (kao DL-P033):
  - dijete ima neplaćen račun u toj ustanovi: „da li je uplata za IMH-…/26 (X KM)?“, uz dugme **„Evidentiraj na taj račun“**;
  - ista uplata, isti iznos i datum, već je zapisana.

### 3. Pretplata djeteta
**Izvori pretplate:** uplate bez računa koje nisu stornirane i višak uplate na računima djeteta (Q4). Za FAS su jedan iznos, a iza njega je spisak izvora.

**Primjena na račun djeteta** (Q2):
- nudi se poslije izdavanja računa (mjesečni obračun, ručni, ostalo fakturisanje);
- može se uraditi i kasnije, iz detalja računa ili s kartice;
- iznos je najviše manji od dva iznosa: pretplata djeteta i otvoreni iznos računa;
- izvori se troše od najstarijeg prema novijem.

**Prenos na račun brata ili sestre** (Q1): ista porodica i ista ustanova, a napomena je obavezna.

**Povrat:** datum, iznos i napomena. Iznos je najviše jednak pretplati djeteta.

**Storno uplate bez računa:** traži razlog. Moguć je samo dok iz te uplate ništa nije primijenjeno ni vraćeno; inače se prvo storniraju primjene. Primjene se storniraju kao i uplate, s razlogom, i ništa se ne briše.

### 4. Prikaz
- **Detalji računa:**
  - račun s viškom je „Plaćen“, uz red „Višak X KM je pretplata djeteta“;
  - primijenjena pretplata se vidi kao „Plaćeno iz pretplate“;
  - saldo računa je 0,00.
- **Kartica porodice — „Saldo porodice“** po ustanovi:
  - za svako dijete: zaduženo, uplaćeno, saldo s predznakom, te spisak uplata bez računa i viškova;
  - na dnu je zbir porodice.
- **Korak E:** zbir „U pretplati“ po ustanovi.
- **Izvještaji:**
  - XLSX registar: saldo s predznakom;
  - novi list „Pretplate“ za knjigovođu (K1): dijete, porodica, ustanova, datum, izvor, primijenjeno, vraćeno i preostalo.
- Riječ „kredit“ se više ne koristi nigdje u aplikaciji (DL-P034).

### 5. Pravila koja baza odbija (ne samo ekran)
- uplata bez računa bez djeteta, ili za dijete druge porodice;
- primjena ili prenos na račun druge porodice ili druge ustanove, na knjižno odobrenje ili na storniran račun;
- prenos na račun brata ili sestre bez napomene;
- primjena iznad pretplate djeteta ili iznad otvorenog iznosa računa; povrat iznad pretplate;
- storno uplate bez računa iz koje je nešto primijenjeno ili vraćeno.

## Ustav — BR-24 (izmijenjeno uz Direktorovo odobrenje, 2026-11-28)
„A payment may come from **any family member or relative** (grandparent, aunt …), recorded with the payer's name, relation and the child it is for; the payer never becomes the buyer. It is booked against an invoice, or — when no invoice exists yet — on the family's account of **one** institution as a prepayment, which is later applied to that institution's invoices or refunded.“

## Kriteriji prihvatanja
- [ ] Dijete bez računa, uplata bez računa od 1.000,00 KM u IMH: saldo djeteta i porodice IMH je **−1.000,00 KM (u pretplati)**, a IDSS se ne mijenja.
- [ ] Novi račun djetetu od 710,00 KM: aplikacija predloži primjenu, a FAS potvrdi.
  - Račun je „Plaćen“, a PDF pokazuje „Umanjeno za primljenu pretplatu: −710,00 KM“ i „Plaćeno iz pretplate — ne uplaćujte“, bez uplatnice.
  - Saldo djeteta je −290,00 KM.
- [ ] Djelimična primjena: račun 710,00 KM, pretplata 200,00 KM. PDF: „Umanjeno … −200,00 KM“, „Za uplatu 510,00 KM“, a uplatnica i QR glase na 510,00 KM.
- [ ] IMH-897/26 (1.000 KM za uplatu, 2.000 KM uplaćeno) je „Plaćen“, saldo djeteta je −1.000,00 KM, i nijedna uplata nije obrisana.
- [ ] Bez potvrde FAS-a ništa se ne primjenjuje. Primjena na dijete druge porodice ili na drugu ustanovu je nemoguća. Prenos na brata ili sestru bez napomene se odbija.
- [ ] Baka plaća za drugo od dvoje djece:
  - uplata je zapisana s odnosom „baka“ i tim djetetom;
  - porodica nema novog roditelja;
  - račun i dalje glasi na roditelja.
- [ ] „Potvrda o uplati“: PDF A4 na jednoj strani, na memorandumu, sa saldom djeteta poslije uplate.
- [ ] Za svako dijete i za svaku ustanovu vrijedi do feninga: primljeno = primijenjeno + vraćeno + preostalo.
- [ ] Ništa se ne briše, a sva storna su vidljiva. Dnevnik nema imena ni referenci.
- [ ] Vitest i cargo test za svako pravilo iz §5; migracija 016 s testom, uključujući postojeće viškove; tsc, eslint i build.
- [ ] Direktor provjerava u aplikaciji (C-13).

## Izvan opsega
- glavna knjiga i kontni plan; uvoz bankovnog izvoda;
- avansni račun kao poseban dokument: nije potreban, jer IMH i IDSS nisu obveznici PDV-a (K2);
- pamćenje uplatilaca na porodici (Q6);
- automatska primjena bez potvrde (Q2).

## Pitanja za knjigovođu (ne blokiraju razvoj, prije puštanja u rad)
- **K1:** Na koji konto se knjiže primljene pretplate? Odgovara li list „Pretplate“ u XLSX-u za knjiženje?
- **K2 — zatvoreno (Direktor, 2026-11-28):** IMH i IDSS **nisu obveznici PDV-a**. Za primljenu pretplatu zato nema avansnog računa ni PDV-a. Ostaje samo K1.
