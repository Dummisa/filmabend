/*
 * Filmabend – Watchlist-App
 * --------------------------
 * Oberfläche, Filter (Genre / Länge / Jahr), Sortierung, Zufallsfilm.
 * Daten: tmdb.js (Filminfos) + store.js (Firebase oder localStorage).
 */
(function () {
  'use strict';

  /* ---------- Texte ---------- */
  const T = {
    statusShared: 'Geteilte Liste – live auf allen Geräten',
    statusLocal: 'Lokale Liste – nur in diesem Browser',
    noKey: 'TMDB-API-Key fehlt – trage ihn in docs/config.js ein (siehe README, Schritt 1).',
    searchHint: 'Titel eingeben, Treffer anklicken – Genre, Länge, Jahr und Trailer kommen automatisch von TMDB.',
    searching: 'Suche …',
    noResults: 'Nichts gefunden.',
    adding: 'wird hinzugefügt …',
    already: 'Ist schon auf der Liste.',
    added: t => '„' + t + '“ hinzugefügt',
    removed: t => '„' + t + '“ entfernt',
    confirmRemove: t => '„' + t + '“ wirklich von der Liste entfernen?',
    markedWatched: t => '„' + t + '“ als gesehen markiert',
    backToList: t => '„' + t + '“ ist zurück auf der Watchlist',
    emptyList: 'Noch keine Filme auf der Watchlist – füge oben den ersten hinzu!',
    emptyWatched: 'Noch nichts gesehen. Markiere Filme auf der Watchlist mit „Gesehen“.',
    emptyFiltered: 'Kein Film passt zu den Filtern.',
    pick: m => '🎲 Vorschlag für heute: ' + m.title + (m.year ? ' (' + m.year + ')' : ''),
    pickNone: 'Keine Filme zur Auswahl – Filter anpassen oder Filme hinzufügen.',
    trailer: '▶ Trailer',
    trailerSearch: '▶ Trailer suchen',
    watched: '✓ Gesehen',
    unwatch: '↩ Zurück auf die Liste',
    remove: 'Entfernen',
    by: 'von',
    unknown: 'unbekannt'
  };

  /* ---------- Einteilungen ---------- */
  const LENGTH_BUCKETS = [
    { key: 'short',   label: '< 90 min',    test: r => r != null && r < 90 },
    { key: 'medium',  label: '90–120 min',  test: r => r != null && r >= 90 && r <= 120 },
    { key: 'long',    label: '120–150 min', test: r => r != null && r > 120 && r <= 150 },
    { key: 'epic',    label: '> 150 min',   test: r => r != null && r > 150 },
    { key: 'unknown', label: T.unknown,     test: r => r == null }
  ];

  const SORTS = {
    added_desc:   { label: 'Zuletzt hinzugefügt', fn: (a, b) => cmp(b.addedAt || '', a.addedAt || '') },
    title_asc:    { label: 'Titel A–Z',           fn: (a, b) => (a.title || '').localeCompare(b.title || '', 'de') },
    year_desc:    { label: 'Jahr: neu → alt',     fn: (a, b) => cmp(b.year || 0, a.year || 0) },
    year_asc:     { label: 'Jahr: alt → neu',     fn: (a, b) => cmp(a.year || 9999, b.year || 9999) },
    runtime_asc:  { label: 'Länge: kurz → lang',  fn: (a, b) => cmp(a.runtime || 9999, b.runtime || 9999) },
    runtime_desc: { label: 'Länge: lang → kurz',  fn: (a, b) => cmp(b.runtime || 0, a.runtime || 0) },
    rating_desc:  { label: 'Bewertung',           fn: (a, b) => cmp(b.rating || 0, a.rating || 0) }
  };

  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  /* ---------- Zustand ---------- */
  let store = null;
  let movies = {};                    // { id: movie }
  let view = 'watchlist';             // 'watchlist' | 'watched'
  const filters = { genres: new Set(), lengths: new Set(), decades: new Set(), text: '' };
  let sortKey = 'added_desc';
  let pickedId = null;
  let searchResults = [];
  let searchIndex = -1;
  let searchTimer = null;
  let searchSeq = 0;

  /* ---------- Hilfsfunktionen ---------- */
  const $ = id => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function lengthBucket(runtime) {
    return LENGTH_BUCKETS.find(b => b.test(runtime)).key;
  }

  function decadeOf(year) {
    return year ? Math.floor(year / 10) * 10 : null;
  }

  function decadeLabel(decade) {
    return decade == null ? T.unknown : decade + 'er';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('de-CH');
  }

  function fmtRuntime(min) {
    if (!min) return '–';
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + ' min';
    return h + ' h' + (m ? ' ' + m + ' min' : '');
  }

  function currentName() {
    return ($('user-name').value || '').trim();
  }

  function toast(msg, isError) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), isError ? 6000 : 3000);
  }

  function showBanner(msg, kind) {
    const el = $('banner');
    el.textContent = msg;
    el.className = 'banner ' + (kind || 'info');
  }

  /* ---------- Listen-Logik (rein, für Filter/Sortierung) ---------- */
  function moviesInView() {
    return Object.values(movies)
      .filter(m => m && m.id)
      .filter(m => (view === 'watched') === !!m.watched);
  }

  function applyFilters(list) {
    const text = filters.text.trim().toLowerCase();
    return list.filter(m => {
      const genres = m.genres || [];
      if (filters.genres.size && !genres.some(g => filters.genres.has(g))) return false;
      if (filters.lengths.size && !filters.lengths.has(lengthBucket(m.runtime))) return false;
      if (filters.decades.size && !filters.decades.has(String(decadeOf(m.year)))) return false;
      if (text) {
        const hay = [m.title, m.originalTitle, m.titleEn, m.titleDe, String(m.year || ''), genres.join(' '), m.addedBy]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
  }

  function sortMovies(list) {
    return list.slice().sort(SORTS[sortKey].fn);
  }

  function visibleMovies() {
    return sortMovies(applyFilters(moviesInView()));
  }

  function anyFilterActive() {
    return filters.genres.size || filters.lengths.size || filters.decades.size || filters.text.trim();
  }

  /* ---------- Rendering ---------- */
  function renderChips() {
    const list = moviesInView();

    // Genre
    const genreCount = {};
    list.forEach(m => (m.genres || []).forEach(g => { genreCount[g] = (genreCount[g] || 0) + 1; }));
    const genres = Object.keys(genreCount).sort((a, b) => a.localeCompare(b, 'de'));
    filters.genres.forEach(g => { if (!genreCount[g]) filters.genres.delete(g); });
    $('chips-genre').innerHTML = genres.length
      ? genres.map(g => chip('genre', g, g, genreCount[g], filters.genres.has(g))).join('')
      : '<span class="muted">–</span>';

    // Länge
    const lengthCount = {};
    list.forEach(m => { const k = lengthBucket(m.runtime); lengthCount[k] = (lengthCount[k] || 0) + 1; });
    $('chips-length').innerHTML = LENGTH_BUCKETS
      .filter(b => b.key !== 'unknown' || lengthCount.unknown)
      .map(b => chip('length', b.key, b.label, lengthCount[b.key] || 0, filters.lengths.has(b.key)))
      .join('');

    // Jahr (Jahrzehnte)
    const decadeCount = {};
    list.forEach(m => { const d = String(decadeOf(m.year)); decadeCount[d] = (decadeCount[d] || 0) + 1; });
    const decades = Object.keys(decadeCount).sort((a, b) => {
      if (a === 'null') return 1;
      if (b === 'null') return -1;
      return Number(b) - Number(a);
    });
    filters.decades.forEach(d => { if (!decadeCount[d]) filters.decades.delete(d); });
    $('chips-year').innerHTML = decades.length
      ? decades.map(d => chip('decade', d, decadeLabel(d === 'null' ? null : Number(d)), decadeCount[d], filters.decades.has(d))).join('')
      : '<span class="muted">–</span>';
  }

  function chip(type, value, label, count, active) {
    return '<button type="button" class="chip' + (active ? ' active' : '') +
      '" data-filter="' + type + '" data-value="' + esc(value) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
      esc(label) + '<span class="n">' + count + '</span></button>';
  }

  function languageName(code) {
    if (!code) return null;
    try { return new Intl.DisplayNames(['de'], { type: 'language' }).of(code); }
    catch (e) { return code.toUpperCase(); }
  }

  function renderCard(m) {
    const poster = TMDB.posterUrl(m.posterPath);
    const genres = m.genres || [];
    const isWatched = !!m.watched;
    const picked = m.id === pickedId;
    const mainTitle = m.originalTitle || m.title;
    const subtitle = TMDB.subtitleOf(m);
    const trailerLabel = m.trailerKey ? T.trailer : T.trailerSearch;
    const trailerLang = m.trailerKey ? languageName(m.trailerLanguage) : null;
    const trailerTitle = trailerLang ? 'Trailer auf ' + trailerLang : (m.trailerKey ? 'Trailer' : 'Trailer auf YouTube suchen');
    const meta = [];
    if (m.runtime) meta.push('<span title="' + m.runtime + ' Minuten">⏱ ' + esc(fmtRuntime(m.runtime)) + '</span>');
    if (m.rating) meta.push('<span title="TMDB-Bewertung">★ ' + esc(m.rating.toFixed(1)) + '</span>');
    const addedInfo = [
      m.addedBy ? T.by + ' ' + esc(m.addedBy) : '',
      fmtDate(m.addedAt)
    ].filter(Boolean).join(' · ');
    const watchedInfo = isWatched && m.watchedAt ? 'gesehen am ' + fmtDate(m.watchedAt) : '';

    return '' +
      '<article class="movie' + (picked ? ' picked' : '') + (isWatched ? ' watched' : '') +
        '" data-id="' + m.id + '" tabindex="0" role="link" aria-label="Trailer von ' + esc(mainTitle) + ' öffnen">' +
        (picked ? '<div class="pick-badge">🎲 Vorschlag</div>' : '') +
        '<div class="poster">' +
          (poster ? '<img src="' + esc(poster) + '" alt="" loading="lazy">' : '<div class="noposter">🎬</div>') +
        '</div>' +
        '<div class="body">' +
          '<div class="title-row">' +
            '<h3>' + esc(mainTitle) + '</h3>' +
            '<span class="year">' + (m.year || '') + '</span>' +
          '</div>' +
          (subtitle ? '<div class="alt-title">' + esc(subtitle) + '</div>' : '') +
          (meta.length ? '<div class="meta">' + meta.join('') + '</div>' : '') +
          (genres.length ? '<div class="genres">' + genres.map(g => '<span class="g">' + esc(g) + '</span>').join('') + '</div>' : '') +
          (m.overview ? '<p class="overview">' + esc(m.overview) + '</p>' : '') +
          '<div class="foot">' +
            '<span class="added">' + esc(watchedInfo || addedInfo) + '</span>' +
            '<div class="actions">' +
              '<button type="button" class="btn primary" data-action="trailer" title="' + esc(trailerTitle) + '">' + trailerLabel + '</button>' +
              '<button type="button" class="btn" data-action="toggle-watched">' + (isWatched ? T.unwatch : T.watched) + '</button>' +
              '<button type="button" class="btn danger" data-action="remove" title="' + T.remove + '" aria-label="' + T.remove + '">🗑</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function render() {
    const all = Object.values(movies).filter(m => m && m.id);
    $('count-watchlist').textContent = all.filter(m => !m.watched).length;
    $('count-watched').textContent = all.filter(m => m.watched).length;

    document.querySelectorAll('.tab').forEach(t => {
      const active = t.dataset.view === view;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('random').classList.toggle('hidden', view !== 'watchlist');

    renderChips();

    const inView = moviesInView();
    const list = visibleMovies();
    const grid = $('grid');
    const empty = $('empty');

    if (!inView.length) {
      grid.innerHTML = '';
      empty.textContent = view === 'watched' ? T.emptyWatched : T.emptyList;
      empty.classList.remove('hidden');
    } else if (!list.length) {
      grid.innerHTML = '';
      empty.textContent = T.emptyFiltered;
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      grid.innerHTML = list.map(renderCard).join('');
    }

    const noun = inView.length === 1 ? 'Film' : 'Filme';
    $('summary').textContent = anyFilterActive()
      ? list.length + ' von ' + inView.length + ' ' + noun
      : inView.length + ' ' + noun + (view === 'watched' ? ' gesehen' : ' auf der Watchlist');
    $('reset-filters').classList.toggle('hidden', !anyFilterActive());

    // Anzahl aktiver Filter am Aufklapp-Button (auch wenn das Panel zu ist)
    const n = filters.genres.size + filters.lengths.size + filters.decades.size + (filters.text.trim() ? 1 : 0);
    $('filter-count').textContent = n;
    $('filter-count').classList.toggle('hidden', n === 0);
  }

  /* ---------- Filter-Panel auf-/zuklappen ---------- */
  function setFiltersOpen(open, remember) {
    $('filters').classList.toggle('collapsed', !open);
    $('filter-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    $('filter-toggle').classList.toggle('open', open);
    if (remember) { try { localStorage.setItem('filmabend:filtersOpen', open ? '1' : '0'); } catch (e) { /* egal */ } }
  }

  function initFilterToggle() {
    let saved = null;
    try { saved = localStorage.getItem('filmabend:filtersOpen'); } catch (e) { /* egal */ }
    // Standard: auf dem Handy zu, auf dem Desktop offen – gemerkte Wahl gewinnt
    const open = saved === null ? window.innerWidth > 700 : saved === '1';
    setFiltersOpen(open, false);
    $('filter-toggle').addEventListener('click', () => {
      setFiltersOpen($('filters').classList.contains('collapsed'), true);
    });
  }

  /* ---------- Kompakte Suchtreffer, solange die Handy-Tastatur offen ist ---------- */
  function initCompactSearch() {
    const vv = window.visualViewport;
    const input = $('search-input');
    const box = $('search-results');
    const update = () => {
      const narrow = window.innerWidth <= 700;
      // Tastatur offen = sichtbarer Bereich deutlich kleiner als das Fenster
      const keyboard = vv ? vv.height < window.innerHeight * 0.75 : document.activeElement === input;
      box.classList.toggle('compact', narrow && keyboard);
    };
    if (vv) vv.addEventListener('resize', update);
    window.addEventListener('resize', update);
    input.addEventListener('focus', () => setTimeout(update, 300));
    input.addEventListener('blur', () => setTimeout(update, 300));
  }

  /* ---------- Aktionen ---------- */
  function openTrailer(m) {
    // Über ein <a>-Element öffnen: zuverlässig neuer Tab, kein Popup-Blocker
    const a = document.createElement('a');
    a.href = TMDB.trailerUrl(m);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function toggleWatched(m) {
    const nowWatched = !m.watched;
    try {
      await store.update(m.id, { watched: nowWatched, watchedAt: nowWatched ? new Date().toISOString() : null });
      if (pickedId === m.id) pickedId = null;
      toast(nowWatched ? T.markedWatched(m.title) : T.backToList(m.title));
    } catch (e) { toast('Fehler: ' + e.message, true); }
  }

  async function removeMovie(m) {
    if (!confirm(T.confirmRemove(m.title))) return;
    try {
      await store.remove(m.id);
      if (pickedId === m.id) pickedId = null;
      toast(T.removed(m.title));
    } catch (e) { toast('Fehler: ' + e.message, true); }
  }

  function pickRandom() {
    const list = visibleMovies();
    if (!list.length) { toast(T.pickNone, true); return; }
    const pool = list.length > 1 ? list.filter(m => m.id !== pickedId) : list;
    const m = pool[Math.floor(Math.random() * pool.length)];
    pickedId = m.id;
    render();
    const card = document.querySelector('.movie[data-id="' + m.id + '"]');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(T.pick(m));
  }

  async function addMovie(result) {
    if (movies[result.id]) { toast(T.already); closeSearch(); return; }
    const input = $('search-input');
    input.disabled = true;
    $('search-hint').textContent = '„' + result.title + '“ ' + T.adding;
    try {
      const d = await TMDB.details(result.id);
      const movie = Object.assign({}, d, {
        addedAt: new Date().toISOString(),
        addedBy: currentName() || null,
        watched: false,
        watchedAt: null
      });
      await store.add(movie);
      toast(T.added(movie.title));
      input.value = '';
      closeSearch();
      if (view !== 'watchlist') { view = 'watchlist'; render(); }
    } catch (e) {
      toast('Fehler: ' + e.message, true);
    } finally {
      input.disabled = false;
      $('search-hint').textContent = T.searchHint;
      input.focus();
    }
  }

  /* ---------- Suche (TMDB) ---------- */
  function closeSearch() {
    searchResults = [];
    searchIndex = -1;
    const box = $('search-results');
    box.innerHTML = '';
    box.classList.add('hidden');
  }

  function renderSearchResults() {
    const box = $('search-results');
    if (!searchResults.length) {
      box.innerHTML = '<div class="result-empty">' + T.noResults + '</div>';
    } else {
      box.innerHTML = searchResults.map((r, i) => {
        const poster = TMDB.posterUrl(r.posterPath, 'w92');
        const onList = !!movies[r.id];
        return '<button type="button" class="result' + (i === searchIndex ? ' hover' : '') +
          (onList ? ' onlist' : '') + '" data-index="' + i + '">' +
          (poster ? '<img src="' + esc(poster) + '" alt="">' : '<span class="noposter">🎬</span>') +
          '<span class="rt"><strong>' + esc(r.title) + '</strong>' +
          (r.subtitle ? ' <em>' + esc(r.subtitle) + '</em>' : '') +
          '</span>' +
          '<span class="ry">' + (onList ? '✓ auf der Liste' : (r.year || '')) + '</span>' +
          '</button>';
      }).join('');
    }
    box.classList.remove('hidden');
  }

  async function runSearch(q) {
    const seq = ++searchSeq;
    $('search-hint').textContent = T.searching;
    try {
      const res = await TMDB.search(q);
      if (seq !== searchSeq) return;              // veraltete Antwort
      searchResults = res;
      searchIndex = res.length ? 0 : -1;
      renderSearchResults();
      $('search-hint').textContent = T.searchHint;
    } catch (e) {
      if (seq !== searchSeq) return;
      closeSearch();
      $('search-hint').textContent = T.searchHint;
      toast('Fehler: ' + e.message, true);
    }
  }

  function onSearchInput() {
    const q = $('search-input').value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) { closeSearch(); return; }
    searchTimer = setTimeout(() => runSearch(q), 350);
  }

  function onSearchKey(e) {
    if (!searchResults.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); searchIndex = (searchIndex + 1) % searchResults.length; renderSearchResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); searchIndex = (searchIndex - 1 + searchResults.length) % searchResults.length; renderSearchResults();
    } else if (e.key === 'Enter') {
      e.preventDefault(); if (searchIndex >= 0) addMovie(searchResults[searchIndex]);
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  }

  /* ---------- Start ---------- */
  async function init() {
    // Name merken
    const nameInput = $('user-name');
    nameInput.value = localStorage.getItem('filmabend:name') || '';
    nameInput.addEventListener('change', () => localStorage.setItem('filmabend:name', currentName()));

    // Sortierung
    const sortSel = $('sort');
    sortSel.innerHTML = Object.entries(SORTS)
      .map(([k, s]) => '<option value="' + k + '">' + esc(s.label) + '</option>').join('');
    sortSel.value = sortKey;
    sortSel.addEventListener('change', () => { sortKey = sortSel.value; render(); });

    // Tabs
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      view = t.dataset.view; pickedId = null; render();
    }));

    // Filter-Chips (delegiert)
    $('filters').addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (!c) return;
      const set = { genre: filters.genres, length: filters.lengths, decade: filters.decades }[c.dataset.filter];
      if (set.has(c.dataset.value)) set.delete(c.dataset.value); else set.add(c.dataset.value);
      render();
    });
    $('list-search').addEventListener('input', e => { filters.text = e.target.value; render(); });
    $('reset-filters').addEventListener('click', () => {
      filters.genres.clear(); filters.lengths.clear(); filters.decades.clear(); filters.text = '';
      $('list-search').value = '';
      render();
    });
    $('random').addEventListener('click', pickRandom);
    initFilterToggle();
    initCompactSearch();

    // Karten (delegiert): Klick auf Karte = Trailer, Buttons = Aktionen
    $('grid').addEventListener('click', e => {
      const card = e.target.closest('.movie');
      if (!card) return;
      const m = movies[card.dataset.id];
      if (!m) return;
      const btn = e.target.closest('button[data-action]');
      if (btn) {
        e.stopPropagation();
        if (btn.dataset.action === 'trailer') openTrailer(m);
        else if (btn.dataset.action === 'toggle-watched') toggleWatched(m);
        else if (btn.dataset.action === 'remove') removeMovie(m);
        return;
      }
      openTrailer(m);
    });
    $('grid').addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return;
      const card = e.target.closest('.movie');
      if (card && movies[card.dataset.id]) openTrailer(movies[card.dataset.id]);
    });

    // Suche
    const input = $('search-input');
    if (!TMDB.hasKey()) {
      input.disabled = true;
      input.placeholder = 'TMDB-API-Key fehlt';
      $('search-hint').textContent = T.noKey;
      $('search-hint').classList.add('warn');
    } else {
      $('search-hint').textContent = T.searchHint;
      input.addEventListener('input', onSearchInput);
      input.addEventListener('keydown', onSearchKey);
      input.addEventListener('focus', () => { if (searchResults.length) renderSearchResults(); });
      $('search-results').addEventListener('click', e => {
        const r = e.target.closest('.result');
        if (r) addMovie(searchResults[Number(r.dataset.index)]);
      });
      document.addEventListener('click', e => {
        if (!e.target.closest('.search')) closeSearch();
      });
    }

    // Speicher
    const result = await createStore();
    store = result.store;
    $('status-dot').className = 'dot ' + store.mode;
    $('status-text').textContent = store.mode === 'firebase' ? T.statusShared : T.statusLocal;
    if (result.reason) showBanner(result.reason, store.mode === 'local' && /konnte nicht/.test(result.reason) ? 'warn' : 'info');

    store.subscribe(
      data => {
        // Egal wie der Speicher die Daten ablegt: hier immer { [id]: movie }
        movies = {};
        Object.values(data || {}).forEach(m => { if (m && m.id) movies[m.id] = m; });
        render();
      },
      err => showBanner('Firebase-Fehler: ' + (err && err.message ? err.message : err) +
        ' – sind die Datenbank-Regeln gesetzt? (README, Schritt 2)', 'warn')
    );
    render();
  }

  // Für Tests / Konsole zugänglich
  window.Filmabend = { applyFilters, sortMovies, lengthBucket, decadeOf, filters, get movies() { return movies; } };

  document.addEventListener('DOMContentLoaded', init);
})();
