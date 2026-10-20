// =====================================================================
//  Filmabend – Konfiguration
//
//  Hier kommen die Schlüssel rein. Diese Datei wird mit der Website
//  veröffentlicht – das ist bei diesen Werten in Ordnung:
//   • Der TMDB-Key kann nur öffentliche Filmdaten lesen.
//   • Die Firebase-Web-Konfiguration ist dafür gemacht, öffentlich zu sein.
//     Geschützt wird die Datenbank über die Regeln (siehe README, Schritt 2).
// =====================================================================

window.FILMABEND_CONFIG = {

  // ---------------------------------------------------------------
  // 1) TMDB – The Movie Database  (Filmdaten, Poster, Trailer)
  //    Key holen: https://www.themoviedb.org/settings/api
  //    Entweder den "API Key" (32 Zeichen) ODER den
  //    "API Read Access Token" (beginnt mit eyJ...) eintragen –
  //    beides funktioniert.
  // ---------------------------------------------------------------
  tmdbApiKey: '3e48cf1f60146fc4760ab554945afc00',

  // Sprache für Beschreibung und Genres. (Titel werden immer im Original
  // angezeigt, bei nicht deutsch-/englischsprachigen Filmen mit englischem
  // Titel darunter; Trailer bevorzugt in der Originalsprache.)
  language: 'de-DE',

  // ---------------------------------------------------------------
  // 2) Firebase Realtime Database  (geteilte Watchlist)
  //    Konsole: https://console.firebase.google.com
  //    Projekteinstellungen → Meine Apps → SDK-Konfiguration → Werte
  //    hier eintragen. WICHTIG: databaseURL muss gesetzt sein – sie
  //    steht oben auf der Seite "Realtime Database" und sieht z.B. so aus:
  //    https://filmabend-xxxxx-default-rtdb.europe-west1.firebasedatabase.app
  //
  //    Solange hier nichts eingetragen ist, läuft die Seite im lokalen
  //    Modus (Liste nur im eigenen Browser gespeichert).
  // ---------------------------------------------------------------
  firebase: {
    apiKey: 'AIzaSyAUQMTcdeWFtnOvtyqq1Etg7iSNmhe9dr4',
    authDomain: 'watchlist-fe32e.firebaseapp.com',
    databaseURL: 'https://watchlist-fe32e-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'watchlist-fe32e',
    storageBucket: 'watchlist-fe32e.firebasestorage.app',
    messagingSenderId: '368447759221',
    appId: '1:368447759221:web:221ce3457b7bfa58a7e93c'
  }
};
