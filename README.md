# 🎬 Filmabend – Watchlists & Abstimmungen

Statische Website (GitHub Pages) für den Filmabend:

- **Profile** wie beim Essensplan: Anmeldung nur mit dem Namen, kein Passwort.
- **Persönliche Watchlist** und **gesehene Filme** für jede Person.
- **Gruppen** (geteilte Listen): enthalten automatisch alle Filme auf den
  persönlichen Listen der Mitglieder – mit *wer will ihn sehen* und *wer hat
  ihn schon gesehen*. Beitreten per Einladungslink oder 6-stelligem Code.
- **Filter** nach Genre, Länge, Jahrzehnt – in Gruppen zusätzlich
  *nicht gesehen von …* und *gesehen von höchstens N Personen*.
- **Abstimmungen** pro Gruppe: Bedingungen (Länge, FSK, Genre, schon gesehen),
  Nominieren, Abstimmen (Zustimmung, eine Stimme oder Rangfolge), Ergebnis.
- Klick auf einen Film öffnet den **Trailer** (bevorzugt in Originalsprache).

Filmdaten kommen von TMDB, alles andere liegt in **Firebase Firestore** und
ist auf allen Geräten live synchron. Kein Backend, kein Blaze-Plan nötig –
der kostenlose Spark-Plan reicht.

## Projektstruktur

```
filmabend/
├── docs/                      # die Website – wird von GitHub Pages ausgeliefert
│   ├── index.html             # Seitenaufbau
│   ├── style.css              # Design
│   ├── app.js                 # Oberfläche (Listen, Gruppen, Abstimmungen)
│   ├── logic.js               # Filter, Gruppenliste, Bedingungen, Auszählung
│   ├── db.js                  # Firestore: Profile, Listen, Gruppen, Abstimmungen
│   ├── tmdb.js                # Filmsuche, Details, FSK und Trailer von TMDB
│   ├── config.js              # ★ Schlüssel (TMDB + Firebase) ★
│   └── .nojekyll
├── firestore.rules            # ★ Datenbank-Regeln – in die Firebase-Konsole kopieren ★
├── .github/workflows/
│   └── deploy.yml             # veröffentlicht docs/ auf GitHub Pages
├── run.py                     # lokale Vorschau (python run.py)
└── README.md
```

## Einrichtung

### Schritt 1: TMDB-API-Key — ✅ schon erledigt

Steht bereits in `docs/config.js` (`tmdbApiKey`). Für ein neues Projekt:
Konto auf <https://www.themoviedb.org/signup>, dann unter
<https://www.themoviedb.org/settings/api> einen Key anfordern und eintragen.

### Schritt 2: Firestore im bestehenden Firebase-Projekt einrichten (einmalig, ~5 Minuten)

Die Werte in `docs/config.js` (Projekt `watchlist-fe32e`) bleiben gleich –
es kommen nur zwei Dienste dazu.

**2a. Projekt öffnen**
<https://console.firebase.google.com> → Projekt **watchlist-fe32e** anklicken.

**2b. Firestore-Datenbank anlegen**
1. Links im Menü **Build / Erstellen → Firestore Database** (nicht
   „Realtime Database“) → **Datenbank erstellen**.
2. Edition: **Standard** (falls gefragt) → Datenbank-ID `(default)` lassen.
3. Standort: **`europe-west6` (Zürich)** → Weiter.
   ⚠️ Der Standort lässt sich später nicht ändern.
4. **Im Produktionsmodus starten** → **Erstellen**.

**2c. Anonyme Anmeldung einschalten** (wie beim Essensplan)
1. Links **Build / Erstellen → Authentication → Jetzt starten**.
2. Tab **Sign-in method / Anmeldemethode** → **Anonym** → aktivieren → **Speichern**.
3. Im selben Bereich Tab **Einstellungen → Autorisierte Domains** →
   **Domain hinzufügen** → `dummisa.github.io` → Hinzufügen.

   Das ist nur eine technische Kennung pro Gerät; angemeldet wird man auf der
   Seite trotzdem einfach mit dem Namen.

**2d. Regeln veröffentlichen**
1. **Firestore Database → Tab Regeln**.
2. Alles im Textfeld löschen, den kompletten Inhalt der Datei
   **`firestore.rules`** (aus diesem Projekt) einfügen → **Veröffentlichen**.

**Wichtig bei Updates:** Ändert sich `firestore.rules`, die Regeln immer
*zuerst* neu veröffentlichen und erst dann die Website pushen.

