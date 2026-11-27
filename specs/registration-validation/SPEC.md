# SPEC — Presretanje grešaka pri unosu porodice, djeteta i upisa

*FEATURE_LIFECYCLE Step 1 · Commander v1.8.1 · **Direktor odobrio 2026-11-27** (Q1–Q2 odlučeni, Q3–Q5 po prijedlogu) · izvor: Direktorov prijedlog „Parent / Payer Registration — Master QA Standard“ (2026-11-27) i analiza tog prijedloga · nadovezuje se na DL-P017 (formati) i DL-P025 (starost)*

## Svrha
Pogrešan, nepotpun, dupli ili nemoguć podatak o porodici, djetetu ili upisu ne smije ući u aplikaciju tiho, jer svaki takav podatak kasnije postaje pogrešan račun. Odluke:
- **kritična greška** blokira spremanje;
- **upozorenje** traži da ga FAS pročita i potvrdi;
- **automatska ispravka** se uvijek pokaže.

Prijedlog je analiziran tačku po tačku i upoređen s kodom. Primjeri iz njega su provjereni na stvarnim provjerama aplikacije. Ova specifikacija pokriva ono što **nedostaje ili je pogrešno**; ono što već radi samo se navodi (§9).

## Korisničke priče
- Kao **FAS**, kad unosim porodicu koja možda već postoji (isto prezime bez obzira na kvačice, isti telefon ili e-mail), aplikacija mi to kaže prije spremanja i pokaže postojeću porodicu. Tako ne pravim duplikat, a time ni duple račune.
- Kao **FAS**, kad upišem ime velikim slovima ili s viškom razmaka, aplikacija ga ispravi i **pokaže mi šta je ispravila**.
- Kao **FAS**, kad upisujem novo dijete, prije spremanja vidim jedan pregled: dijete, starost na dan početka, program, ustanova, platilac i šta će biti fakturisano. To potvrdim jednim klikom.
- Kao **Direktor**, siguran sam da nijedan zapis ne zaobilazi provjere: one se ponavljaju i u bazi.

## A. Ispravke postojećih provjera (greške nađene u analizi)

| # | Danas | Odluka |
|---|---|---|
| A5 | `María`, `Ramón`, `Łukasz` i `Şahin` se odbijaju: lista slova je prekratka | Dozvoljena su **sva slova svih pisama** (Unicode slova i kombinovani znakovi), plus razmak, crtica i apostrof. Brojevi i simboli se i dalje odbijaju. Kvačice i naglasci se čuvaju tačno kako su upisani. |
| A6 | „van der Berg“ postaje „Van Der Berg“ | Riječi `von, van, der, den, de, del, della, di, da, du, la, le, al, el, bin, ibn` ostaju malim slovima **unutar** imena; prva riječ imena uvijek počinje velikim slovom. Ime upisano mješovitim slovima (npr. „McKenzie“, „DiCaprio“) se ne dira. |
| A7 | `BEGOVIĆ` tiho postaje „Begović“ | Ispravka ostaje, ali je **vidljiva**: ispod polja piše „Ispravljeno u: Begović“, i to se vidi i u pregledu prije spremanja (§C). Ništa se ne mijenja bez traga. |
| A8 | Telefon „+387 61 111 111“ prolazi | Odbija se broj čiji pretplatnički dio (bez pozivnog broja) ima **sve iste cifre**. Niz kao „123 456“ se ne odbija, jer je to u prijedlogu primjer ispravnog broja i stvarni brojevi ga imaju. Isti broj za oba roditelja u istoj porodici (kućni telefon) je dozvoljen. |

## A9. Grupa Toddler / Preschooler u IMH vrtiću (Direktor, 2026-11-27)
Direktorova odluka: „Dijete može biti u Toddler grupi samo u dobi 0–3 godine“; grupa se bilježi; Toddler do 4. rođendana; Preschooler od 2 godine. Ovim se mijenja DL-P014, dopuna 2, po kojoj je „Toddlers / Preschoolers“ bio jedan izbor.
- **Upis u IMH vrtić** ima izbor grupe: **Toddlers** ili **Preschoolers**. Cijena je ista, a cjenovnik je nepromijenjen. „IDSS Preschoolers“ ostaje poseban program.
- **Starost na dan početka** (pune godine, granice uključene):
  - Toddlers **0–3**, tj. do dana prije 4. rođendana;
  - Preschoolers **2–6**.
  - Od 2. do 4. rođendana dozvoljene su obje grupe, jer prelazak određuje pedagog.
- **Sistem predlaže grupu** po starosti na dan početka (do 3. rođendana Toddlers, poslije Preschoolers), a FAS je može promijeniti unutar dozvoljenog raspona.
- **„Promijeni grupu“** na aktivnom upisu prebacuje dijete iz Toddlers u Preschoolers od izabranog datuma, kad pedagog odluči.
  - To nije novi upis: nema nove upisnine, depozita ni materijala, a cijena je ista.
  - Izdati računi se ne mijenjaju.
  - Promjena se zapisuje u dnevnik izmjena.
