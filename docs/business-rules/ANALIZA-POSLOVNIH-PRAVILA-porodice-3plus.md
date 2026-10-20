# Analiza poslovnih pravila — repozitorij `porodice-3plus`

**Datum:** 20.10.2026., revizija 3 (po potvrdama direktora istog dana)
**Izvor:** https://github.com/Internationale-Deutsche-Schule-Sarajevo/porodice-3plus (commit `406442c`)
**Svrha:** jedinstven, citiran skup poslovnih pravila za aplikaciju za fakturisanje (Commander M-4, M-7). Sve što dokumenti i direktor nisu riješili vodi se kao otvoreno pitanje (poglavlje 6).

---

## 0. Potvrde direktora (20.10.2026.) — imaju prednost

| # | Pravilo |
|---|---|
| D1 | IMH i IDSS fakturišu **pune iznose po cjenovniku**. Ustanova nikada ne smije biti oštećena ni za jedan iznos, osim odlukom Upravnog odbora IMH, odnosno Školskog odbora IDSS. |
| D2 | **Nijedno dijete nije besplatno**, pa ni treće. U IMH-u je popust za drugo i **svako naredno** dijete **20%** (cjenovnički iznosi „naredno dijete“). |
| D3 | IMH i IDSS su **odvojena pravna lica**. „Naredno dijete“ se broji samo unutar iste ustanove. Ostali popusti odobravaju se samo odlukom odbora. |
| D4 | Grupe Toddlers, Preschoolers i IDSS Preschoolers pripadaju **IMH-u**. IDSS je samo osnovna škola (I–IX). |
| D5 | **Tok subvencije:** roditelj plaća IMH-u puni iznos. IMH **početkom tekućeg mjeseca** podnosi resornom ministarstvu **fakturu sa spiskom roditelja** za prethodni mjesec. Ministarstvo uplaćuje novac IMH-u, a IMH vraća iznos subvencije **na račune roditelja**. |
| D6 | **Opomene se izdaju, zatezna kamata se ne naplaćuje.** |
| D7 | Aplikaciju koristi **samo jedna osoba**: Financijsko-administrativni menadžer (ime i kontakt se čuvaju samo u postavkama aplikacije). |
| D11 | Popust se **uvijek računa na mlađe dijete**. Najstarije dijete u istoj ustanovi plaća puni iznos, a redoslijed ostalih određuje datum rođenja. Primjer: stariji u Toddlers (710), mlađi u IDSS Preschoolers (600) = 1.310 KM. |
| D12 | Na fakturi ministarstvu aplikacija za svako dijete **predlaže** iznos subvencije prema Programu. Kad se pravila preklapaju, prikazuje i iznos po drugom pravilu. Azra iznos provjerava i potvrđuje prije izdavanja fakture. |
| D13 | **Jedini vanjski platilac** je resorno Ministarstvo za odgoj i obrazovanje KS. Djece koju sufinansira Ministarstvo za rad i socijalnu politiku (Zakon, čl. 58) nema. |
| D14 | Na računu IDSS-a ide **MBSU 65-05-0013-16**, kao u memorandumu. |
| D15 | IDSS povrat „3 mjesečne rate“: jedna rata je **godišnja školarina / 10**. Primjer: 970 KM, povrat 2.910 KM. 📌 ASSUMED: za dijete s popustom osnovica je umanjena školarina (npr. 8.730 / 10 × 3 = 2.619 KM). |
| D16 | IMH ima **pisanu saglasnost Ministarstva** za povećanje cijena 2026/27. Prekoračenja iz poglavlja 9 zato nisu rizik. Aplikacija bilježi broj i datum saglasnosti uz cjenovnik. |
| D8 | Obrisani „Pravilnik o primjeni Programa (porodice 3+)“ se **zanemaruje**. |

📌 ASSUMED: čl. 4 Pravilnika o formiranju cijena IMH sam čitao kao da je treće dijete besplatno. **To je bilo pogrešno tumačenje i povučeno je.** Mjerodavno je D2.

---

## 1. Izvori