Fertig. Die alte *Realtime Database* der ersten Version wird nicht mehr
gebraucht und kann in der Firebase-Konsole gelöscht werden.

### Schritt 3: Lokal ausprobieren (Positron)

1. Projektordner `filmabend` in Positron öffnen (**File → Open Folder**).
2. Terminal (**Terminal → New Terminal**):

   ```
   python run.py
   ```

   Der Browser öffnet <http://localhost:8000/>. Im Terminal steht, ob die
   Schlüssel erkannt wurden. Beenden mit `Ctrl+C`.

### Schritt 4: Veröffentlichen

Im Positron-Terminal (oder über die Source-Control-Ansicht):

```
git add -A
git commit -m "Profile, Gruppen und Abstimmungen"
git push
```

Nach ein bis zwei Minuten ist die neue Version unter
**<https://dummisa.github.io/filmabend/>** online (GitHub Actions →
„Deploy to GitHub Pages“).

## Bedienung

**Anmelden:** Namen eingeben. Gibt es den Namen schon, bist du angemeldet;
sonst fragt die Seite, ob ein neues Profil angelegt werden soll. Das Gerät
merkt sich das. Profil wechseln: **👤 Name → Profil wechseln**.

**Meine Liste:** Tabs *Watchlist* (privat) und *Gesehen*. Bei gesehenen Filmen
setzt **🔁 Rewatch** den Film wieder auf die Watchlist (auf Wunsch auch in
Gruppen) – er bleibt dabei unter *Gesehen* und ist mit „🔁 Rewatch“ markiert.
In Gruppen steht dann „🔁 Name“ bei *Will sehen*.

**Filme und Serien:** Die Suche findet beides (Serien mit 📺). Serien zeigen
Staffeln, Folgen und Folgenlänge; „gesehen“ gilt für die ganze Serie. Jede
Gruppe hat eine Art – *Nur Filme* (Standard, auch für bestehende Gruppen),
*Nur Serien* oder *Gemischt* – wählbar beim Erstellen und über ✏️. Serien
landen nur in Gruppen, die Serien erlauben. Sind Filme und Serien gemischt,
erscheint der Filter *Art*. Der Längenfilter und die Längen-Bedingung gelten
nur für Filme; in gemischten Gruppen kann eine Abstimmung auf Filme oder
Serien beschränkt werden. Fortsetzungen werden nur für Filme angeboten.

**Film hinzufügen:** Titel eintippen, Treffer antippen. Bist du in Gruppen,
fragt die Seite, **auf welche Listen** er soll: deine private Liste und/oder
einzelne Gruppen. Aus *Meine Liste* heraus ist alles vorausgewählt, in einer
Gruppe die private Liste und diese Gruppe. So kann ein Film z.B. nur in der
Gruppe mit den Leuten landen, mit denen du ihn schauen willst.

**Entfernen von der privaten Liste (🗑):** Die Seite fragt, aus welchen
Gruppen er ebenfalls verschwinden soll (wollen ihn dort andere auch sehen,
bleibt er für sie drin).

**Gruppen:** oben **＋ Gruppe** → neue Gruppe erstellen oder mit Code beitreten.
Beim Erstellen/Beitreten fragt die Seite, ob deine ganze Watchlist in die
Gruppe soll – oder du fügst später einzelne Filme hinzu. Beim Beitreten fragt
sie zusätzlich, ob die Filme der Gruppe auf deine private Liste sollen; sonst
holst du dir einzelne mit **＋ Meine Liste** auf der Filmkarte.
- **📨 Einladen** zeigt Code und Link (auf dem Handy direkt teilbar).
- Jede Karte zeigt **Will sehen:** und **Gesehen:**.
  - **🙋 Ich auch** – du willst ihn in dieser Gruppe auch sehen (nochmals tippen nimmt es zurück).
  - **＋ Meine Liste** – setzt ihn auf deine private Liste (erscheint nur, wenn er noch nicht drauf ist).
  - **✕** – nimmt den Film für alle aus dieser Gruppe; private Listen bleiben unverändert.
- Filter *Nicht gesehen von* und *Gesehen von höchstens*; Sortierung *Meistgewünscht*.

