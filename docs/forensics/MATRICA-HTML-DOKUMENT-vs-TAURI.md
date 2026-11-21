# Matrica: HTML dokument → Tauri aplikacija

**Datum:** 21.11.2026.
**Izvor:** `IMH-IDSS-Fakturisanje.html` (19.10.2026., 77.924 linije, baza `imh_idss_db_v2`). Direktor ga je odredio kao dokument koji se maksimalno koristi.
**Metod:** iz bundla je izdvojen aplikacijski kod (≈4.540 linija, moduli `src/*.js`), bez biblioteka. Svaka stavka je upoređena s kodom Tauri aplikacije, grana `docs/html-document-audit` (uključuje storno).
**Lični podaci:** početna baza u dokumentu je prazna, a u ovaj izvještaj nije prepisano nijedno ime.

**Oznake:**
- ✅ — u Tauri aplikaciji, provjereno;
- 🟡 — djelimično;
- ❌ — nedostaje i **preuzima se**;
- ⛔ — namjerno se ne preuzima, uz razlog.

---

## 1. Poslovna pravila i cijene

| # | Stavka u dokumentu | Izvor (modul) | Tauri | Napomena |
|---|---|---|---|---|
| 1.1 | Cjenovnik 2026/2027, svih 33 stavke (IMH, IDSS predškolska, IDSS I–IV i V–IX, upisnine, materijal, depoziti, produženi boravak) | `catalog.js` | ✅ | Upoređeno iznos po iznos s `price-lists/seed.ts`: **33/33 tačno**. Tauri dodatno ima popuste za braću i sestre stranih lica u IDSS i doručak 60 KM, svaku stavku s izvorom u Pravilniku. |
| 1.2 | Računu roditelju se uvijek naplaćuje **puna cijena po cjenovniku**: **drugo i svako naredno dijete** po cijeni „naredno dijete“ (IMH 570/650, IDSS predškolska 600/680) | `porodice-3plus.js`, vodič | ✅ | Tauri BR-4/BR-6. *Pitanje o „cijeni drugog djeteta“ nije trebalo postavljati; odgovor je u dokumentu.* |
| 1.3 | Popust na depozit za drugo i naredno dijete (IMH 570/650, IDSS predškolska 600/680) | `checkDepositDiscountRule` | ✅ | U Tauriju je to cijena iz cjenovnika (tier SUBSEQUENT), a ne ručni popust od 20 %. |
| 1.4 | IDSS školarina: 2. dijete −10 %, 3. i naredno −15 % | `catalog.js` | ✅ | BR-5. |
| 1.5 | **IDSS predškolska grupa pripada P.P.U. IMH**; fakturiše je IMH (račun 1990490058487943) | vodič 3+, `STATUS_LABEL_3PLUS` | ✅ | BR-1, program `IDSS_PRESCHOOLERS` → IMH. Sam `catalog.js` je tu grupu pogrešno svrstao pod „IDSS“; Tauri slijedi vodič, kao i forenzička analiza (K3). |
| 1.6 | Popust odbora u % na računu | `compute3Plus` (`popustPct`) | ✅ | BR-7: odluka odbora s brojem, datumom i periodom važenja. |
| 1.7 | Subvencija se **ne odbija** s računa: IMH je potražuje od Ministarstva i vraća roditelju | vodič 3+ | 🟡 | Pravilo je zapisano u BR-16/BR-17, ali ciklus prema Ministarstvu još ne postoji → **F5**. |
| 1.8 | Subvencionira se **samo školarina** (ne upis, participacija, materijal ni depozit) | vodič 3+ | 🟡 | BR-17/BR-18 → **F5**. |
| 1.9 | **Čl. 6** — manje od 3 djece: 235 KM/mjesečno (cjelodnevni boravak) | `DEFAULT_SUB_3PLUS.cl6` | 🟡 | BR-18 (iznos) → **F5** (obračun). |
| 1.10 | **Čl. 7** — porodica 3+, 1. i 2. dijete u vrtiću: 300 KM | `cl7` | 🟡 | → **F5**. |
| 1.11 | **Čl. 8** — porodica 3+, 3. i naredno dijete u vrtiću: 100 % (besplatno) | `compute3Plus` | 🟡 | → **F5**. |
| 1.12 | **Čl. 9** — 3. i naredno dijete **po rođenju** u porodici 3+: 80 % pune cijene | `compute3Plus` | 🟡 | → **F5**. Kad se preklapaju članovi, uzima se najpovoljniji, nikad više od pune cijene (BR-18: „prikaži alternative, operater potvrđuje“). |
| 1.13 | Avgust: subvencija −50 % | `state.august` | 🟡 | → **F5**. |
| 1.14 | Strano lice nema pravo na sufinansiranje | `compute3Plus` | 🟡 | → **F5** (`residency = FOREIGN`). |
| 1.15 | Roditelj se može odreći subvencije | `odricanje` | ❌ | → **F5**: polje „odrekao se subvencije“ na upisu. |
| 1.16 | Djeca koja nisu u vrtiću (škola, fakultet, beba < 6 mj., drugi vrtić) ulaze u broj djece N (i M za drugi vrtić) | `STATUS_LABEL_3PLUS`, `compute3Plus` | ❌ | → **F5**: porodica mora moći evidentirati i djecu koja nisu upisana u IMH ili IDSS (samo za broj djece, bez računa). |
| 1.17 | Pravni osnov: Program sufinansiranja KS 2026/2027 („Službene novine KS“ 16/26) i Pravilnik o formiranju cijena P.P.U. IMH | vodič 3+ | 🟡 | Navodi se u modulu subvencije (**F5**), kao izvor svakog iznosa (M-4). |
| 1.18 | Numeracija `NNN/GG`, storno `KO-NNN/GG`, serija `-B` | `nextNo` | ✅ | Nova numeracija `IMH-NNN/GG` (BR-23, odluka Direktora); stari brojevi se uvoze kako su napisani; `IMH-KO-…`/`IDSS-KO-…` (S1). |
| 1.19 | Rok plaćanja: 5. u mjesecu, ili datum računa + 5 dana | `dueFor` | 🟡 | Tauri: 5. u mjesecu (BR-11). Varijantu „+5 dana kad je 5. već prošao“ **uskladiti** → **F1**. |
| 1.20 | Opis stavke: „Školarina za {mjesec} – školska GGGG/GG“ | `period` | ✅ | Opis stavke u Tauriju. |