- **Upozorenje:** dijete u Toddlers koje će do kraja školske godine napuniti 4 godine dobija upozorenje u koraku A („prebacite u Preschoolers do …“).
- **Postojeći upisi:** svi su spremljeni kao Preschoolers (do sada je postojao jedan izbor). Pri uvođenju se za svako dijete mlađe od 2 godine grupa ispravi u Toddlers. Ostali ostaju Preschoolers, a FAS ih može promijeniti. Ništa se ne mijenja na izdatim računima.
- Grupa se vidi u spisku djece, na kartici porodice i u izvještajima.

## B. Dupli zapisi (A1) i upozorenja (A2)

### B1. Kada se traži duplikat
**Prije spremanja** nove porodice, novog roditelja i novog djeteta, i pri izmjeni imena, telefona ili e-maila.

### B2. Šta je „moguć duplikat“
Sva poređenja su bez obzira na velika i mala slova, kvačice (č=c, đ=dj, ä=a …) i višak razmaka (`fold`, kao u pretrazi računa).

| Zapis | Moguć duplikat kada |
|---|---|
| Porodica | isti naziv porodice, **ili** neki roditelj ima isti telefon ili e-mail kao roditelj druge porodice |
| Roditelj | isto ime i prezime u drugoj porodici, **ili** isti telefon ili e-mail kao roditelj **druge** porodice (isti kućni telefon oba roditelja iste porodice je uobičajen) |
| Dijete | isto ime i prezime i isti datum rođenja u bilo kojoj porodici, **ili** isto ime i prezime u istoj porodici |

Primjer iz prijedloga (s izmišljenim imenom): „Amir Begović“, „Amir Begovic“ i „AMIR BEGOVIĆ“ su jedan moguć duplikat.

### B3. Šta se dešava
- Prikaže se **upozorenje** s pronađenim zapisima: naziv porodice, roditelji i djeca, i za svaki zapis razlog („isti telefon“, „isto ime i datum rođenja“).
- FAS bira između tri mogućnosti:
  - **„Otvori postojeću“**: ništa se ne sprema;
  - **„Ipak je drugi zapis — spremi“**: potvrda se upisuje u dnevnik izmjena, bez ličnih podataka;
  - **„Nazad“**.
- **Blokira se** samo potpuno isti zapis: isto dijete, isto ime i isti datum rođenja, u **istoj** porodici. To je uvijek greška.
- Zapisi se **nikad ne spajaju automatski**.

### B4. Nivoi poruka (prijedlog §18)

| Nivo | Primjeri | Ponašanje |
|---|---|---|
| Kritična greška | nemoguć datum, starost izvan programa, obavezno polje prazno, isto dijete dva puta u istoj porodici | spremanje blokirano, poruka uz polje |
| Greška | neispravan e-mail, telefon, IBAN, format | spremanje blokirano dok se ne ispravi |
| Upozorenje | moguć duplikat; starost na samoj granici programa (prvi ili posljednji mjesec) | FAS mora pročitati i potvrditi |
| Informacija | automatska ispravka imena ili telefona, izračunata starost | samo se pokaže |

Svaka poruka imenuje **polje**, kaže **šta nije u redu** i **kako ispraviti** (prijedlog §21). Unos se nikad ne gubi kad provjera ne prođe.

## C. Pregled prije spremanja novog upisa (A3)
Kada FAS sprema **novi upis**, prije spremanja se otvori jedan pregled:
- dijete (ime, datum rođenja) i **starost na dan početka**, npr. „4 god. i 3 mj. na 01.09.2026.“;
- program, ustanova, školska godina i datum početka;
- platilac (ime i adresa, kako će stajati na računu);
- **šta će biti fakturisano**: mjesečni iznos po cjenovniku (s braćom i sestrama), upisnina, depozit i materijal ako dospijevaju, a za IDSS i predloženi plan rata;
- automatske ispravke (A7) i upozorenja (B) koja još nisu potvrđena.

Dugme je **„Potvrđujem i spremam“**. Bez potvrde upis se ne sprema.

## D. Adresa po dijelovima (A4)
- Porodica dobija polja:
  - **Ulica i broj** (obavezno; broj ili „bb“ obavezan);
  - **Poštanski broj** (za BiH 5 cifara, 71000 … 89000; za druge države po formatu države);
  - **Mjesto** (obavezno);
  - **Država** iz liste (zadano Bosna i Hercegovina).
