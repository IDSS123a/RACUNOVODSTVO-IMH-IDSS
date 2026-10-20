# Forenzička analiza — IMH & IDSS Invoice Manager (`IMH-IDSS-Fakturisanje.html`)

**Datum analize:** 20.10.2026.
**Predmet:** jednofajlni build (77.925 linija). Biblioteke qrcode, html2canvas, jsPDF, SheetJS, d3 i core-js čine ~95% fajla. Vlastiti kod aplikacije (moduli `src/*.js`, ~4.500 linija) je u linijama 57228–59397, 72884–73821 i 76485–77920.
**Napomena:** u folderu postoji samo izgrađeni (bundle) HTML. Izvorni `src/` fajlovi nisu prisutni, pa sve ispravke treba raditi u izvornom kodu i ponovo izgraditi aplikaciju.

---

## 1. Izvršni sažetak

Kalkulacije nisu netačne zbog jedne greške. Uzrok je **arhitektonski**: ista poslovna pravila (iznos stavke, rabat, cijena „narednog djeteta“, status plaćanja, koja ustanova fakturiše koju grupu) implementirana su **nezavisno na 4–6 mjesta**, svaki put malo drugačije. Zbog toga ekran unosa, snimljeni račun, PDF, uplatnica/QR, kontrolni panel, mjesečni obračun, kalkulator 3+ i Excel izvoz mogu prikazati **različite brojeve za isti račun**.

### Pet korijenskih uzroka

| # | Korijenski uzrok | Posljedica |
|---|---|---|
| **K1** | Nema jedinstvenog računskog jezgra. `tot()` zaokružuje po stavci, forma za unos ne zaokružuje, PDF miješa zaokruženo i nezaokruženo, mjesečni obračun ne zaokružuje uopšte. | Razlike od 0,01 KM između ekrana, PDF-a i baze. |
| **K2** | Rabat se čuva kao razlomak (0,125), a prikazuje i vraća u formu kao `toFixed(0)` (13). | Tihi gubitak/višak novca. Na računu piše „8%“, a obračunato je 7,5%. |
| **K3** | Ne postoji jedan izvor istine za cjenovnik i pravila popusta. Postoje `CATALOG_2026_2027`, ručno pisan HTML u `vCat`, `DEFAULT_PRICES_3PLUS`/`ONETIME_3PLUS`, tekst banera za depozit i tekst vodiča 3+. | Kontradiktorne cijene i pravila, uključujući dvostruki popust i pogrešnu pravnu osobu na računu. |
| **K4** | Računi ne referenciraju porodicu ni dijete preko ID-a, nego preko **imena kao teksta**. | Duplikati se ne prepoznaju, emailovi se šalju pogrešnoj porodici, a uvoz spaja različite ljude istog imena. |
| **K5** | Model plaćanja je jedno polje `paidAmount` + `paidStatus` + `paid`, bez datuma, bez knjiženja uplata i bez povrata. Kontrolni panel ne poznaje sve statuse koje vraća `getPaymentStatus`. | Pogrešna potraživanja na kontrolnom panelu, izgubljene preplate, a novac od storniranog plaćenog računa „nestaje“ iz evidencije. |

---

## 2. Računske greške — dokazi s reprodukcijom

> Brojevi su izračunati doslovnom logikom funkcija iz fajla (citirane linije).

### 2.1 [KRITIČNO] Forma „Novi račun“ prikazuje iznos koji se ne snima — K1
- Forma: `calcNewInvoiceTotals` ([IMH-IDSS-Fakturisanje.html:58422](IMH-IDSS-Fakturisanje.html:58422)) sabira stavke **bez** zaokruživanja.
- Snimljeni račun, PDF, panel i Excel koriste `tot()` ([:57546](IMH-IDSS-Fakturisanje.html:57546)), koji zaokružuje **svaku stavku** pa onda sabira.
- **Reprodukcija:** 3 stavke × 824,50 KM, rabat 7,5%.
  - Forma: bruto 2.473,50 / rabat 185,51 / **UKUPNO 2.287,99 KM**
  - Snimljeni račun i PDF: **2.287,98 KM**
- Isti problem ima mjesečni obračun ([:58657](IMH-IDSS-Fakturisanje.html:58657), [:58672](IMH-IDSS-Fakturisanje.html:58672)): „Ukupna vrijednost predloženih računa“ ≠ zbir izdatih računa.

### 2.2 [KRITIČNO] PDF: „Prodajna vrijednost“ nije tačna — K1
- [:57717](IMH-IDSS-Fakturisanje.html:57717): `dsc` (rabat) je **nezaokružen**, a `t3` je zaokružen po stavci. Na [:57811](IMH-IDSS-Fakturisanje.html:57811) se ispisuje `t3 + dsc`.
- **Reprodukcija** (isti primjer): stvarni bruto je 2.473,50, a na fakturi piše **2.473,49 KM**. Rekapitulacija na zvaničnom dokumentu tako ne odgovara zbiru stavki.

