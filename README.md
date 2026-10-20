# 🎬 Filmabend – gemeinsame Watchlist

Statische Website (GitHub Pages) für den Filmabend: Jeder kann Filme auf
die Watchlist setzen, die Liste lässt sich nach **Genre, Länge und
Erscheinungsjahr** filtern, und ein Klick auf einen Film öffnet den
**Trailer**. Filminfos kommen automatisch von TMDB (The Movie Database),
die Liste selbst liegt in einer Firebase Realtime Database – damit sehen
alle dieselbe Liste, live, auf jedem Gerät.

Aufbau wie beim TOTO-Dashboard: Website im Ordner `docs/`, Deployment über
GitHub Actions, `run.py` zum lokalen Ausprobieren.

## Projektstruktur

```
filmabend/
├── docs/                      # die Website – wird von GitHub Pages ausgeliefert
│   ├── index.html             # Seitenaufbau
│   ├── style.css              # Design (dunkles Dashboard wie TOTO/Poker)
│   ├── app.js                 # Oberfläche, Filter, Sortierung, Zufallsfilm
│   ├── tmdb.js                # Filmsuche, Details und Trailer von TMDB
│   ├── store.js               # Speicherung: Firebase (geteilt) oder localStorage
│   ├── config.js              # ★ HIER kommen die Schlüssel rein ★
│   └── .nojekyll
├── .github/workflows/
│   └── deploy.yml             # veröffentlicht docs/ auf GitHub Pages
├── run.py                     # lokale Vorschau (python run.py)
├── .gitignore
└── README.md
```

## Einrichtung – was du noch eintragen musst

Alle Schlüssel gehören in **`docs/config.js`**. Die Seite läuft auch ohne
sie (dann ohne Filmsuche bzw. nur mit lokaler Liste) und sagt dir oben im
Banner, was noch fehlt.

### Schritt 1: TMDB-API-Key (Filmdaten, Poster, Trailer)

1. Kostenloses Konto auf <https://www.themoviedb.org/signup> anlegen.
2. <https://www.themoviedb.org/settings/api> öffnen → **Request an API Key**
   → Typ *Developer* → Formular ausfüllen
   (Anwendungsname: `Filmabend`, URL: `https://dummisa.github.io/filmabend/`,
   Zweck: private Watchlist für Freunde).
3. Auf der API-Seite steht danach ein **API Key** (32 Zeichen) und ein
   **API Read Access Token** (beginnt mit `eyJ…`). Einen davon kopieren und
   in `docs/config.js` eintragen:

   ```js
   tmdbApiKey: 'HIER_DEN_KEY_EINFUEGEN',
   ```

Der Key darf in der Website sichtbar sein – er kann nur öffentliche
Filmdaten lesen.

### Schritt 2: Firebase (geteilte Liste für alle)

1. <https://console.firebase.google.com> → **Projekt hinzufügen** → Name
   `filmabend` → Google Analytics kann aus bleiben → **Projekt erstellen**.
2. Links im Menü **Build / Erstellen → Realtime Database → Datenbank erstellen**
   → Standort `Belgium (europe-west1)` → **Im Sperrmodus starten** → Aktivieren.
3. In der Datenbank auf den Tab **Regeln** wechseln, den Inhalt durch
   Folgendes ersetzen und **Veröffentlichen** klicken:

   ```json
   {
     "rules": {
       "watchlist": {
         ".read": true,
         ".write": true,
         "$movieId": {
           ".validate": "newData.hasChildren(['id', 'title'])"
         }
       }
     }
   }
   ```

   (Jeder, der die Seite kennt, darf die Liste lesen und ändern – für eine
   Freundesgruppe genau richtig. Alles ausserhalb von `watchlist` bleibt gesperrt.)

4. Oben auf der Datenbank-Seite steht die **Datenbank-URL**, z.B.
   `https://filmabend-a1b2c-default-rtdb.europe-west1.firebasedatabase.app`
   – die brauchst du gleich.
5. Zurück zur **Projektübersicht** → **Web-App hinzufügen** (Symbol `</>`)
   → Name `filmabend` → Firebase Hosting *nicht* nötig → **App registrieren**.
   Es erscheint ein Block `const firebaseConfig = { … }`.
6. Die Werte daraus in `docs/config.js` in den Block `firebase: { … }`
   übertragen. **Wichtig:** `databaseURL` ist im angezeigten Block manchmal
   nicht dabei – dann die URL aus Punkt 4 eintragen. Beispiel:

   ```js
   firebase: {
     apiKey: 'AIza…',
     authDomain: 'filmabend-a1b2c.firebaseapp.com',
     databaseURL: 'https://filmabend-a1b2c-default-rtdb.europe-west1.firebasedatabase.app',
     projectId: 'filmabend-a1b2c',
     storageBucket: 'filmabend-a1b2c.firebasestorage.app',
     messagingSenderId: '123456789012',
     appId: '1:123456789012:web:abcdef123456'
   }
   ```

