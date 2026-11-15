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

Fertig. Die alte *Realtime Database* bleibt unverändert bestehen, bis du die
alte Liste übernommen hast (siehe unten).

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

### Schritt 5: Alte Liste übernehmen (einmalig)

Auf der Seite mit deinem Namen anmelden → oben rechts auf **👤 Name** →
**Alte gemeinsame Liste → Übernehmen**. Alle Filme der ersten Version landen
auf deiner persönlichen Liste (gesehene als gesehen) und damit in jeder
Gruppe, in der du bist. Danach kannst du die Realtime Database in der
Firebase-Konsole löschen, wenn du willst.

## Bedienung

**Anmelden:** Namen eingeben. Gibt es den Namen schon, bist du angemeldet;
sonst fragt die Seite, ob ein neues Profil angelegt werden soll. Das Gerät
merkt sich das. Profil wechseln: **👤 Name → Profil wechseln**.

**Meine Liste:** Tabs *Watchlist* und *Gesehen*.
- Film hinzufügen: Titel eintippen (deutsch, englisch oder original), Treffer
  antippen. Genre, Länge, Jahr, FSK, Poster und Trailer kommen von TMDB.
- **✓ Gesehen** verschiebt einen Film zu *Gesehen*; dort holt
  **↩ Nochmals schauen** ihn zurück. **🗑** entfernt ihn.

**Gruppen:** oben **＋ Gruppe** → neue Gruppe erstellen oder mit Code beitreten.
- **📨 Einladen** zeigt Code und Link (auf dem Handy direkt teilbar). Wer den
  Link öffnet, meldet sich an und wird gefragt, ob er beitreten will.
- *Gemeinsame Liste* = alle Filme auf den Watchlists der Mitglieder. Jede
  Karte zeigt **Will sehen:** und **Gesehen:**. Mit **☆/★ Meine Liste** und
  **👁 Gesehen?** änderst du deinen eigenen Stand direkt hier.
- Filter *Nicht gesehen von* (Personen antippen, z.B. alle, die heute dabei
  sind) und *Gesehen von höchstens* (niemandem / 1 Person / 2 Personen …).
  Sortierung zusätzlich nach *Meistgewünscht*.
- **Verlassen** nimmt dich aus der Gruppe; deine Liste bleibt erhalten.

**Abstimmung** (Tab in der Gruppe; 🗳 an der Gruppe zeigt, dass eine läuft,
🔴 dass du noch etwas tun musst):
1. **Neue Abstimmung starten:** Titel, Abstimmungsart, Nominierungen pro
   Person (1–5) und optional Bedingungen:
   Länge höchstens · FSK höchstens · Genres · *schon gesehen*: egal / von
   niemandem / von höchstens N Personen / nicht von bestimmten Leuten.
   Die Seite zeigt sofort, wie viele Filme der Liste passen.
2. **Nominieren:** Jede Person nominiert passende Filme aus der Liste (eigene
   Nominierungen lassen sich zurückziehen). Danach **Weiter zur Abstimmung**
   (ab 2 nominierten Filmen).
3. **Abstimmen**, je nach Art:
   - *Zustimmung*: alle Filme anhaken, die okay sind – meiste Häkchen gewinnt.
   - *Eine Stimme*: genau einen Film wählen.
   - *Rangfolge*: Platz 1, 2, 3 antippen (3, 2, 1 Punkte).
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