### 2.3 [KRITIČNO] Rabat se zaokružuje na cijeli procenat — K2
Rabat se prikazuje kroz `(disc*100).toFixed(0)` na pet mjesta:
- tabela porodica [:58941](IMH-IDSS-Fakturisanje.html:58941)
- popunjavanje forme iz porodice [:58338](IMH-IDSS-Fakturisanje.html:58338)
- popunjavanje iz cjenovnika [:58372](IMH-IDSS-Fakturisanje.html:58372)
- PDF [:57796](IMH-IDSS-Fakturisanje.html:57796)
- mjesečni obračun [:58713](IMH-IDSS-Fakturisanje.html:58713)

**Reprodukcije:**
- Porodica ima rabat 12,5% na 710 KM. Forma upisuje „13“, pa račun iznosi **617,70 umjesto 621,25 KM**: −3,55 KM mjesečno po djetetu.
- Rabat 7,5%: PDF prikazuje „**8%**“, a iznos je obračunat sa 7,5%. Dokument je interno nekonzistentan.
- Ako korisnik samo dodirne polje rabata u tabeli porodica, „13“ se snima kao 0,13 i trajno mijenja ugovorenu cijenu.

### 2.4 [KRITIČNO] Stari rabat i cijena „preživljavaju“ promjenu djeteta
`onNewChildChange` ([:58337–58338](IMH-IDSS-Fakturisanje.html:58337)) upisuje cijenu samo ako je `> 0`, a rabat samo ako je `> 0`. Ako se izabere dijete A (rabat 20%), pa dijete B (rabat 0%), **ostaje 20%**. Račun za dijete B se izdaje s tuđim popustom, bez upozorenja.

### 2.5 [KRITIČNO] Kontrolni panel preplaćene račune broji kao dug — K5
`getPaymentStatus` vraća i `"overpaid"` ([:57553](IMH-IDSS-Fakturisanje.html:57553), [:57557](IMH-IDSS-Fakturisanje.html:57557)). `vDash` ([:77033](IMH-IDSS-Fakturisanje.html:77033)) i grafikon ([:76520](IMH-IDSS-Fakturisanje.html:76520)) poznaju samo paid, partial i „sve ostalo“. Zato **preplaćen račun ulazi u „Neplaćeni računi“** s punim iznosom kao dugom.
- Primjer: račun 710 KM, uplaćeno 800 KM, status „preplaćeno“ (npr. iz Excel uvoza). Panel prikazuje dug od 710 KM koji ne postoji.
- Filter na listi računa nema opciju „Preplaćeno“, pa se takvi računi ne mogu pronaći.

### 2.6 [KRITIČNO] Plaćen račun bez oznake statusa vodi se kao neplaćen — K5
`getPaymentStatus`: ako je `paidAmount === total`, a `paidStatus` nije `"paid"`, uslov `paid > 0 && paid < total` nije ispunjen, pa funkcija vraća **„Neplaćeno“, dug = puni iznos** ([:57559–57562](IMH-IDSS-Fakturisanje.html:57559)).
- Realan put: Excel uvoz gdje je kolona „status“ prazna, a „plaćeno iznos“ jednak iznosu računa ([:77658–77664](IMH-IDSS-Fakturisanje.html:77658)).

### 2.7 [VISOKO] Preplata se gubi pri unosu uplate — K5
`savePaymentModal` ([:76953](IMH-IDSS-Fakturisanje.html:76953)): ako je unesena uplata ≥ iznosa računa, snima se `paidAmount = total`. Višak novca se briše, a postojeća logika za „preplaćeno“ tako postaje mrtav kod. Nema datuma uplate, istorije uplata ni zapisa u dnevnik promjena.

### 2.8 [VISOKO] Storno plaćenog računa briše uplatu iz evidencije — K5
`storno()` ([:76825](IMH-IDSS-Fakturisanje.html:76825)) kreira korektivni račun, a oba se isključuju iz svih zbirova (`cancelledKeys`). Ako je originalni račun bio **plaćen**, uplaćeni novac više se ne pojavljuje nigdje: nema avansa, kredita ni povrata. Blagajna i bankovni izvod se tada ne mogu uskladiti.
Uz to, modal za uplatu se otvara i za storno račune. Ako se storno označi kao „Neplaćeno“, dobija status **„Preplaćeno“** (−710 < 0).

### 2.9 [VISOKO] Grafikon i zbirovi prikazuju procente iznad 100% — K1/K5
- Grafikon ([:76509–76511](IMH-IDSS-Fakturisanje.html:76509)) sabira `totalSum` **prije** isključenja storniranih računa, a segmente poslije.
- Ako je storno izdat u drugom mjesecu, u tekućem mjesecu ostaje samo −710 KM. Na primjer, uz 1.000 KM neplaćenih računa, centar prikazuje 290 KM, a segment „Neplaćeno“ **344,8%**.
- „Fakturisano u mjesecu“ ([:77043](IMH-IDSS-Fakturisanje.html:77043)) i „Ukupno“ na listi računa ([:77223](IMH-IDSS-Fakturisanje.html:77223)) uključuju stornirane račune.
- Filter „Neplaćeno“ i dalje vraća stornirane originale ([:77213–77214](IMH-IDSS-Fakturisanje.html:77213)), pa „Ukupno“ bude precijenjeno.

