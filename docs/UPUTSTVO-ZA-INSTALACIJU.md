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

## 3. Rezervne kopije (obavezno)
1. **Postavke → Rezervne kopije → Odaberi folder.** Odaberite mrežni disk ili OneDrive, nikako isti disk na kojem je Windows.
2. Na kraju svakog radnog dana kliknite **Napravi rezervnu kopiju**.
3. Kopije su šifrovane (`.fkbak`). Bez aplikacije i ključa ih niko ne može pročitati.

## 4. Ako računar otkaže
1. Instalirajte aplikaciju na novi računar.
2. U **Postavke → Rezervne kopije → Vrati iz rezervne kopije** odaberite posljednju kopiju.
3. Upišite **ključ za oporavak** iz sefa.

## 5. Šta aplikacija ne radi
- Ne šalje podatke na internet i nema „oblaka“.
- Ne može se otvoriti na drugom Windows nalogu bez ključa za oporavak.
