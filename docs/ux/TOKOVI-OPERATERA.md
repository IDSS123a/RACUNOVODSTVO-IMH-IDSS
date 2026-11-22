# Tokovi operatera — revizija (2026-11-21)

*Zahtjev Direktora:*
- maksimalno smanjiti rad operatera, a povećati sigurnost, efikasnost, jednostavnost i pouzdanost;
- gdje god je moguće, automatski unos: sistem predlaže, operater odobrava.

Za svaki tok je navedeno: koraci prije, koraci sada, i šta još predlažem.

## 1. Nova porodica i dijete (usred godine)
**Prije:** Nova porodica → spremi → „Dodaj dijete“ → spremi → „Upis“ → spremi → (IDSS) „Plan plaćanja“ → broj rata → spremi. Bez plana mjesečni obračun samo javlja grešku.

**Sada (DL-P018):**
1. Nova porodica → spremi: karta porodice se otvara **s formom prvog djeteta** (prezime je predloženo).
2. Spremi dijete: **odmah se otvara upis** (školska godina i početak su predloženi).
3. Spremi upis u IDSS: **odmah se otvara predloženi plan plaćanja**. Sistem predlaže 10 rata (septembar–juni) po cjenovniku, s popustom za brata ili sestru, ili manje ako odbor odredi raniji rok posljednje rate. Operater samo klikne „Sačuvaj plan“.
4. Sve vrijednosti su u kanonskom formatu (DL-P017).

## 2. Puštanje u rad (uvoz iz Excela)
1. Uvoz → „Za provjeru“ (nalazi uvoza).
2. Porodice → **„Upis djece bez upisa“**: jedna tabela za svu uvezenu djecu. Ustanova je predložena iz posljednjeg računa; program i datum rođenja unosi operater, jer ih stari Excel nema.
3. Računi → Mjesečni računi: za svakog učenika IDSS bez plana sistem **predlaže plan**, a operater ga odobrava jednim klikom („Prihvati predložene planove“). Pregled se zatim sam osvježi.

## 3. Mjesečni obračun
- Sistem predlaže **jedan račun po djetetu sa svim troškovima** (DL-P014).
- Operater kvačicama bira stavke, a usluge van cjenovnika dodaje preko šablona (DL-P015).
- Djeca bez upisa i bez plana su navedena; ništa se ne preskače prešutno.

## 4. Uplata po izvodu
**Sada:**
- Računi → **pretraga** po broju, djetetu ili kupcu (DL-P017) → klik na račun.
- Iznos je predložen (preostalo), uplatilac je predložen (kupac), datum je današnji.
- Referenca i svrha uplate idu preko šablona; svrha je predložena iz perioda računa.

**Predlažem (sljedeći korak):** uvoz bankovnog izvoda, tako da sistem po pozivu na broj (broj računa u svrsi) sam predloži koji račun je plaćen, a operater samo potvrdi. To je najveća ušteda vremena koja je preostala.

## 5. Brisanje i ispravke
- **Sada:** sve što je pogrešno uneseno, a još nije fakturisano (porodica, dijete, upis), briše se **uz potvrdu**, u jednom koraku (DL-P018).
- Ono što je fakturisano nikad se ne briše: sistem kaže koji račun to sprječava. Ispravka ide kroz knjižno odobrenje i storno uplate (DL-P011), a dijete se ispisuje.

## 6. Ostali prijedlozi za automatizaciju (čekaju odobrenje)
| # | Prijedlog | Korist |
|---|---|---|
| A | Status upisa „Čeka upisne uplate“ → „Aktivan“ **automatski** kad je račun s upisnim troškovima plaćen (uz obavijest operateru) | operater ne mijenja status ručno |
| B | Na početku nove školske godine sistem **predloži upise** svima koji nastavljaju (isti program ili sljedeći razred), operater odobrava tabelom | stotine upisa jednim pregledom |
| C | Uvoz bankovnog izvoda s prijedlogom uparivanja uplata (tok 4) | najveća ušteda kod uplata |
| D | Podsjetnik na dospjele neplaćene račune (lista za slanje opomena) iz kontrolnog panela | naplata |

## 7. Kako to rješavaju najbolje aplikacije (istraživanje, 2026-11-21)
| Uzor | Rješenje | Šta preuzimamo |
|---|---|---|
| Brightwheel, Procare (naplata vrtića i škola) | **Plan naplate se postavi jednom pri upisu**; troškovi se dalje knjiže sami svakog mjeseca; popusti za braću i sestre su automatski; svaka porodica ima **karticu (ledger)**: zaduženja, uplate, saldo | Upis = jedini unos; sve ostalo računa sistem; kartica porodice sa saldom |
| Xero (repeating invoices) | Nacrti računa se prave sami; operater ih **pregleda i odobri skupno**; slabost: izmjena jednog po jednog | Mjesečni obračun kao skupno odobravanje (već imamo); izuzeci se rješavaju na jednom mjestu |
| QuickBooks (bank feed) | Uplata iz izvoda se **sama upari** s računom; operater samo potvrdi prijedlog; ručno traženje samo kad nema prijedloga | Uvoz izvoda s prijedlogom uparivanja (prijedlog C) |

**Zaključak:** u najboljim aplikacijama operater ne pravi račune. Unosi **upis** (jednom), **odobrava** mjesečni obračun (jednim pregledom) i **potvrđuje** uparene uplate. Ručni račun je rijedak izuzetak.

## 8. Prijedlog pojednostavljenja (čeka odobrenje Direktora)
1. **„Novi upis“: jedan formular u obliku tabele** (porodica → dijete → program → početak). Spremanje odjednom:
   - pravi dijete i upis;
   - za IDSS pravi predloženi plan;
   - nudi **račun za upis** (upisnina, materijal, depozit) jednim klikom.

   Nema više posebnih koraka.
2. **Glavni meni po poslovima, ne po tabelama:** Kontrolni panel · Novi upis · Mjesečni obračun · Uplate · Računi · Porodice · Postavke.
3. **Kartica porodice** kao kod Procare/Brightwheel: sva djeca, upisi, računi, uplate i **saldo** na jednom ekranu, s dugmadima „Uplata“ i „Storno“ uz svaki račun.
4. **Uplate iz izvoda** (C): sistem upari, operater potvrdi.
5. „Novi račun“ ostaje samo za izuzetke. Sistem sam prepoznaje slučaj: mjesečni račun, račun za upis unaprijed ili privremena usluga za dijete koje nije upisano.