### 2.10 [VISOKO] QR kod i uplatnica traže pogrešan iznos
- Uvijek se koristi puni iznos `t3` ([:57858](IMH-IDSS-Fakturisanje.html:57858), [:57879](IMH-IDSS-Fakturisanje.html:57879)), a ne preostali dug. Za djelimično plaćen račun roditelj dobija nalog za cijeli iznos.
- Za storno račune `Math.max(0, amount)` ([:57657](IMH-IDSS-Fakturisanje.html:57657)) daje QR sa „BAM0.00“.
- „Mjesto i datum uplate“ je unaprijed popunjeno **datumom računa** ([:57842](IMH-IDSS-Fakturisanje.html:57842)).

### 2.11 [SREDNJE] Pravilo zaokruživanja iz cjenovnika nije modelirano u aplikaciji — K3
> **Ispravka nakon pregleda Excel kalkulatora (vidi poglavlje 8):** cijene 570, 650 i 937,60 KM **nisu greške**. Excel (`Cjenovnik!O:P`) definiše pravilo: IMH/vrtić popust 20% **zaokružen na 10 KM mjesečno** (710 × 0,8 = 568 → 570; 810 × 0,8 = 648 → 650), a IDSS OŠ popust **zaokružen na 1 KM godišnje** (11.030 × 0,85 = 9.375,5 → 9.376 → 937,60 mjesečno; 11.970 × 0,85 = 10.174,5 → 10.175).

Problem je u aplikaciji: ona ima samo gotove brojeve i opisne tekstove („≈20%“), a **pravilo zaokruživanja ne postoji u kodu**. Zato:
- baner za depozit nudi „20%“ bez zaokruživanja (710 → 568, a ne 570);
- kalkulator 3+ i katalog za unos ne mogu izračunati novu cijenu kad se promijeni osnovica;
- u katalogu za unos **nema** IDSS OŠ cijena za strana lica s popustom za 2. i 3. dijete (postoje samo u `vCat`).

Godišnji iznosi se računaju za različit broj mjeseci: vrtić 12 (8.520 = 710 × 12), škola 10 (9.700 = 970 × 10). Excel to modelira kolonom „Mjeseci u godini“, a aplikacija nema takav podatak.

### 2.12 [SREDNJE] PDF je deformisan
`pdf.addImage(..., 0, 0, pdfWidth, pdfHeight)` ([:72916](IMH-IDSS-Fakturisanje.html:72916)) razvlači snimak ekrana na cijelu A4 stranu bez obzira na stvarnu visinu sadržaja. Posljedice:
- vertikalno istezanje ili sabijanje;
- nema margina;
- nema podrške za više strana;
- PDF je rasterska slika, bez pretrage teksta i nepogodan za arhivu (nije PDF/A).

---

## 3. Horizontalna disharmonija — ista pravila, različite implementacije

### 3.1 [KRITIČNO] IDSS Preschoolers se fakturiše pod pogrešnom pravnom osobom
> **Potvrđeno od vlasnika (20.10.2026.):** vrtić IMH ima tri grupe: **Toddlers**, **Preschoolers** i **IDSS Preschoolers**. Grupa IDSS Preschoolers pravno-formalno pripada **IMH-u** i nema veze s osnovnom školom IDSS (1.–9. razred).

- **Ispravno:** vodič 3+ ([:73134](IMH-IDSS-Fakturisanje.html:73134)) i kalkulator 3+ (`THREE_PLUS_BILLING_INST = "IMH"`, [:73307](IMH-IDSS-Fakturisanje.html:73307)).
- **Pogrešno:** katalog za novi račun stavlja „IDSS Predškolska grupa“ pod ustanovu **IDSS** ([:57627–57636](IMH-IDSS-Fakturisanje.html:57627)). Mjesečni obračun i evidencija porodica rade isto, jer dijete u toj grupi dobija `inst: "IDSS"`.
- **Posljedica:** svaki takav račun nosi IDSS naziv, JIB, IDSS žiro-račun i napomenu o PDV-u. To je račun **pogrešne pravne osobe**, a novac ide na pogrešan račun. Isto dijete se može fakturisati i **dva puta**: iz 3+ kalkulatora (IMH) i iz mjesečnog obračuna (IDSS). Duplikat se ne prepoznaje (vidi 3.4).
- **Ispravka:** aplikacija mora razlikovati **pravnu osobu** (IMH / IDSS) od **grupe/programa** (Toddlers, Preschoolers, IDSS Preschoolers, OŠ I–IV, OŠ V–IX). Grupa određuje pravnu osobu; korisnik je ne bira ručno. Prekidač „IMH/IDSS“ u zaglavlju tada filtrira po pravnoj osobi, pa je IDSS Preschoolers vidljiv pod IMH.