## 2. Štampani račun (PDF) — računovodstveni sadržaj

| # | Stavka u dokumentu | Tauri | Napomena |
|---|---|---|---|
| 2.1 | Kolone: R.br., naziv, **količina, cijena, rabat %, s rabatom, PDV %, PDV iznos, iznos bez PDV** | ❌ | Tauri ima samo „Po cjenovniku“ i „Iznos“ → **F1**. |
| 2.2 | Rekapitulacija: **Prodajna vrijednost, Iznos odobrenog rabata, Vrijednost bez PDV, Iznos PDV (0 %), UKUPNO ZA UPLATU** | ❌ | → **F1**. Svi iznosi iz jedne funkcije u feninzima (BR-8): prodajna = Σ po cjenovniku, rabat = prodajna − ukupno. |
| 2.3 | **Napomena o oslobađanju od PDV-a:** „PPU nije obveznik PDV-a, u skladu sa članom 24. stav 1. tačka 4. Zakona o PDV.“ | 🟡 | Tauri: tekst se unosi po ustanovi (migracija 006), a nema početnog teksta → **F1**: za IMH početni tekst iz dokumenta. Dokument isti tekst štampa i za **IDSS**, ali IDSS nije „PPU“ → vidi §5. |
| 2.4 | Mjesto izdavanja: Sarajevo; Način plaćanja: Virman / Nalog za plaćanje | ❌ | → **F1** (mjesto iz adrese ustanove). |
| 2.5 | Iznos slovima | ✅ | — |
| 2.6 | „Fakturisao/la“, **M.P.**, **Ovlašteno lice**, potpis | 🟡 | Tauri ima samo „Fakturisao/la“ → **F1**. |
| 2.7 | **Code 39 barkod** s brojem računa | ❌ | → **F1** (vektorski, bez nove zavisnosti). |
| 2.8 | Nalog za uplatu (uplatnica): uplatio, svrha, primalac, račun, iznos, rok, poziv na broj, potpis, pečat banke | ✅ | DL-P008. Tauri dodatno štampa iznos koji je još otvoren. |
| 2.9 | QR za plaćanje: EPC `BCD/002/SCT`, valuta BAM, poziv na broj = broj računa, svrha ≤ 140 znakova | ✅ | Isti format (DL-P008, privremeni dok banka ne potvrdi). |
| 2.10 | Knjižno odobrenje s vezom na račun | ✅ | Storno S1–S6 (DL-P011). |

## 3. Funkcije i ekrani