- Na računu se adresa i dalje piše u jednom redu: „Ulica i broj, 71000 Sarajevo“. Za državu koja nije BiH dodaje se i država.
- **Postojeće adrese:** jedna migracija dijeli svaku adresu oblika „…, 12345 Mjesto“ u dijelove. Adresa koja se ne može sigurno podijeliti ostaje u polju „Ulica i broj“ i označi se za dopunu u „Za provjeru“. Ništa se ne briše niti nagađa.
- Izdati računi zadržavaju adresu kakva je bila na dan izdavanja (`buyer_address` se ne mijenja).

## E. Pitanja za Direktora (prije izrade)

| # | Pitanje | Prijedlog |
|---|---|---|
| Q1 | Starost u IMH vrtiću | ✅ **Odlučeno (Direktor, 2026-11-27):** grupa se bilježi; Toddlers 0–3 god. (do 4. rođendana), Preschoolers od 2 god. do 6 god.; vidi §A9. |
| Q2 | Kako se broji starost? | ✅ **Odlučeno (2026-11-27):** pune godine na dan početka programa, s uključenim granicama, npr. „0–3“ = do dana prije 4. rođendana. |
| Q3 | Moguć duplikat: blokirati ili upozoriti? | **Upozoriti** uz potvrdu (B3); blokirati samo isto dijete u istoj porodici. |
| Q4 | Adresa po dijelovima i država? | **Da** (§D). |
| Q5 | Datum rođenja roditelja, spol djeteta, dokumenti, prava pristupa za više korisnika? | **Ne uvodimo.** Za fakturisanje nisu potrebni, a GDPR traži minimum ličnih podataka (M4). Arhiva dokumenata bi bila poseban posao, ako je bude. |

## F. Arhitektura provjera (prijedlog §19)
- **Nivo 1, polje:** provjera dok se piše; poruka se pojavi kad FAS napusti polje, ne usred kucanja.
- **Nivo 2, forma:** sve provjere i traženje duplikata prije spremanja, zatim pregled (§C) za novi upis.
- **Nivo 3, baza:** iste provjere u Rustu pri spremanju.
  - Oblik imena (A5, A6), telefona (A8) i dijelova adrese (D).
  - Isto dijete u istoj porodici (blokada).
  - Starost (DL-P025).
  - Upozorenje o duplikatu se u bazi ne ponavlja, jer ga je FAS svjesno potvrdio, ali potvrda ostaje u dnevniku izmjena.
- **Jedno pravilo, jedno mjesto (M-7):** TypeScript i Rust provjere imaju iste testne primjere, pa ne mogu tiho postati različite.

## G. Kriteriji prihvatanja
- [ ] Svi primjeri iz prijedloga (§1, §2, §8, §9, §11) daju rezultat iz njegove tabele. To provjerava test, red po red.
- [ ] `María`, `Ramón`, `Łukasz`, `Şahin`, `van der Berg`, `O'Neil` i `McKenzie` se spremaju tačno kako su upisani.
- [ ] `BEGOVIĆ` se sprema kao „Begović“, a ispravka je vidljiva prije spremanja.
- [ ] „+387 61 111 111“ i „+387 33 000 000“ se odbijaju; „+387 61 123 456“ prolazi (primjer iz prijedloga).
- [ ] Porodica „Begovic“ s istim telefonom kao postojeća „Begović“ daje upozorenje s razlogom. Bez potvrde ništa se ne sprema, a s potvrdom se sprema uz zapis u dnevniku.
- [ ] Isto dijete (ime i datum rođenja) dva puta u istoj porodici odbija se i u bazi.
- [ ] Toddlers: dijete od 3 god. i 11 mj. se prihvata, a na 4. rođendan se odbija. Preschoolers: dijete od 1 god. i 11 mj. se odbija, a od 2 god. se prihvata. „Promijeni grupu“ ne pravi novi upis ni novu upisninu.
- [ ] Novi upis se ne sprema bez pregleda; pregled pokazuje starost, program, platioca i iznose.
- [ ] Sve postojeće adrese oblika „…, 71000 Sarajevo“ podijeljene su bez gubitka; ostale su u „Za provjeru“. Izdati računi su nepromijenjeni.
- [ ] Nijedna provjera ne može se zaobići: test zove backend direktno, mimo forme.
- [ ] Direktor provjerava u aplikaciji (C-13).

## H. Redoslijed izrade
1. **A5–A9**, ispravke postojećih provjera i grupa Toddler / Preschooler: mali do srednji obim, odmah korisno.
2. **B**, duplikati i upozorenja.
3. **C**, pregled prije spremanja upisa.
4. **D**, adresa po dijelovima, s migracijom. Najveći obim, jer dira bazu i postojeće adrese.

Svaki korak se završava testovima i Direktorovom provjerom u aplikaciji prije sljedećeg.

## Izvan obima
- Arhiva dokumenata i potpisa (prijedlog §13), prava pristupa za više korisnika (§16), datum rođenja roditelja i spol djeteta: vidi Q5.
- Automatsko spajanje duplikata: nikad.