**Gesehen markieren:** Ist der Film in Gruppenlisten, fragt die Seite,
**mit welcher Gruppe** du ihn geschaut hast (in einer Gruppe ist diese
vorausgewählt; nichts ankreuzen = allein geschaut). In den gewählten Gruppen
wird er von der gemeinsamen Liste genommen. Alle anderen dort, die ihn
wollten, werden beim nächsten Öffnen der Seite gefragt:
*„Ich war dabei“* (→ gesehen) · *behalten* (→ bleibt bzw. kommt auf die private
Liste, nur nicht mehr in der Gruppe – z.B. wenn jemand nicht dabei war) ·
*entfernen*. Wer einen Film als *Rewatch* auf der Liste hat, wird ebenfalls gefragt.

**Fortsetzungen:** Gehört ein gesehener Film zu einer Filmreihe (laut TMDB),
fragt die Seite, ob der nächste Teil auf die Liste soll – die Gruppe, mit der
du ihn geschaut hast, ist dabei vorausgewählt. Auch angekündigte Teile werden
angeboten (mit Erscheinungsdatum).

**Gruppe → Gesehen:** zeigt alle Filme, die als „mit dieser Gruppe gesehen“
markiert wurden, mit Datum, wer es eingetragen hat und wer ihn gesehen hat.
**✕** entfernt einen Eintrag aus diesem Verlauf.

**Abstimmung** (Tab in der Gruppe; 🗳 an der Gruppe zeigt, dass eine läuft,
🔴 dass du noch etwas tun musst):
1. **Neue Abstimmung starten:** Titel, Abstimmungsart, Nominierungen pro
   Person (1–5, eine eigene Zahl oder **∞ Unbegrenzt**) und optional Bedingungen:
   Länge höchstens · FSK höchstens · Genres · *schon gesehen*: egal / von
   niemandem / von höchstens N Personen / nicht von bestimmten Leuten.
   Die Seite zeigt sofort, wie viele Filme der Liste passen.
   Optional ein **Zeitplan**: *Nominieren bis* (dann startet die Abstimmung
   automatisch, sofern mind. 2 Titel nominiert sind) und *Abstimmung endet*
   (dann wird automatisch ausgezählt). Die Abstimmung zeigt einen Countdown.
   Weitergeschaltet wird vom ersten Gerät, das die Seite nach Ablauf offen hat.
2. **Nominieren:** Jede Person nominiert passende Filme aus der Liste (eigene
   Nominierungen lassen sich zurückziehen). Danach **Weiter zur Abstimmung**
   (ab 2 nominierten Filmen).
3. **Abstimmen**, je nach Art:
   - *Zustimmung*: alle Filme anhaken, die okay sind – meiste Häkchen gewinnt.
   - *Eine Stimme*: genau einen Film wählen.
   - *Rangfolge*: Filme der Reihe nach antippen – sie wandern nach oben in
     „Deine Rangliste“, mit ▲▼ umsortierbar, ✕ nimmt sie wieder heraus. Die
     Anzahl Plätze legt die Abstimmung fest (3, 5, eigene Zahl oder alle
     Nominierten); Platz 1 bekommt so viele Punkte, wie es Plätze gibt.
   Man sieht, wer schon abgestimmt hat, aber nicht wofür.
4. **Auszählen & beenden:** Gewinner mit Trailer-Button und Punkte-Balken.
   Bei Gleichstand entscheidet das Los. Frühere Abstimmungen bleiben als
   Verlauf sichtbar.

Jedes Mitglied kann eine Abstimmung weiterschalten, auszählen oder löschen.

## Hinweise

- **Datenschutz/Sicherheit wie beim Essensplan:** Wer die Seite kennt, kann
  sich mit jedem vorhandenen Namen anmelden – gedacht für Freunde, nicht für
  Geheimes. Gruppen erscheinen nur bei ihren Mitgliedern; beitreten geht nur mit Code/Link.
- **FSK:** Altersfreigabe aus Deutschland (sonst Schweiz) laut TMDB. Ältere
  Filme bekommen sie automatisch nachgetragen. Filme ohne FSK-Angabe zählen
  bei einer FSK-Bedingung nicht als passend.
- **Kosten:** Der kostenlose Spark-Plan reicht (50 000 Lesezugriffe/Tag).
- Sprache für Beschreibung und Genres: `language` in `docs/config.js`.
  Titel werden immer im Original gezeigt (bei nicht deutsch-/englischsprachigen
  Filmen mit englischem Titel darunter).
- Dieses Produkt verwendet die TMDB-API, ist aber nicht von TMDB unterstützt
  oder zertifiziert.