| # | Funkcija u dokumentu | Tauri | Napomena |
|---|---|---|---|
| 3.1 | **Kontrolni panel:** aktivni upisi i porodice po ustanovi, neplaćeni računi, ukupan dug, djelimično plaćeni, grafikon statusa po mjesecu | ❌ | BR-29 (Sprint 04) → **F3**. |
| 3.2 | Lista računa, filteri (ustanova, mjesec, status), detalj | ✅ | — |
| 3.3 | **Novi račun (ručni):** stavke iz cjenovnika, količina, rabat, brzo dodavanje porodice ili djeteta | ❌ | → **F2** (ljetna škola, stipendija i naknadne stavke se danas ne mogu fakturisati). |
| 3.4 | Mjesečni obračun (prijedlog → potvrda → izdavanje) | ✅ | BR-26. |
| 3.5 | Porodice i djeca | ✅ | — |
| 3.6 | **Kalkulator Porodice 3+** i obračun subvencije | ❌ | → **F5**. |
| 3.7 | Pregled cjenovnika | ✅ | — |
| 3.8 | Uplate: plaćeno, djelimično, preplaćeno | ✅ | Plus storno uplate i kredit (S3, S4). |
| 3.9 | Storno | ✅ | DL-P011. |
| 3.10 | Slanje računa e-poštom (predmet „Račun br. … — ustanova (dijete)“) | ✅ | BR-28 / DL-P006: nacrt u Outlooku prema sandučetu ustanove, po odluci Direktora. |
| 3.11 | **Izvoz u Excel** (listovi DB, Setting, Porodice; u verziji 1.2 i dnevnik i verzija) | ❌ | → **F4**: knjigovođi treba cijela evidencija u Excelu. |
| 3.12 | Uvoz iz starog Excela, izolacija duplikata, izvještaj o konfliktima | ✅ | Dijagnostika uvoza (31 kategorija). |
| 3.13 | Sigurnosne kopije u folder, vraćanje iz kopije | ✅ | Šifrovano (DL-P004); u dokumentu nešifrovani JSON. |
| 3.14 | Svijetla i tamna tema | ✅ | — |
| 3.15 | Dnevnik promjena | 🟡 | Tauri bilježi sve (BR-30), ali **pregled** dnevnika ne postoji → **F3**. |

## 4. Namjerno se ne preuzima

| # | Stavka | Razlog |
|---|---|---|
| 4.1 | Modul „Pravna dokumentacija“: uslovi korištenja, privatnost, povrat, **pretplata**, **kolačići** | To su opšti šabloni web servisa s praznim poljima (`[VERZIJA]`, `[DATUM STUPANJA NA SNAGU]`) i bez veze s ovom aplikacijom: nema pretplate, kolačića ni web pristupa. Pravila naplate, povrata i ispisa su u ustavu (BR-13–BR-15). |
| 4.2 | Dugme „Preuzmi samostalni HTML“ | Izvozilo je podatke djece u nešifrovan fajl. Uklonjeno već u verziji 1.2 (BR-22). |
| 4.3 | Baza u pregledniku (IndexedDB) i nešifrovane JSON kopije | Zamijenjeno šifrovanom bazom (Zakon čl. 53h, DL-P004). |
| 4.4 | Poredak djece po redoslijedu unosa | Tauri ih poreda po datumu rođenja (BR-6). Isto pravilo, ali bez mogućnosti greške pri unosu. |

## 5. Otvoreno (provjera, ne nova pravila)

| # | Pitanje | Zašto |
|---|---|---|
| 5.1 | Tekst o PDV-u za **IDSS** | Dokument isti tekst („PPU nije obveznik PDV-a … čl. 24. st. 1. t. 4.“) štampa i na IDSS računima, ali IDSS je **P.U.**, ne „PPU“. Za IMH se tekst preuzima iz dokumenta; za IDSS tačan tekst potvrđuje knjigovođa. |

---

## Plan ugradnje (Commander: SPEC → PLAN → TASKS za svaku funkciju)

| Redoslijed | Funkcija | Stavke | Zašto tim redom |
|---|---|---|---|
| **F1** | Računovodstveno potpun PDF računa | 2.1–2.4, 2.6, 2.7, 1.19 | Svaki račun izdat od puštanja u rad mora biti potpun dokument. |
| **F2** | Ručni račun | 3.3 | Bez njega se ne mogu fakturisati ljetna škola, stipendije ni naknadne stavke. |
| **F3** | Kontrolni panel i pregled dnevnika | 3.1, 3.15 | BR-29, BR-30. |
| **F4** | Izvoz cijele evidencije u Excel | 3.11 | Usklađivanje s knjigovođom. |
| **F5** | Porodice 3+ i ciklus subvencije Ministarstva | 1.7–1.17, 3.6 | Najveća funkcija (BR-16–BR-18). Gradi se na F1–F4. |