| # | Fajl | Status |
|---|---|---|
| 1 | `IMH_Cjenovnik_2026-2027.pdf` | **obavezujući** |
| 2 | `IMH_Pravilnik_O_Formiranju_Cijena_2026-2027.docx` | **obavezujući** (uz D2) |
| 3 | `IDSS_Cjenovnik_Skolovanja_2026-2027.pdf` (novo) | **obavezujući** |
| 3a | `IDSS_Pravilnik_O_Formiranju_Cijena_2026-2027.pdf` (lokalno: `C:\DAVOR_IDSS\Locker\DOKUMENTACIJA\UPIS\2026-2027\`; Školski odbor, 7. sjednica, 19.02.2026.) | **obavezujući** |
| 4 | Program sufinansiranja (Sl. novine KS 16/26) | **obavezujući** |
| 5–8 | Zakon o predškolskom odgoju KS 26/08, 21/09, 33/21, 31/22 | **obavezujući** |
| 9 | Dopis Ministarstva 11-04-34-54267-11/26 (upis nakon roka) | informativno |
| 10–12 | Prilog 3 (Algoritam), Vodič, `index.html` | samo informativno (vezani za zanemareni pravilnik; `index.html` pogrešno računa „3.+ besplatno“) |
| — | obrisani Pravilnik 3+ | **zanemaren** (D8) |

---

## 2. P.P.U. IMH (Toddlers, Preschoolers, IDSS Preschoolers)

### 2.1 Pravna osoba i račun
- P.P.U. International Montessori House, Sparkasse Bank, račun 1990 4900 5848 7943.
- IBAN BA39 1990 4900 5848 7943, SWIFT ABSBBA22.
- Samo **cjelodnevni** program (8–17 h).

### 2.2 Cjenovnik 2026/2027 (KM)
| Stavka | Toddlers i Preschoolers — domaća | — strana | IDSS Preschoolers — domaća | — strana |
|---|---|---|---|---|
| Upisnina (jednokratno, nepovratno) | 200 | 200 | 500 | 1.000 |
| Participacija za materijal (godišnje, nepovratno) | 300 | 300 | 300 | 300 |
| Depozit — prvo dijete | 710 | 810 | 750 | 850 |
| Depozit — drugo i svako naredno (−20%) | 570 | 650 | 600 | 680 |
| Školarina mjesečno — prvo dijete | 710 | 810 | 750 | 850 |
| Školarina mjesečno — drugo i svako naredno (−20%) | 570 | 650 | 600 | 680 |
| Školarina godišnje (12 rata) | 8.520 / 6.840 | 9.720 / 7.800 | 9.000 / 7.200 | 10.200 / 8.160 |

Iznos popusta se zaokružuje (Pravilnik o cijenama, čl. 1 i 2), pa su mjerodavni iznosi iz tabele.

### 2.3 Jednokratni troškovi (Pravilnik o cijenama, čl. 1)
- Dijete je upisano tek kad su upisnina, depozit i participacija evidentirani na računu IMH.
- Upisnina:
  - važi do ispisa;
  - ne naplaćuje se pri direktnom prelasku iz IMH Preschoolers u IDSS Preschoolers.
- Depozit:
  - plaća se uvijek;
  - vraća se u roku od 3 mjeseca ako su sve obaveze do 31. augusta izmirene;
  - zadržava se pri prijevremenom raskidu;
  - **prenosi se** pri prelasku IMH Preschoolers → IDSS Preschoolers.
- Participacija se plaća jednom po školskoj godini.

### 2.4 Školarina (Pravilnik o cijenama, čl. 2, 7)
- 12 mjesečnih rata, rok **do 5. u mjesecu za tekući mjesec**.
- Kasniji upis: proporcionalno broju preostalih mjesečnih rata.
- Mjesečna rata se plaća u punom iznosu, bez obzira na zadnji dan boravka.
- Ispis se najavljuje pisano **2 mjeseca unaprijed**. U suprotnom se plaća dodatni mjesec.
- Kad jedno dijete napusti IMH, preostalo dijete se vraća na **puni iznos** (710/810, odnosno 750/850).

### 2.5 Opomene (Pravilnik o cijenama, čl. 6, uz D6)
- Opomena s rokom plaćanja; **bez zatezne kamate**.
- Ako i treća opomena ostane bez uspjeha, slijedi suspenzija do 1 mjesec, a zatim mogući raskid ugovora.

---

## 3. P.U. IDSS — osnovna škola (IDSS cjenovnik i Pravilnik o formiranju cijena 2026/2027)

### 3.1 Pravna osoba i račun
- P.U. Internationale Deutsche Schule Sarajevo, Sparkasse Bank, račun 1994990021809884.
- IBAN BA39 1994990021809884, SWIFT ABSBBA22.
- JIB 4202220420007, Reg. 580342.
- Plaćanje **najkasnije do 5. u tekućem mjesecu za tekući mjesec**. Bankovne naknade snosi roditelj.
- Na uplatnici se navode roditelj, dijete i svrha; kod obročnog plaćanja i period (čl. 3).
- Školska godina za školarinu traje **01.09.–30.06.** (čl. 2). Nastava je od 8:00 do 14:40.

### 3.2 Cjenovnik (KM, **godišnji** iznosi)
| Stavka | Domaća lica | Strana lica |
|---|---|---|
| Upisnina | 1.000 | 1.500 |
| Depozit (**samo za obročno plaćanje**) | 1.500 | 1.500 |
| Produženi boravak (I–IX razred) | 2.500 | 2.500 |
| Školarina I–IV razred | 9.700 | 11.970 |
| ↳ drugo upisano dijete (−10%) | 8.730 | 10.773 |
| ↳ treće upisano dijete (−15%) | 8.245 | 10.175 |
| Školarina V–IX razred | 11.030 | 13.700 |
| ↳ drugo upisano dijete (−10%) | 9.927 | 12.330 |
| ↳ treće upisano dijete (−15%) | 9.376 | 11.645 |

### 3.3 Plan plaćanja (D9, direktor 20.10.2026.)
| Stavka | Pravilo |
|---|---|
| Školarina | Broj rata se **dogovara s roditeljem**: odjednom za cijelu godinu, npr. 3 kvartalne rate, ili do **12 mjesečnih rata**. Za uplatu unaprijed nema popusta, osim odlukom Školskog odbora. |
| Depozit 1.500 KM | **Opcion.** Naplaćuje se samo uz obročno plaćanje i samo kad ustanova procijeni rizik da roditelj ode bez plaćanja. |
| Produženi boravak 2.500 KM | 10 jednakih mjesečnih rata ili, poželjno, odjednom. |
| Upisnina | Odjednom. |
| Upis tokom godine | Školarina se računa **za preostali period do kraja nastavne godine (juni)**. Primjer: upis u januaru → 6 mjeseci. |

📌 ASSUMED: mjesečna osnovica za obračun preostalog perioda je godišnji iznos / 10 (nastavna godina septembar–juni), a mjesec upisa se računa cijeli. Primjer: 9.700 / 10 × 6 = 5.820 KM. Isto računa i Excel kalkulator.

**Posljedica za aplikaciju:** svako dijete dobija **plan plaćanja** za školsku godinu (broj rata, iznos i rok svake rate), umjesto fiksnog mjesečnog računa.

Pravilnik (čl. 2) potvrđuje: školarina se plaća odjednom bez umanjenja ili u najviše 12 mjesečnih rata prema Ugovoru. Depozit traži Školski odbor kod obročnog plaćanja, najviše do iznosa iz cjenovnika (čl. 7).

### 3.4 Popusti (čl. 4–6)
- Popust se daje **samo na školarinu**:
  - drugo (mlađe) dijete −10%;
  - treće (najmlađe) dijete −15%;
  - **četvrto i svako naredno −15%** (D10).
- Popust **prestaje** kad jedno dijete napusti IDSS. Ako u školi ostanu dvoje djece, važi popust za drugo dijete.
- Iznosi su zaokruženi na cijelu KM: 11.970 × 0,85 = 10.174,5 → 10.175; 11.030 × 0,85 = 9.375,5 → 9.376.
- Ostali popusti i stipendije: samo odlukom Školskog odbora, na pisanu molbu roditelja. Nisu retroaktivni i važe najduže jednu školsku godinu.

### 3.5 Upisnina (čl. 1)
- 1.000 KM za domaća, 1.500 KM za strana lica. Nepovratna je i plaća se u roku od 7 dana od ispunjenja uslova za upis.
- **500 / 1.000 KM** ako je dijete u godini pred školu pohađalo **IDSS predškolsku grupu**. To je grupa IMH-a (D4), pa aplikacija mora povezati evidencije obje ustanove.
- Upis u I razred je uslovljen procjenom zrelosti djeteta. Dijete ne može na nastavu bez potvrde računovodstva da je upisnina uplaćena.

### 3.6 Dodatne usluge
| Usluga | Cijena | Pravilo |
|---|---|---|
| Produženi boravak (čl. 11) | 2.500 KM godišnje (sep–jun) | Usluga po izboru, **bez popusta**, ne umanjuje se za odsustvo. Za narednu godinu plaća se u cijelosti **do 31.07.** Upis tokom godine: umanjenje za mjesece kada dijete nije pohađalo. Mjesečno plaćanje odobrava direktor na pisani zahtjev. |
| **Doručak** (čl. 9) | **60 KM mjesečno** | Samo za djecu čiji su se roditelji izjasnili. Najviše 10 rata, rok do 5. u mjesecu. |
| **Ljetna škola** (čl. 8) | određuje Školski odbor | U augustu, 8–17 h. Cijena zavisi od broja polaznika i sadržaja. |
| Izleti (čl. 12) | puni trošak | Snosi ih roditelj, osim ako IDSS odredi drugačije. |

### 3.7 Opomene (čl. 7)
- Opomena s rokom plaćanja; bez zatezne kamate (D6).
- Ako i treća opomena ostane bez uspjeha, nastava se suspenduje na 1 mjesec. Propuštena nastava se ne nadoknađuje.
- Ako ni tada nema uplate, slijedi jednostrani raskid ugovora i zabrana upisa u narednu godinu.

### 3.8 Ispis i povrat (čl. 10)
- Ispis se najavljuje **pisano 2 mjeseca unaprijed** i moguć je samo **na kraju I polugodišta ili na kraju školske godine**. Pri ispisu za I polugodište dijete pohađa nastavu do 31.01.
- **Povrat 3 mjesečne rate** u dva slučaja:
  - roditelj je platio cijelu godinu do 31.12., a dijete se ispisuje za I polugodište;
  - roditelj je platio cijelu narednu godinu do 10.05., a raskida ugovor prije početka godine.
- **Kod obročnog plaćanja** IDSS zadržava uplaćene rate i depozit, umanjen za realne troškove. Roditelj plaća školarinu **do 31.12.** (ispis u I polugodištu), odnosno do 30.06. (ispis u II polugodištu).
- Bez pisane najave **do 31.12.** za narednu godinu IDSS zadržava sve uplate i cijeli depozit.
- Upisnina se nikad ne vraća.

### 3.9 Nedosljednosti u samom IDSS pravilniku (za ispravku dokumenta, ne utiču na obračun)
- Naslovna strana kaže „2026/2027“, a naslov na str. 2 kaže „za školsku **2025/2026** godinu“.
- Čl. 2 i 11 upućuju na račun „iz člana 4“, a račun je u **članu 3**.
- Produženi boravak: čl. 2 kaže 14:40–17:00, a čl. 11 kaže 15:15–17:00.
- U podnožju je adresa **Buka 11** (adresa IMH-a), a aplikacija i Excel za IDSS koriste **Buka 13**. Telefoni u zaglavlju i podnožju se razlikuju (vidi Q8).

---

## 4. Subvencija resornog ministarstva (Program 16/26 + D5) — samo IMH

1. **Korisnici:** dijete upisano putem EMIS-predškolsko, državljanin BiH s prebivalištem u KS. Strani državljani nisu korisnici. Program ne obuhvata IDSS osnovnu školu.
2. **Iznosi iz Programa** (mjesečno):
   - 235 KM cjelodnevni / 120 KM poludnevni;
   - porodice 3+, kad dvoje već pohađa vrtić: 300 / 150 KM;
   - treće i naredno dijete, kad dvoje već pohađa: „besplatno“;
   - treće i naredno iz porodice 3+: 80%.

   **Faktura roditelju se ne mijenja** (D1). Subvencija je povrat roditelju.
3. **Mjesečni tok u aplikaciji (D5):**

   | Korak | Kada | Zapis u aplikaciji |
   |---|---|---|
   | a) Roditelj plaća puni iznos po fakturi | do 5. u mjesecu | uplata roditelja |
   | b) IMH izdaje fakturu ministarstvu sa spiskom roditelja i iznosom po djetetu | početkom mjeseca, za prethodni mjesec | **faktura ministarstvu + prilog-spisak** |
   | c) Ministarstvo uplaćuje IMH-u | — | prijem sredstava, po djetetu |
   | d) IMH vraća subvenciju na račun roditelja | nakon prijema | **povrat roditelju** (IBAN roditelja) |
   | e) Razlika (ministarstvo platilo manje ili ništa) | — | otvorena stavka i obavijest |

4. **Uslov iz Programa:** roditelj **blagovremeno** izvršava obaveze prema ustanovi. U suprotnom EMIS prekida ugovor i sufinansiranje prestaje. Aplikacija zato mora jasno pokazati ko kasni.
5. **August:** sufinansiranje −50%. Program kaže „august 2026.“, a period je 01.09.2026.–30.08.2027.
6. **Ograničenje cijene:** povećanje u odnosu na 2025/26 najviše 3% kad je cijena bila veća od 600 KM. U suprotnom Ministarstvo raskida ugovor.
7. Ministarstvu se odmah prijavljuju izostanak duži od 15 dana u mjesecu i promjena cjelodnevni → poludnevni. Neopravdano odsustvo duže od 30 dana znači ispis.

---

## 5. Zakon — uticaj na aplikaciju
- **Čuvanje podataka** (čl. 53g): lični podaci djeteta u elektronskoj evidenciji čuvaju se **trajno**, ostale evidencije **5 godina**.
- **Zaštita** (čl. 53h): kriptografija, HTTPS/VPN, zaštita od gubitka i neovlaštenog pristupa.
- **Čl. 58:** Ministarstvo za rad i socijalnu politiku KS sufinansira dio troškova za posebne kategorije djece. Moguć je drugi izvor subvencije.

---

## 6. Sukobi s postojećom aplikacijom i Excelom

| # | Alat | Nalaz | Ispravno |
|---|---|---|---|
| S1 | Aplikacija | IDSS Preschoolers se fakturiše pod IDSS-om | IMH (D4) |
| S2 | Aplikacija | Popust je slobodan broj, bez pravila o „narednom djetetu“ i bez zapisa odluke odbora | automatski −20% (IMH) i −10%/−15% (IDSS) po cjenovniku; ostalo samo s odlukom odbora |
| S3 | Aplikacija, modul 3+ | Bira kategoriju subvencije i prikazuje je kao umanjenje troška. Nema fakture ministarstvu, prijema sredstava ni povrata roditeljima. | tok iz poglavlja 4.3 |
| S4 | Aplikacija | Baner za depozit nudi 20% na već umanjenu stavku. Nedostaje depozit „naredno dijete“ za IDSS Preschoolers. | jedan cjenovnik |
| S5 | Aplikacija | Nema prelaska IMH Preschoolers → IDSS Preschoolers ni statusa „čeka upisne uplate“ | Pravilnik o cijenama čl. 1 |
| S6 | Aplikacija | Nema opomena, roka ispisa od 2 mjeseca ni povratka na puni iznos kad jedno dijete napusti IMH | čl. 6, 7 |
| S7 | Aplikacija | Nema politike čuvanja podataka; email po imenu oca | Zakon čl. 53g–53h |
| S8 | Aplikacija | Fallback s imenom operatera je hardkodiran u šablonu računa | operater iz postavki (D7) |
| S9 | Excel | Depozit za IMH „samo kod obročnog plaćanja“ | IMH: uvijek. **IDSS: tačno, samo obročno.** |
| S10 | Excel | IDSS Preschoolers se broji kao IDSS; „naredno dijete“ se broji preko obje ustanove | D3, D4 |
| S11 | `index.html` u repozitoriju | „3.+ dijete besplatno“ | D2 |
| S12 | Aplikacija i Excel | Nema stavki **doručak** (60 KM mjesečno) ni **ljetna škola**; nema umanjene upisnine 500/1.000 nakon IDSS predškolske grupe | IDSS pravilnik čl. 1, 8, 9 |
| S13 | Aplikacija i Excel | Nema pravila o ispisu i povratu (polugodište, 3 rate, rokovi 31.12. i 10.05.); nema roka 31.07. za produženi boravak | IDSS pravilnik čl. 10, 11 |
| S14 | Aplikacija | Popust se ne ukida automatski kad jedno dijete napusti ustanovu | IMH čl. 7; IDSS čl. 4, 5 |

---

## 8. Zvanični podaci ustanova za zaglavlje računa (memorandumi)

**Izvori:** `C:\DAVOR_IMH\Locker\Memorandum_IMH.pdf` i `C:\DAVOR_IDSS\Locker\MEMORANDUM_IDSS_OD_20042026.dotx`.

| Podatak | IMH | IDSS |
|---|---|---|
| Puni naziv | Privatna predškolska ustanova “International Montessori House” Sarajevo | Privatna ustanova „INTERNATIONALE DEUTSCHE SCHULE SARAJEVO“ – Međunarodna Njemačka Škola Sarajevo |
| Adresa | Buka 11, 71 000 Sarajevo | **Buka 13**, 71 000 Sarajevo |
| Telefon | +387 33 267 965 · fax +387 33 267 966 | +387 33 560 520 · mob +387 60 345 1275 |
| ID broj | 4201731140006 | 4202220420007 |
| Registarski broj | Reg. broj 65-01-0165-12 | **MBSU 65-05-0013-16** (D14; broj 580342 se ne koristi) |
| Račun | Sparkasse 1990 4900 5848 7943 | Sparkasse 199 499 002 180 9884 |
| IBAN / SWIFT | BA39 1990 4900 5848 7943 / ABSBBA22 | BA39 1994 9900 2180 9884 / ABSBBA22 |
| Email / web | info-mejtas@montessorihouse.ba · www.montessorihouse.ba | info@idss.ba · www.idss.edu.ba |
| Logo | „The Montessori House“ (smeđi, zeleni, ružičasti kvadrati) | službeni PNG iz memoranduma (`word/media/image2.png`) |

**Sukobi s aplikacijom:**
- **S15:** aplikacija koristi vlastite, ručno nacrtane SVG logotipe drugačijih boja. Treba koristiti **službene logotipe** iz memoranduma.
- **S16:** skraćeni nazivi („P.P.U. …“, „P.U. …“) na računu treba da budu puni zvanični nazivi iz memoranduma.
- **S17:** IDSS adresa u podnožju pravilnika (Buka 11) je greška u dokumentu. Mjerodavna je Buka 13.

---

## 9. Provjera ograničenja povećanja cijene (Program 16/26)

**Pravilo:** ako je cijena u 2025/26 bila veća od 600 KM, povećanje za 2026/27 smije biti najviše **3%**. Povećanje iznad toga ili bez saglasnosti Ministarstva vodi **raskidu ugovora o sufinansiranju**.

**Izvori:** IMH Pravilnik 2025/26 (član 2) i IMH Pravilnik i Cjenovnik 2026/27.

| Program — mjesečna školarina | 2025/26 | 2026/27 | Povećanje | Dozvoljeno najviše (+3%) | Status |
|---|---|---|---|---|---|
| Toddlers / Preschoolers — domaća, prvo dijete | 680 | **710** | **+4,41%** | 700,40 | 🔴 **PREKORAČENJE** |
| Toddlers / Preschoolers — domaća, naredno | 560 | 570 | +1,79% | 576,80 | ✅ |
| Toddlers / Preschoolers — strana, prvo | 780 | 810 | +3,85% | 803,40 | ⚠️ iznad 3% (strani nisu korisnici Programa) |
| Toddlers / Preschoolers — strana, naredno | 640 | 650 | +1,56% | 659,20 | ✅ |
| IDSS Preschoolers — domaća, prvo | 730 | 750 | +2,74% | 751,90 | ✅ |
| IDSS Preschoolers — domaća, naredno | 580 | **600** | **+3,45%** | 597,40 | 🔴 **PREKORAČENJE** |
| IDSS Preschoolers — strana, prvo | 830 | 850 | +2,41% | 854,90 | ✅ |
| IDSS Preschoolers — strana, naredno | 670 | 680 | +1,49% | 690,10 | ✅ |

🔍 **DETECTED ISSUE:** dvije cijene za domaća lica prelaze granicu od 3%:
- **710 KM** za Toddlers / Preschoolers (prvo dijete);
- **600 KM** za IDSS Preschoolers (naredno dijete).

✅ **Riješeno (D16):** IMH ima pisanu saglasnost Ministarstva za povećanja 2026/27.

Program spominje „cijenu boravka po jednom djetetu“. Nije jasno da li se granica primjenjuje i na cijenu „naredno dijete“, pa i drugu stavku treba provjeriti s Ministarstvom.

**Ostale razlike 2025/26 → 2026/27** (jednokratni troškovi; Program ih ne ograničava izričito):
- upisnina Toddlers / Preschoolers: 50 / 60 → 200 / 200 KM;
- participacija: 60 → 300 KM;
- depozit prati školarinu (680 → 710, 560 → 570, 730 → 750, 580 → 600).

🔍 **DETECTED ISSUE:** pravilnik 2025/26 u čl. 4 ima samo pravilo „20% za drugo i svako naredno dijete“. Verzija 2026/27 iz repozitorija u čl. 4 sadrži i dodatni stav: „tri ili više djece … obaveza plaćanja postoji samo za prvo i drugo dijete … svako naredno dijete … oslobođeno“. To je u suprotnosti s pravilom D2. Treba provjeriti da li je potpisana verzija pravilnika 2026/27 ista kao ona u repozitoriju.

**Za aplikaciju:** cijene se čuvaju po školskim godinama, a aplikacija prikazuje upozorenje kad povećanje za domaća lica prelazi granicu iz Programa.

---

## 7. Otvorena pitanja (postavljam jedno po jedno)

| # | Pitanje | Moja preporuka |
|---|---|---|
| ~~Q1~~ | ~~IDSS raspored rata~~ | **Riješeno → poglavlje 3.3** |
| ~~Q2~~ | ~~IDSS popust za 4.+ dijete~~ | **Riješeno: 15% (poglavlje 3.4)** |
| ~~Q3~~ | ~~Redoslijed djece~~ | **Riješeno: popust uvijek na mlađe dijete (D11)** |
| ~~Q4~~ | ~~Iznos subvencije na fakturi ministarstvu~~ | **Riješeno: prijedlog + potvrda (D12)** |
| ~~Q5~~ | ~~Drugi platilac~~ | **Riješeno: nema (D13)** |
| ~~Q6~~ | ~~IDSS pravilnik~~ | **Riješeno: dostavljen i analiziran (poglavlje 3)** |
| ~~Q8~~ | ~~Adresa i telefon IDSS-a~~ | **Riješeno memorandumom: Buka 13, +387 33 560 520 (poglavlje 8)** |
| ~~Q10~~ | ~~IDSS registarski broj~~ | **Riješeno: MBSU 65-05-0013-16 (D14)** |
| ~~Q9~~ | ~~Osnovica povrata 3 rate~~ | **Riješeno: godišnja školarina / 10 (D15)** |
| ~~Q7~~ | ~~IMH cijene 2025/26~~ | **Riješeno: `C:\DAVOR_IMH\Locker\PRAVO\PRAVILNIK\IMH_Pravilnik_O_Formiranju_Cijena_2025-2026.docx` → poglavlje 9** |
| ~~Q11~~ | ~~Saglasnost Ministarstva za povećanje cijena~~ | **Riješeno: IMH ima pisanu saglasnost za 2026/27 (D16)** |

**Sva poslovna pitanja su zatvorena (20.10.2026.).** Dvije pretpostavke čekaju eventualnu korekciju direktora:
- mjesečna osnovica za IDSS je godišnji iznos / 10;
- povrat 3 rate kod djeteta s popustom računa se od umanjene školarine.

**Iz IDSS cjenovnika 2025/26** (`C:\DAVOR_IDSS\Locker\DOKUMENTACIJA\UPIS\2025-2026\`):
- školarine, upisnine i depozit su **nepromijenjeni** u odnosu na 2026/27;
- produženi boravak je poskupio sa **2.000 na 2.500 KM** (+25%). Ograničenje iz Programa važi samo za predškolske ustanove, pa za školu nema posljedica.