### 3.2 [KRITIČNO] Popust za „naredno dijete“ — četiri različite definicije
| Mjesto | Ko je „naredno dijete“ | Kako se računa |
|---|---|---|
| Katalog ([:57617](IMH-IDSS-Fakturisanje.html:57617)) | ručni odabir stavke | gotova cijena (570, 600, 873…) |
| Baner za depozit ([:58376](IMH-IDSS-Fakturisanje.html:58376)) | broj **svih** zapisa porodice, uključujući školsku djecu | **dodatnih 20%** na stavku |
| Kalkulator 3+ ([:73360](IMH-IDSS-Fakturisanje.html:73360)) | samo djeca u IMH ili IDSS vrtiću (redoslijed u listi) | tabela `DEFAULT_PRICES_3PLUS` |
| `vCat` ([:59200](IMH-IDSS-Fakturisanje.html:59200)) | — | ručno pisan HTML |

- **Dvostruki popust:** korisnik izabere „Depozit — naredno dijete“ (570 KM), a baner odmah nudi „Primijeni 20% popusta“. Rezultat je **456 KM** umjesto 570.
- Tekst banera navodi „600 umjesto 750 / 680 umjesto 850“ za depozit. **Ispravka:** Excel (`Cjenovnik!F9:G9`, `N9` = 20%) potvrđuje da je to tačno za depozit IDSS Preschoolers grupe. Greška je u katalogu aplikacije, gdje ta stavka „Depozit — naredno dijete“ za IDSS Preschoolers **ne postoji**, a ni `vCat` je ne prikazuje.

### 3.3 [VISOKO] Cjenovnik postoji u četiri nezavisne kopije
`CATALOG_2026_2027`, `vCat` (ručno pisan HTML s hardkodiranim brojevima računa), `DEFAULT_PRICES_3PLUS`/`ONETIME_3PLUS` i tekst vodiča. Promjena cijene na jednom mjestu ne mijenja ostala tri.

### 3.4 [KRITIČNO] Identitet porodice ili djeteta je ime kao tekst — K4
Računi nemaju `pid` ni `childId`. Sve veze se prave poređenjem imena:
- **Prepoznavanje duplikata u mjesečnom obračunu** ([:58653](IMH-IDSS-Fakturisanje.html:58653)) poredi ime oca + ime djeteta + naziv stavke koji počinje sa „Školarina“:
  - ručni račun sa stavkom „Mjesečna naknada…“ se ne prepoznaje, pa nastaje **dvostruko fakturisanje**;
  - račun iz 3+ ima `child = "Ana, Emir, Lejla"` ([:73522](IMH-IDSS-Fakturisanje.html:73522)), pa se također ne prepoznaje;
  - kad se ime ispravi (typo), sistem više ne vidi ranije izdate račune;
  - storniran original se i dalje broji kao „Izdato“ (`!i4.ref` provjerava samo storno račun, ne i otkazani original), pa je ponovno izdavanje **blokirano**.
- **Novi račun** ([:58565](IMH-IDSS-Fakturisanje.html:58565)) provjerava samo broj računa, a ne „isto dijete + isti mjesec“.
- **Email** ([:76598](IMH-IDSS-Fakturisanje.html:76598)): primalac je prva porodica s **istim imenom oca**. `persistRecipient` ([:76720](IMH-IDSS-Fakturisanje.html:76720)) prepisuje email **svim** porodicama s istim imenom oca ILI djeteta. To je rizik zaštite ličnih podataka: račun i podaci o djetetu mogu otići drugom roditelju.
- **Excel uvoz** ([:77608](IMH-IDSS-Fakturisanje.html:77608)) spaja dva različita oca istog imena u jednu porodicu i ponovo dodjeljuje sve `pid` vrijednosti.

### 3.5 [VISOKO] Institucijski prekidač IMH/IDSS ne filtrira podatke
`Actions.setInst` mijenja samo logo i podrazumijevane vrijednosti u formama. Panel ([:77015](IMH-IDSS-Fakturisanje.html:77015)) zbraja **obje** ustanove, a grafikon prikazuje oznaku „Ustanova: IMH“ ([:77100](IMH-IDSS-Fakturisanje.html:77100)) dok crta podatke za obje. Oznaka zavarava korisnika.

### 3.6 [VISOKO] Kalkulator 3+ ne koristi podatke iz evidencije
- Status djeteta se pogađa po cijeni: `price <= 850` znači predškolska grupa ([:73219](IMH-IDSS-Fakturisanje.html:73219)). Produženi boravak (250 KM) ili cijena 0 daju pogrešnu kategoriju.
- Ugovoreni rabat porodice (`fam.disc`) se **ne učitava** u „Popust odbora“. Račun iz 3+ je zato drugačiji od računa iz mjesečnog obračuna za isto dijete.
- Član 9 zavisi od redoslijeda rođenja, a redoslijed je zapravo redoslijed unosa u bazu.
- Račun se izdaje s datumom „danas“ i podrazumijevanim imenom „Porodica sa troje djece“ ako ga korisnik ne promijeni.
- Subvencija se računa na punu cijenu, a ne na iznos na računu poslije popusta. Uz popust odbora, „roditelj na kraju“ se odsijeca na 0 (`Math.max(0, …)`, [:73406](IMH-IDSS-Fakturisanje.html:73406)), pa se skriva da bi subvencija premašila naplaćeni iznos.