Die Firebase-Web-Konfiguration ist öffentlich gedacht – der Schutz der
Datenbank läuft über die Regeln aus Punkt 3, nicht über Geheimhaltung.

### Schritt 3: Lokal ausprobieren (Positron)

1. Projektordner `filmabend` in Positron öffnen (**File → Open Folder**).
2. Terminal öffnen (**Terminal → New Terminal**) und starten:

   ```
   python run.py
   ```

   Der Browser öffnet <http://localhost:8000/>. Im Terminal steht, ob die
   Schlüssel erkannt wurden. Beenden mit `Ctrl+C`.

## Auf GitHub veröffentlichen

1. Auf <https://github.com/new> ein neues Repository anlegen:
   Name `filmabend`, **Public** (GitHub Pages ist bei kostenlosen Konten
   nur für öffentliche Repos verfügbar), *keine* README/.gitignore hinzufügen.
2. Im Positron-Terminal (im Projektordner):

   ```
   git init
   git add .
   git commit -m "Filmabend"
   git branch -M main
   git remote add origin https://github.com/dummisa/filmabend.git
   git push -u origin main
   ```

   (Alternativ über die **Source Control**-Ansicht in Positron:
   *Initialize Repository* → Commit → *Publish Branch*.)
3. Auf github.com im Repo: **Settings → Pages → Build and deployment →
   Source: „GitHub Actions"**.
4. Unter dem Tab **Actions** läuft nun „Deploy to GitHub Pages". Falls der
   erste Lauf vor dem Umstellen auf „GitHub Actions" gestartet ist, dort
   einfach **Re-run** klicken.
5. Die Seite ist danach erreichbar unter **<https://dummisa.github.io/filmabend/>**.

Jede weitere Änderung: committen und pushen → die Seite aktualisiert sich
automatisch nach ein bis zwei Minuten. Die Watchlist selbst liegt in
Firebase und ist davon unabhängig – Filme hinzufügen braucht keinen Push.

## Bedienung

- **Dein Name** oben rechts eintragen (wird gemerkt) – so sieht man, wer
  welchen Film vorgeschlagen hat.
- **Film hinzufügen:** Titel eintippen (deutsch, englisch oder original –
  TMDB findet alle), Treffer anklicken (oder mit ↑/↓ und Enter wählen). Genre,
  Laufzeit, Jahr, Poster, Bewertung und Trailer werden automatisch von TMDB geholt.
- **Titel:** Filme heissen immer wie im Original. Ist die Originalsprache weder
  Deutsch noch Englisch (z.B. ein koreanischer oder französischer Film), steht
  der englische Titel in einer zweiten Zeile darunter.
- **Filtern:** Über **Filter & Sortierung** auf- und zuklappen (auf dem Handy
  standardmässig zu, am Desktop offen – die Wahl wird gemerkt; die Zahl am
  Button zeigt, wie viele Filter gerade aktiv sind). Chips bei *Genre*, *Länge*
  (< 90 / 90–120 / 120–150 / > 150 min) und *Jahr* (Jahrzehnte) anklicken –
  mehrere gleichzeitig möglich. Dazu Textsuche und Sortierung (zuletzt
  hinzugefügt, Titel, Jahr, Länge, Bewertung).
- **Handy:** Solange die Tastatur offen ist, zeigt die Filmsuche die Treffer
  kompakt (nur Titel), danach wieder mit Poster und Jahr.
- **Trailer:** Klick auf die Filmkarte (oder den Button ▶ Trailer) öffnet den
  YouTube-Trailer in einem neuen Tab – bevorzugt in der **Originalsprache** des
  Films, sonst Englisch, dann Deutsch (die Sprache steht im Tooltip des Buttons).
  Gibt es bei TMDB gar keinen Trailer, öffnet sich stattdessen die YouTube-Suche.
- **🎲 Zufallsfilm** wählt einen Film aus der aktuell gefilterten Liste aus.
- **✓ Gesehen** verschiebt den Film in den Tab *Gesehen* (von dort aus auch
  wieder zurück), **🗑** entfernt ihn ganz.

## Hinweise

- Die Filmsprache (Titel, Beschreibung, Genres) steht in `config.js` unter
  `language` (`de-DE`; z.B. `en-US` für Englisch).
- Texte der Oberfläche liegen gesammelt oben in `docs/app.js` (Objekt `T`),
  die Farben oben in `docs/style.css` (`:root`-Variablen).
- Ohne Firebase-Konfiguration speichert die Seite die Liste nur im eigenen
  Browser (`localStorage`) – praktisch zum Testen, aber nicht geteilt.
- Dieses Produkt verwendet die TMDB-API, ist aber nicht von TMDB unterstützt
  oder zertifiziert.
