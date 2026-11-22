# Definicija svrhe i namjene aplikacije

*Direktor, 2026-11-21. Ovaj dokument ima prednost pred svakim ranijim prijedlogom toka i ekrana; sve odluke o izgledu i toku se ravnaju po njemu. Ime operaterke se ne piše u repozitorij (BR-22): u aplikaciji se čita iz profila operatera.*

## 1. Svrha
- **Desktop aplikacija** koja unapređuje fakturisanje u **IMH** i **IDSS**.
- Instalirana na **jednom računaru**. Njome upravlja **FAS** (Financijsko-administrativni menadžer).
- Mora olakšati tri posla:
  1. **unos faktura za naredni mjesec** (cjenovnik: školarine, upisnine, potrošni materijal, produženi boravak i slično);
  2. **fakture za ostale usluge** IMH i IDSS: **sve što nije u cjenovniku** (npr. ljetna škola, sekcija, izlet);
  3. **praćenje naplate**.
- Ispravka Direktora, 2026-11-21; ostatak definicije je potvrđen.

## 2. Tri zahtjeva, ovim redom
1. **Pouzdana:** svaka faktura tačna; greška se presreće prije nego nastane.
2. **Efikasna:** brzo do gotovih, provjerenih faktura za IMH i IDSS za naredni mjesec.
3. **Minimalno učešće FAS:** sistem računa i predlaže, a FAS provjerava i odobrava.

## 3. Obavezne mogućnosti
| # | Mogućnost |
|---|---|
| M1 | **Presretanje greške:** svaki unos je šabloniran, s dozvoljenim formatima |
| M2 | **Pojedinačno i bulk zaduživanje** za IMH i za IDSS za naredni mjesec |
| M3 | **Dashboard:** precizan, vizuelno superioran sintetički prikaz svih parametara izdatih i naplaćenih faktura; jednostavan i kompaktan, kao u financijskim aplikacijama |
| M4 | **Zaštita podataka u skladu s GDPR** |
| M5 | **Štampa faktura u PDF i DOCX** |
| M6 | **Bulk slanje PDF faktura Office Manageru**. Office Manager ih prosljeđuje roditeljima i s njima komunicira o plaćanju; FAS ne komunicira s roditeljima. |
| M7 | **Izvoz kompletnih sadržaja u XLSX** |
| M8 | **FAS može izmijeniti bilo koji detalj; kad se utvrdi greška, unosi ispravku** (Direktor, 2026-11-21). Podatke o porodici, djetetu, upisu, cijenama i postavkama mijenja direktno. Izdata faktura se zakonito ispravlja knjižnim odobrenjem i novom fakturom. To je **jedan korak „Ispravi fakturu“**: kopija se otvori s istim podacima, FAS izmijeni šta treba, a sistem napravi storno i ispravljenu fakturu. |

## 4. Korisničko iskustvo (jedinstveno, vođeno)
1. **„Dobar dan, <ime>. Šta ćemo danas raditi?“**
   1. **Fakturisanje za IMH / IDSS**: školarine, upisnine, potrošni materijal, produženi boravak i slično.
   2. **Ostalo fakturisanje**: sve što nije u cjenovniku (ljetna škola, sekcija, izlet …).
   3. **Izvještavanje.**
2. FAS **prvo klikne IMH ili IDSS** da bi išla dalje.
3. Sve je praćeno **bojama ustanove** (IMH / IDSS) i **velikim oznakama koraka**, npr.:
   - **A.** unesi novu fakturu/e;
   - **B.** štampaj fakture;
   - **C.** pošalji fakture Office Manageru;
   - i slično.
4. Aplikacija **intuitivno vodi** FAS kroz sve procese.

## 5. Kasnije (odluka naknadno)
- **Forenzički modul:** FAS učita kartice kupaca (roditelja) i jednim klikom dobije forenzički izvještaj za internu upotrebu i gotov izvještaj za roditelje o tome kako je nastao dug.

## 6. Šta aplikacija već ima i šta nedostaje (stanje 2026-11-21)
| Zahtjev | Već postoji | Nedostaje |
|---|---|---|
| M1 presretanje greške | Kanonski formati svih polja, šabloni teksta, provjera i u bazi (DL-P015, DL-P017) | Proći kroz nove ekrane kad nastanu |
| M2 bulk / pojedinačno | Mjesečni obračun za oba (bulk), jedan račun po djetetu, pojedinačni račun (DL-P014) | Vođeni koraci po ustanovi |
| M3 dashboard | Kontrolni panel (DL-P016) | Dorada prema „vizuelno superiornom, kompaktnom“ prikazu |
| M4 GDPR | Šifrovana baza (AES-256), ključ zaštićen u Windowsu, bez ličnih podataka u zapisima (BR-22) | Pregled usklađenosti: prava ispitanika, rok čuvanja, izvoz/brisanje na zahtjev |
| M5 PDF / DOCX | PDF računa (DL-P012); DOCX računa i izvještaja na memorandumu, A4 (DL-P020, DL-P021) | — |
| M6 slanje Office Manageru | Izvoz ZIP i Outlook nacrt s PDF-ovima na info-mejtas@ (DL-P006) | Uklopiti kao korak „C.“ u vođeni tok |
| M7 XLSX | Excel nalaza uvoza; izvoz registra u XLSX i CSV (DL-P020) | — |
| UX | Početni ekran „Dobar dan“, izbor posla → IMH / IDSS → koraci u bojama ustanove (DL-P019) | Završna provjera Direktora |

**Napomena:** ekrani za porodice, djecu i upise ostaju potrebni (iz njih sistem zna koga i koliko fakturisati), ali u novom toku dolaze kao **korak unutar fakturisanja** („provjeri spisak djece za naredni mjesec“), a ne kao zasebna tabela u meniju.