### 3.7 [VISOKO] IBAN i SWIFT su odvojeni od broja računa
U Postavkama ([:59345](IMH-IDSS-Fakturisanje.html:59345)) i pri Excel uvozu ([:77600](IMH-IDSS-Fakturisanje.html:77600)) mijenja se samo `racun`, dok IBAN i SWIFT ostaju stari i ne mogu se urediti. Uplatnica tada prikazuje **novi** račun, a QR kod šalje novac na **stari**. Email, telefon i web ustanove se također ne mogu urediti.

### 3.8 [VISOKO] Dnevnik promjena je selektivan
Bilježe se samo storno, 3+, email i uvoz. **Ne bilježe se**:
- kreiranje računa (`saveNewInvoice`, mjesečni obračun);
- svaka promjena statusa plaćanja;
- izmjene cijena i rabata porodica;
- brisanje djeteta;
- izmjene podataka ustanove.

Za finansijsku aplikaciju to nije prihvatljiv revizijski trag.

---

## 4. Vertikalna analiza — integritet podataka i pouzdanost

| # | Ozbiljnost | Nalaz | Lokacija |
|---|---|---|---|
| V1 | KRITIČNO | Cijela baza je **jedan IndexedDB ključ** `app_state`. Dvije otvorene kartice međusobno prepisuju podatke (posljednji upis pobjeđuje): nestaju računi, a nastaju **duplirani brojevi**. Nema zaključavanja ni `BroadcastChannel`. | [:57481](IMH-IDSS-Fakturisanje.html:57481) |
| V2 | KRITIČNO | Akcije koriste **indeks niza** (`onclick="Actions.storno(17)"`, `bulk-cb value=famIndex`). Nakon uvoza, vraćanja iz arhive ili izmjene u drugoj kartici, indeks pokazuje na **drugi račun**. | [:77284](IMH-IDSS-Fakturisanje.html:77284), [:58706](IMH-IDSS-Fakturisanje.html:58706) |
| V3 | VISOKO | Izmjene porodica nemaju validaciju (`updateChildField`): negativna cijena ili rabat 150% se prihvataju. Mjesečni obračun tada izdaje **negativne račune** jer ne provjerava `total > 0`. | [:58968](IMH-IDSS-Fakturisanje.html:58968), [:58748](IMH-IDSS-Fakturisanje.html:58748) |
| V4 | VISOKO | Excel uvoz nema provjeru opsega rabata. Ako izvorni `.xlsm` čuva rabat u procentima (10), uvoz ga čita kao razlomak (10 = 1000%) i nastaju negativni iznosi. | [:77694](IMH-IDSS-Fakturisanje.html:77694) |
| V5 | VISOKO | Excel izvoz pa uvoz **nije simetričan**: list „Porodice“ se izvozi, ali se ne uvozi. Gube se emailovi, oznake „aktivan“, cijene djece bez računa za školarinu i `pid`. Cijena porodice se uzima iz posljednjeg računa po redoslijedu u fajlu, a ne po datumu. | [:77391](IMH-IDSS-Fakturisanje.html:77391), [:77735](IMH-IDSS-Fakturisanje.html:77735), [:77756](IMH-IDSS-Fakturisanje.html:77756) |
| V6 | SREDNJE | Svako snimanje (250 ms nakon izmjene) piše 2 JSON fajla i **kompletan XLSX**. Kod veće baze to blokira interfejs. `flushSave` na `pagehide` je asinhron, pa nije garantovano da će se izvršiti. | [:57503](IMH-IDSS-Fakturisanje.html:57503) |
| V7 | SREDNJE | Brisanje djeteta je dozvoljeno i kad dijete ima račune (nema referencijalne provjere). | [:58974](IMH-IDSS-Fakturisanje.html:58974) |
| V8 | SREDNJE | `Actions.setTab` postavlja hash **i** poziva `renderTab`, a zatim `hashchange` renderuje **još jednom**. | [:76779](IMH-IDSS-Fakturisanje.html:76779), [:77907](IMH-IDSS-Fakturisanje.html:77907) |
| V9 | SREDNJE | Lista računa tiho prikazuje najviše 300 redova (`slice(0,300)`), a sažetak kaže „Prikazano N“. | [:77249](IMH-IDSS-Fakturisanje.html:77249) |
| V10 | SREDNJE | Oznaka „poslano emailom“ čita `inv.emailSent`, ali kod upisuje `emailPreparedAt`, pa se oznaka nikad ne prikazuje. | [:77134](IMH-IDSS-Fakturisanje.html:77134), [:76760](IMH-IDSS-Fakturisanje.html:76760) |
| V11 | NISKO | `inv.items[0]?.name` ruši ispis ako `items` ne postoji (na drugim mjestima kod koristi `inv.items \|\| []`). | [:57835](IMH-IDSS-Fakturisanje.html:57835) |
| V12 | NISKO | `slova()` ne podržava iznose ≥ 1.000.000 KM (ispisuje „undefined“). | [:57347](IMH-IDSS-Fakturisanje.html:57347) |

---

## 5. Usklađenost (dubinski sloj) — provjeriti s knjigovođom

