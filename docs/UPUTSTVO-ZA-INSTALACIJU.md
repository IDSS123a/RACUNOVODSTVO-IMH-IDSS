# Uputstvo za instalaciju — Fakturisanje IMH & IDSS

Aplikacija se instalira **samo na računar finansijsko-administrativnog menadžera**. Svi podaci ostaju na tom računaru, šifrovani. Nema prijave i nema interneta.

## 1. Instalacija (jednom)
1. Kopirajte instalacioni fajl `Fakturisanje IMH IDSS_x.y.z_x64-setup.exe` na računar (USB ili mrežni disk).
2. Pokrenite ga dvostrukim klikom. Instalaciju radite pod **svojim Windows nalogom**, jer je ključ baze vezan za taj nalog.
3. Windows može prikazati upozorenje „Windows je zaštitio vaš računar“, jer instaler još nije digitalno potpisan. Kliknite **Više informacija → Ipak pokreni**.
4. Na kraju instalacije pokrenite aplikaciju iz Start menija: **Fakturisanje IMH IDSS**.

## 2. Prvo pokretanje
1. Aplikacija prikazuje **ključ za oporavak**.
   - **Odštampajte ga** i predajte direktoru na čuvanje (sef). Ne šaljite ga emailom ni porukom.
   - Ključ se prikazuje samo jednom. Bez njega se rezervna kopija ne može otvoriti na drugom računaru.
2. Označite „Ključ je odštampan…“ i kliknite **Nastavi**.
3. Unesite svoje ime, funkciju, email i telefon. Ime se štampa kao „Fakturisao/la“ na računima.

## 3. Prije prvog računa (jednom)
1. **Postavke → Ustanove (IMH i IDSS):** provjerite podatke iz memoranduma i bankovni račun. U polje **„Napomena na računu“** unesite tačan tekst koji ustanova želi na računu (npr. PDV napomena), ako ga treba.
2. **Postavke → Pravila naplate — odluke Školskog odbora IDSS:** za školsku godinu unesite broj i datum odluke, rok posljednje rate (ako je odlučen) i mjesece naplate doručka.
3. **Outlook:** u **Računi → Izvoz i slanje** kliknite „Outlook nacrt“ za jedan račun i provjerite da se otvara **nacrt koji se može uređivati**, s prilozima. Ako se otvara drugi program ili poruka bez dugmeta „Pošalji“, javite direktoru (vjerovatno je instaliran „novi Outlook“).
4. **QR kod na uplatnici:** jednom ga skenirajte u aplikaciji banke (bez potvrde uplate) i provjerite primaoca, IBAN i iznos.

## 4. Rezervne kopije (obavezno)
1. **Postavke → Rezervne kopije → Odaberi folder.** Odaberite mrežni disk ili OneDrive, nikako isti disk na kojem je Windows.
2. Na kraju svakog radnog dana kliknite **Napravi rezervnu kopiju**.
3. Kopije su šifrovane (`.fkbak`). Bez aplikacije i ključa ih niko ne može pročitati.

## 5. Ako računar otkaže
1. Instalirajte aplikaciju na novi računar.
2. U **Postavke → Rezervne kopije → Vrati iz rezervne kopije** odaberite posljednju kopiju.
3. Upišite **ključ za oporavak** iz sefa.

## 6. Šta aplikacija ne radi
- Ne šalje podatke na internet i nema „oblaka“.
- Ne može se otvoriti na drugom Windows nalogu bez ključa za oporavak.
