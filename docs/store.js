/*
 * Speicher für die Watchlist
 * ---------------------------
 * Zwei Varianten mit identischer Schnittstelle:
 *   • Firebase Realtime Database – geteilte Liste, live auf allen Geräten
 *     (wird genutzt, sobald in config.js die Firebase-Werte stehen)
 *   • localStorage – Liste nur in diesem Browser (Fallback / Testbetrieb)
 *
 * Datenmodell: ein Objekt { [key]: movie }, in Firebase unter "watchlist/".
 * Die App liest die Filme über Object.values() – die Schlüssel sind egal.
 */
(function () {
  'use strict';

  const LS_KEY = 'filmabend:watchlist';
  const FB_VERSION = '12.19.0';
  const FB_CDN = 'https://www.gstatic.com/firebasejs/' + FB_VERSION + '/';

  /* ---------- localStorage ---------- */
  function createLocalStore() {
    let listeners = [];

    function read() {
      try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }
      catch (e) { return {}; }
    }
    function write(data) {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      emit();
    }
    function emit() {
      const d = read();
      listeners.forEach(cb => cb(d));
    }
    // Änderungen aus anderen Tabs übernehmen
    window.addEventListener('storage', e => { if (e.key === LS_KEY) emit(); });

    return {
      mode: 'local',
      subscribe(cb) {
        listeners.push(cb);
        cb(read());
        return () => { listeners = listeners.filter(x => x !== cb); };
      },
      async add(movie) { const d = read(); d[movie.id] = movie; write(d); },
      async update(id, patch) {
        const d = read();
        if (d[id]) { d[id] = Object.assign({}, d[id], patch); write(d); }
      },
      async remove(id) { const d = read(); delete d[id]; write(d); }
    };
  }

  /* ---------- Firebase Realtime Database ---------- */
  async function createFirebaseStore(config) {
    const [appMod, dbMod] = await Promise.all([
      import(FB_CDN + 'firebase-app.js'),
      import(FB_CDN + 'firebase-database.js')
    ]);
    const app = appMod.initializeApp(config);
    const db = dbMod.getDatabase(app);
    const root = dbMod.ref(db, 'watchlist');
    // Schlüssel mit Präfix "m", damit Firebase die Liste nie als Array interpretiert
    const item = id => dbMod.ref(db, 'watchlist/m' + id);

    return {
      mode: 'firebase',
      subscribe(cb, onError) {
        return dbMod.onValue(
          root,
          snap => cb(snap.val() || {}),
          err => { if (onError) onError(err); }
        );
      },
      add(movie) { return dbMod.set(item(movie.id), movie); },
      update(id, patch) { return dbMod.update(item(id), patch); },
      remove(id) { return dbMod.remove(item(id)); }
    };
  }

  function firebaseConfigured(fb) {
    return !!(fb && fb.apiKey && fb.projectId && fb.databaseURL);
  }

  function missingReason(fb) {
    if (!fb || (!fb.apiKey && !fb.projectId && !fb.databaseURL)) {
      return 'Firebase ist noch nicht konfiguriert – die Liste wird nur in diesem Browser gespeichert. ' +
             'Trage die Firebase-Werte in docs/config.js ein (siehe README, Schritt 2).';
    }
    const missing = ['apiKey', 'projectId', 'databaseURL'].filter(k => !fb[k]);
    return 'Firebase-Konfiguration unvollständig (fehlt: ' + missing.join(', ') + ') – ' +
           'die Liste wird nur in diesem Browser gespeichert.';
  }

  /* Liefert { store, reason } – reason ist gesetzt, wenn auf lokal ausgewichen wurde. */
  async function createStore() {
    const cfg = window.FILMABEND_CONFIG || {};
    const fb = cfg.firebase || {};

    if (!firebaseConfigured(fb)) {
      return { store: createLocalStore(), reason: missingReason(fb) };
    }
    try {
      return { store: await createFirebaseStore(fb), reason: null };
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      return {
        store: createLocalStore(),
        reason: 'Firebase konnte nicht gestartet werden (' + msg + ') – lokaler Modus.'
      };
    }
  }

  window.createStore = createStore;
})();