1. **Napomena o PDV-u** ([:57305](IMH-IDSS-Fakturisanje.html:57305)) glasi „**PPU** nije obveznik PDV-a…“ i štampa se i na **IDSS** računima, iako je IDSS „P.U.“ (osnovna škola). Pravni osnov (čl. 24/25 Zakona o PDV BiH) treba potvrditi posebno za svaku ustanovu.
2. **QR „BH PLAĆANJA“** koristi EPC/SEPA format (`BCD/002/SCT`):
   - SEPA format je predviđen za EUR, a ovdje se šalje iznos u BAM;
   - naziv IDSS-a ima više od 70 znakova, što je preko ograničenja specifikacije;
   - istovremeno su popunjeni i strukturirana referenca („001/26“, koja nije u RF formatu) i slobodni opis, što specifikacija ne dozvoljava.

   Velika je vjerovatnoća da banke u BiH **odbiju** ovaj QR kod. Treba testirati sa Sparkasse mBanking ili ukloniti QR dok se ne potvrdi.
3. **Hardkodirano ime operatera** (ime stvarne osobe) kao rezervna vrijednost na računu ([:57885](IMH-IDSS-Fakturisanje.html:57885)). Ovo je u suprotnosti s ranijom ispravkom P3-1, prema kojoj su lični podaci operatera uklonjeni.
4. Kolone PDV 0% i „PDV iznos“ na računu subjekta koji nije u sistemu PDV-a mogu zbuniti primaoca. Preporuka je ukloniti ih ili ostaviti samo napomenu o oslobođenju.

---

## 6. UI/UX analiza

| Oblast | Nalaz |
|---|---|
| **Funkcionalno ograničenje** | Novi račun ima **fiksno 3 reda stavki** ([:58124](IMH-IDSS-Fakturisanje.html:58124)) i nema dugmeta „+ Stavka“. Upis + materijal + depozit + školarina se ne mogu staviti na jedan račun. |
| **Zaglavlje** | 9 stavki navigacije, prekidač ustanove, status sinhronizacije, operater, tema i preuzimanje su u jednom `flex` redu bez prelamanja. Na 1366 px ekranu elementi se preklapaju. Nema responzivnog ponašanja. |
| **Dizajn sistem** | Stotine inline `style="…"` atributa. Boje banera, toastova i email upozorenja (`#fffbeb`, `#eff6ff`, `#92400e`) su hardkodirane i **ne prate tamnu temu**, pa je kontrast loš. Emoji ikone su pomiješane sa SVG ikonama. |
| **Dijalozi** | `prompt()` se koristi za brzo dodavanje porodice i djeteta: blokirajući sistemski dijalog, bez validacije. Dugme „Potvrdi“ je uvijek crveno (opasna akcija), čak i za izdavanje računa. Nema zatvaranja na Esc, nema zadržavanja fokusa u modalu ni ARIA oznaka. |
| **Skrivene akcije** | Status plaćanja se mijenja klikom na značku (badge). Ništa vizuelno ne pokazuje da se na nju može kliknuti. |
| **Fiksni footer** | Nalazi se dolje desno i prekriva dugmad u posljednjem redu tabele. |
| **Tabele** | Kolone se ne mogu sortirati, nema paginacije, a nema ni zbira po koloni. |
| **Raspored** | `grid-template-columns: 1fr 1fr` u Cjenovniku i Postavkama se ne prilagođava širini ekrana. |
| **Povratne informacije** | Pregled broja računa ne garantuje broj koji će se dodijeliti. Uspješno snimanje i greška pri snimanju na disk su samo mali tekst u zaglavlju. |

---

## 7. Plan sanacije (prioriteti)

### Faza 0 — hitno (zaustaviti pogrešne iznose)
1. **Jedno računsko jezgro** `money.js`: sve u **cijelim feninzima (integer)**. `lineNet = round(qty × price × (1 − disc))` po stavci, ukupno = zbir stavki, bruto i rabat se izvode iz istih zaokruženih vrijednosti. Forma, PDF, panel, mjesečni obračun, 3+, Excel i QR moraju koristiti **isključivo** ove funkcije.
2. Rabat čuvati kao **procenat s 2 decimale** (`discPct: 12.5`), a prikazivati s `toFixed(2)` bez skraćivanja.
3. `onNewChildChange`: **uvijek** postaviti cijenu i rabat iz zapisa djeteta (i na 0).
4. Kontrolni panel i grafikon: uvesti eksplicitnu granu za `overpaid` i brojati sve statuse posebno. `totalSum` računati poslije isključivanja storniranih.
5. Validacija na **jednom** mjestu (domenski sloj): `price ≥ 0`, `0 ≤ disc ≤ 100`, `total > 0` za sve putanje izdavanja, uključujući mjesečni obračun, 3+ i uvoz.

### Faza 1 — harmonizacija
6. **Jedan cjenovnik** (`pricing.json`) s eksplicitnim pravilima: `{ustanova, pravnaOsoba, program, lice, redDjeteta, cijena}`. `vCat`, katalog, 3+ i baner se **generišu** iz njega. Odluka uprave: da li je naredno dijete 570 ili 568? Ko fakturiše IDSS predškolsku grupu?
7. Računi dobijaju `famId` i `childId` (stabilni UUID). Duplikat je `(childId, period, vrsta usluge)` i provjerava se na **svim** putanjama izdavanja.
8. Prekidač ustanove dobija opciju „Sve“ i stvarno filtrira prikaze.
9. IBAN se automatski izvodi iz broja računa (BA39 + kontrolne cifre). Sva polja ustanove moraju biti uređiva.

### Faza 2 — računovodstveni model
10. **Uplate kao zasebni zapisi**: `{id, invoiceId, datum, iznos, način, izvod}`. Status se samo **izračunava** iz njih. Preplata postaje avans ili kredit.
11. Storno plaćenog računa automatski kreira avans ili obavezu povrata.
12. Kompletan dnevnik promjena (svaka promjena stanja, prije i poslije).
13. IndexedDB: zapis po računu (store `invoices`, `payments`, `families`), transakcije, `BroadcastChannel` zaključavanje kartica i atomsko dodjeljivanje broja računa.
14. Akcije po **ID-u**, ne po indeksu niza.

### Faza 3 — UI/UX
15. Dizajn tokeni za sve boje (uključujući upozorenja i toastove u tamnoj temi). Komponente: Modal (fokus, Esc), Tabela (sortiranje, paginacija), Polje za iznos (bs-BA format).
16. Dinamičan broj stavki na računu, sažetak koji se ažurira u stvarnom vremenu iz istog jezgra, jasna akcija „Evidentiraj uplatu“.
17. Bočna navigacija (sidebar) umjesto 9 dugmadi u zaglavlju i responzivni raspored.
18. PDF: vektorski jsPDF (tekst, ne slika), tačne proporcije, više strana. Uplatnica i QR s **preostalim** dugom.

### Faza 4 — kontrola kvaliteta
19. Jedinični testovi za jezgro (granični slučajevi: 0,005, 7,5%, 12,5%, storno, preplata) i test usklađenosti „forma = PDF = baza = Excel = panel“ za 1.000 nasumičnih računa.

---

---

## 8. Excel `IDSS_IMH_Kalkulator_Skolarine_2026-2027.xlsx` — analiza i poređenje s aplikacijom

**Struktura:** 6 listova:
- **Uputstvo**;
- **Unos**: porodica i do 6 djece;
- **Obracun**: 37 kolona formula po djetetu;
- **Izvjestaj**: za upravni odbor;
- **Cjenovnik**: 4 programa i parametri subvencije;
- **Napomene**: 16 ranijih nalaza.

Kalkulator je metodološki **znatno bolji od aplikacije**: ima parametre na jednom mjestu, pravilo zaokruživanja, pro-rata za upis tokom godine, august −50%, ograničenje subvencije na školarinu poslije popusta, kolonu provjera i kontrolni zbir. Ipak, ni Excel ni aplikacija ne slijede isti model, pa za istu porodicu daju **različite iznose**.

### 8.1 [KRITIČNO] Excel ne poznaje tri vrtićke grupe i IDSS Preschoolers vodi kao IDSS
| Mjesto | Šta piše | Ispravno |
|---|---|---|
| `Cjenovnik!A8` | jedan program „IMH Toddler / Predškolska grupa“ | dvije grupe: **Toddlers** i **Preschoolers** |
| `Cjenovnik!B9` | „Predškolska grupa **pri IDSS**“ | grupa vrtića **IMH** |
| `Izvjestaj!G21` `COUNTIF(...,"IMH*")` | „u IMH vrtiću: **1**“ (primjer Matović) | **2** (Lean i najmlađe dijete) |
| `Izvjestaj!G22` | „u IDSS (osnovna škola **+ predškola**): **2**“ | IDSS OŠ: **1** |
| `Unos!A2`, `Uputstvo` | „IMH vrtić i/ili IDSS škola/**predškola**“ | IDSS = samo OŠ I–IX |
| `Napomene` red 14 | braća u „različitim ustanovama (IMH 20% vs IDSS 10/15%)“ | IDSS Preschoolers i IMH su **ista** ustanova; dilema postoji samo između vrtića i OŠ |

Brojanje u izvještaju za odbor oslanja se na **naziv programa** („IMH*“) umjesto na kolonu „pravna osoba“. To je isti korijenski problem kao K4 u aplikaciji.

### 8.2 [KRITIČNO] Excel i aplikacija za istu porodicu računaju različitu subvenciju
Primjer iz Excela, porodica Matović (3 djece: OŠ, IDSS Preschoolers, Toddler), mjesečno:

| | Excel | Aplikacija (kalkulator 3+) |
|---|---|---|
| Lean (IDSS Preschoolers) | 235 KM (redovna) | **300 KM** (Čl. 7: 1. ili 2. dijete u vrtiću) |
| Najmlađe (Toddler) | 235 KM | **456 KM** (Čl. 9: 80% × 570) |
| **Ukupno mjesečno** | **470 KM** | **756 KM** |
| 6 mjeseci (jan–jun) | 2.820 KM | **4.536 KM** |

Razlika u potraživanju od Ministarstva je **1.716 KM** samo za ovu porodicu. Uzroci:
- Excel primjenjuje pravilo 3+ tek od **3. predškolskog djeteta** (`Cjenovnik!C20 = 3`) i bira **jedno** od tri pravila (A, B ili C, `C19`).
- Aplikacija primjenjuje Čl. 7 već na 1. i 2. dijete u vrtiću i uzima **najveće** od pravila koja se preklapaju.
- Excel ograničava subvenciju na školarinu **poslije** popusta (`MIN(AI…)`), a aplikacija na punu cijenu.

Excelov list Napomene (red 1) to i sam označava kao nejasno: potrebno je **pismeno tumačenje Ministarstva**, pa jedno pravilo ugraditi u oba alata.

### 8.3 [KRITIČNO] Ko je „naredno dijete“ — treći, nepomireni model
- **Excel:** redni broj u **cijeloj porodici**, uključujući djecu u OŠ (`F = redoslijed reda`). Lean je zato „2. dijete“ i dobija referentni popust od 20% iako je prvo dijete u vrtiću.
- **Aplikacija 3+:** brojanje samo među djecom u vrtiću. Lean plaća punu cijenu (750), a najmlađe dijete „naredno“ (570).
- **Baner u aplikaciji:** broj svih zapisa porodice.

Za isto dijete to daje 600, 637,50 ili 750 KM mjesečno, zavisno od alata. Uprava treba odlučiti: računa li se brat ili sestra u IDSS OŠ kod popusta u vrtiću IMH?

### 8.4 [VISOKO] Popust od 15 umjesto 15% daje besplatno ili negativno
- Validacija `Unos!K12:M17` je samo „decimalni broj ≥ 0“, bez gornje granice. Legenda kaže „upisujte kao postotak (npr. 7,5%)“.
- Ako operater upiše **15** umjesto 15%:
  - školarina: `MIN(L,1)` = 100% popusta, pa je školarina **0 KM**, bez upozorenja;
  - upisnina i produženi boravak: `P*(1-N(L))` nema ograničenja, pa upisnina 1.000 KM postaje **−14.000 KM**, a ukupni iznos za uplatu se smanjuje.
- **Ispravka:** validacija mora biti 0–1 (0–100%), plus provjera u koloni AE.

### 8.5 [SREDNJE] Novac se nigdje ne zaokružuje na 2 decimale
- Nijedna formula osim automatskog režima popusta ne koristi `ROUND(…,2)`.
- Mjesečna rata `AA = (O+T)/Y` daje npr. 3.825 / 7 = 546,428571… Na štampi stoji 546,43 × 7 = **3.825,01 KM**.
- Kontrola `O14` poredi nezaokružene vrijednosti, pa prikazuje „OK“ iako se odštampane rate ne slažu s ukupnim iznosom.
- Zaokruživanje cijene (568 → 570) primjenjuje se **samo** kad je `Unos!B8 = "Da"`. U ručnom režimu (podrazumijevano „Ne“) isti popust daje drugačiju cijenu od cjenovnika.

### 8.6 [SREDNJE] Depozit — različita pravila u Excelu i aplikaciji
- **Excel:** depozit se naplaćuje **samo kod obročnog plaćanja** (`U: N(Unos!I)<=1 → 0`), za sve programe.
- **Aplikacija:** depozit se uvijek nudi u katalogu kao „povratni depozit“, bez veze s načinom plaćanja.

Uprava treba potvrditi pravilo za vrtić IMH.

### 8.7 [NISKO] Ostalo
- Primjer Danijal ima popunjen i broj mjeseci (H) i mjesec upisa (Q), pa pokreće vlastito upozorenje u Provjeri. Primjer treba očistiti.
- `Napomene` red 7 kaže „plus upisnina 1.000 KM“, a primjer je ima 100% umanjenu (`L12 = 1`), pa je `Q6 = 0`.
- Pravilnik 3+ i Prilog 3 (algoritam) nisu ugrađeni ni u Excel ni u aplikaciju (`Uputstvo!A17`, `Napomene` red 15).
- Provjera ograničenja povećanja cijene (`Cjenovnik!A29:F32`) ne radi dok se ne unesu cijene 2025/26. Dok to ne bude urađeno, rizik gubitka sufinansiranja nije provjeren.

### 8.8 Preporuka — jedan model za oba alata
Excel `Cjenovnik` treba postati **izvor istine** za aplikaciju, uz ove dopune:
1. **Šifrarnik grupa:** `TODDLERS`, `PRESCHOOLERS`, `IDSS_PRESCHOOLERS` → pravna osoba **IMH**; `OS_I_IV`, `OS_V_IX` → pravna osoba **IDSS**.
2. Kolone **pravna osoba**, **pravilo zaokruživanja**, **mjeseci u godini** i **pravo na subvenciju** po grupi. Aplikacija ih čita, umjesto da ih hardkodira na četiri mjesta.
3. **Jedna** definicija „narednog djeteta“ i **jedno** pravilo subvencije za 3+ (nakon tumačenja Ministarstva), implementirani identično u Excelu i aplikaciji. Test: porodica Matović mora dati isti rezultat u oba alata.

---

*Svi brojevi linija odnose se na `IMH-IDSS-Fakturisanje.html` u stanju na dan analize.*
