/*
 * Filmabend – reine Logik (ohne Oberfläche, ohne Datenbank)
 * ----------------------------------------------------------
 * Listen zusammenführen, Filter, Sortierung, Abstimmungs-Bedingungen
 * und Auszählung. Wird von app.js benutzt und separat getestet.
 */

/* ---------- Schlüssel ---------- */
// Filme werden in Maps unter "m<TMDB-ID>" abgelegt (z.B. m27205)
export const mkey = id => 'm' + id;
export const idFromKey = k => Number(String(k).replace(/^m/, ''));

/* ---------- Einteilungen ---------- */
export const LENGTH_BUCKETS = [
  { key: 'short',   label: '< 90 min',    test: r => r != null && r < 90 },
  { key: 'medium',  label: '90–120 min',  test: r => r != null && r >= 90 && r <= 120 },
  { key: 'long',    label: '120–150 min', test: r => r != null && r > 120 && r <= 150 },
  { key: 'epic',    label: '> 150 min',   test: r => r != null && r > 150 },
  { key: 'unknown', label: 'unbekannt',   test: r => r == null }
];

export function lengthBucket(runtime) {
  return LENGTH_BUCKETS.find(b => b.test(runtime || null)).key;
}

export function decadeOf(year) {
  return year ? Math.floor(year / 10) * 10 : null;
}

export function decadeLabel(decade) {
  return decade == null ? 'unbekannt' : decade + 'er';
}

export const FSK_LEVELS = [0, 6, 12, 16, 18];

export function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

const titleOf = e => (e.movie.originalTitle || e.movie.title || '');

export const SORTS = {
  added_desc:   { label: 'Zuletzt hinzugefügt', fn: (a, b) => cmp(b.addedAt || 0, a.addedAt || 0) },
  title_asc:    { label: 'Titel A–Z',           fn: (a, b) => titleOf(a).localeCompare(titleOf(b), 'de') },
  year_desc:    { label: 'Jahr: neu → alt',     fn: (a, b) => cmp(b.movie.year || 0, a.movie.year || 0) },
  year_asc:     { label: 'Jahr: alt → neu',     fn: (a, b) => cmp(a.movie.year || 9999, b.movie.year || 9999) },
  runtime_asc:  { label: 'Länge: kurz → lang',  fn: (a, b) => cmp(a.movie.runtime || 9999, b.movie.runtime || 9999) },
  runtime_desc: { label: 'Länge: lang → kurz',  fn: (a, b) => cmp(b.movie.runtime || 0, a.movie.runtime || 0) },
  rating_desc:  { label: 'Bewertung',           fn: (a, b) => cmp(b.movie.rating || 0, a.movie.rating || 0) },
  wanted_desc:  { label: 'Meistgewünscht',      fn: (a, b) => cmp((b.wantedBy || []).length, (a.wantedBy || []).length) || cmp(b.addedAt || 0, a.addedAt || 0), groupOnly: true }
};

export function sortEntries(entries, key) {
  const s = SORTS[key] || SORTS.added_desc;
  return entries.slice().sort(s.fn);
}

/* ---------- Listen zusammenführen ---------- */

/* Persönliche Liste: which = 'watch' | 'seen' */
export function personalEntries(list, movies, which) {
  const map = (list && list[which]) || {};
  return Object.keys(map)
    .map(k => {
      const id = idFromKey(k);
      const movie = movies[id];
      if (!movie) return null;                       // Filmdaten noch nicht geladen
      return which === 'watch'
        ? { id, movie, addedAt: map[k] }
        : { id, movie, addedAt: map[k], seenAt: map[k] };
    })
    .filter(Boolean);
}

/* Welche Filme eine Person in einer Gruppe teilt.
   Neu: list.share[gid] (pro Gruppe gewählt). Ältere Daten ohne
   shareInit[gid]: dann gilt wie bisher die ganze persönliche Watchlist. */
export function shareOf(list, gid) {
  if (!list) return {};
  if (list.shareInit && list.shareInit[gid]) return (list.share && list.share[gid]) || {};
  return list.watch || {};
}

export function sharesIn(list, gid, id) {
  return shareOf(list, gid)[mkey(id)] != null;
}

/* Gruppen, in denen eine Person einen Film teilt */
export function groupsSharing(list, gids, id) {
  return gids.filter(gid => sharesIn(list, gid, id));
}

/* Gruppenliste: alle Filme, die Mitglieder in dieser Gruppe teilen,
   mit "gewünscht von" und "gesehen von" (nur Mitglieder). */
export function groupEntries(members, lists, movies, gid) {
  const byId = new Map();
  members.forEach(uid => {
    const share = shareOf(lists[uid], gid);
    Object.keys(share).forEach(k => {
      const id = idFromKey(k);
      if (!movies[id]) return;
      let e = byId.get(id);
      if (!e) { e = { id, movie: movies[id], wantedBy: [], seenBy: [], addedAt: 0 }; byId.set(id, e); }
      e.wantedBy.push(uid);
      e.addedAt = Math.max(e.addedAt, Number(share[k]) || 0);
    });
  });
  byId.forEach(e => {
    e.seenBy = members.filter(uid => {
      const seen = (lists[uid] && lists[uid].seen) || {};
      return seen[mkey(e.id)] != null;
    });
  });
  return Array.from(byId.values());
}

/* ---------- Filter ---------- */

export function emptyFilters() {
  return { genres: new Set(), lengths: new Set(), decades: new Set(), text: '', notSeenBy: new Set(), maxSeen: null };
}

export function activeFilterCount(f) {
  return f.genres.size + f.lengths.size + f.decades.size + (f.text.trim() ? 1 : 0) +
    f.notSeenBy.size + (f.maxSeen != null ? 1 : 0);
}

/* nameOf(uid) → Name, für die Textsuche nach Personen */
export function applyFilters(entries, f, nameOf) {
  const text = (f.text || '').trim().toLowerCase();
  return entries.filter(e => {
    const m = e.movie;
    const genres = m.genres || [];
    if (f.genres.size && !genres.some(g => f.genres.has(g))) return false;
    if (f.lengths.size && !f.lengths.has(lengthBucket(m.runtime))) return false;
    if (f.decades.size && !f.decades.has(String(decadeOf(m.year)))) return false;
    if (e.seenBy) {
      if (f.notSeenBy.size && e.seenBy.some(uid => f.notSeenBy.has(uid))) return false;
      if (f.maxSeen != null && e.seenBy.length > f.maxSeen) return false;
    }
    if (text) {
      const people = (e.wantedBy || []).map(uid => nameOf ? nameOf(uid) : '');
      const hay = [m.title, m.originalTitle, m.titleEn, m.titleDe, String(m.year || ''), genres.join(' '), people.join(' ')]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

/* ---------- Abstimmung: Bedingungen ---------- */

export const METHODS = {
  approval: { label: 'Zustimmung', hint: 'Jede Person hakt alle Filme an, die für sie okay sind. Meiste Häkchen gewinnt.' },
  single:   { label: 'Eine Stimme', hint: 'Jede Person wählt genau einen Film. Meiste Stimmen gewinnt.' },
  ranked:   { label: 'Rangfolge',   hint: 'Jede Person wählt Platz 1–3 (3, 2, 1 Punkte). Meiste Punkte gewinnt.' }
};

export function emptyConditions() {
  return { maxRuntime: null, maxFsk: null, genres: [], seen: { mode: 'any', max: 0, notBy: [] } };
}

/* Passt ein Gruppen-Eintrag zu den Bedingungen einer Abstimmung? */
export function eligible(entry, cond) {
  const c = cond || emptyConditions();
  const m = entry.movie;
  if (c.maxRuntime != null && !(m.runtime && m.runtime <= c.maxRuntime)) return false;
  if (c.maxFsk != null && !(m.fsk != null && m.fsk <= c.maxFsk)) return false;
  if (c.genres && c.genres.length && !(m.genres || []).some(g => c.genres.includes(g))) return false;
  const s = c.seen || { mode: 'any' };
  const seenBy = entry.seenBy || [];
  if (s.mode === 'none' && seenBy.length > 0) return false;
  if (s.mode === 'max' && seenBy.length > (s.max || 0)) return false;
  if (s.mode === 'notBy' && seenBy.some(uid => (s.notBy || []).includes(uid))) return false;
  return true;
}

/* Bedingungen als kurze Texte (für die Anzeige) */
export function conditionsSummary(cond, nameOf) {
  const c = cond || emptyConditions();
  const out = [];
  if (c.maxRuntime != null) out.push('max. ' + c.maxRuntime + ' min');
  if (c.maxFsk != null) out.push('max. FSK ' + c.maxFsk);
  if (c.genres && c.genres.length) out.push(c.genres.join(' / '));
  const s = c.seen || { mode: 'any' };
  if (s.mode === 'none') out.push('von niemandem gesehen');
  if (s.mode === 'max') out.push(s.max === 1 ? 'von höchstens 1 Person gesehen' : 'von höchstens ' + s.max + ' Personen gesehen');
  if (s.mode === 'notBy' && s.notBy && s.notBy.length) {
    out.push('nicht gesehen von ' + s.notBy.map(uid => nameOf ? nameOf(uid) : uid).join(', '));
  }
  return out;
}

/* ---------- Abstimmung: Nominierungen und Stimmen ---------- */

export function nominatedIds(vote) {
  return Object.keys(vote.nominations || {}).map(idFromKey);
}

export function nominationsBy(vote, uid) {
  return Object.keys(vote.nominations || {}).filter(k => vote.nominations[k] === uid).map(idFromKey);
}

/* maxNominations 0 = unbegrenzt */
export function canNominate(vote, uid) {
  if (vote.status !== 'nominate') return false;
  return !vote.maxNominations || nominationsBy(vote, uid).length < vote.maxNominations;
}

export function nominationLimitText(max) {
  if (!max) return 'unbegrenzt Nominierungen pro Person';
  return 'max. ' + max + ' Nominierung' + (max > 1 ? 'en' : '') + ' pro Person';
}

/* Stimmzettel bereinigen: nur Nominierte, keine Doppelten, je nach Methode begrenzt */
export function cleanBallot(method, ids, nominees) {
  const allowed = new Set(nominees);
  const out = [];
  (ids || []).forEach(id => { id = Number(id); if (allowed.has(id) && !out.includes(id)) out.push(id); });
  if (method === 'single') return out.slice(0, 1);
  if (method === 'ranked') return out.slice(0, Math.min(3, nominees.length));
  return out;
}

/* Tippen auf einen Film im Stimmzettel → neuer Stimmzettel */
export function toggleBallot(method, ballot, id, nominees) {
  const cur = (ballot || []).map(Number);
  let next;
  if (method === 'single') next = cur[0] === id ? [] : [id];
  else if (cur.includes(id)) next = cur.filter(x => x !== id);       // abwählen (Rangfolge rückt nach)
  else if (method === 'ranked' && cur.length >= Math.min(3, nominees.length)) next = cur;  // schon 3 Plätze
  else next = cur.concat(id);
  return cleanBallot(method, next, nominees);
}

/* Punkte zählen. Ergebnis: Rangliste [{id, score, votes}] absteigend */
export function tally(vote) {
  const nominees = nominatedIds(vote);
  const scores = {}, votes = {};
  nominees.forEach(id => { scores[id] = 0; votes[id] = 0; });
  const ballots = vote.ballots || {};
  Object.keys(ballots).forEach(uid => {
    const b = cleanBallot(vote.method, ballots[uid], nominees);
    b.forEach((id, i) => {
      const pts = vote.method === 'ranked' ? 3 - i : 1;
      scores[id] += pts;
      votes[id] += 1;
    });
  });
  const ranking = nominees
    .map(id => ({ id, score: scores[id], votes: votes[id] }))
    .sort((a, b) => b.score - a.score || b.votes - a.votes || a.id - b.id);
  return { ranking, voterCount: Object.keys(ballots).filter(uid => (ballots[uid] || []).length).length };
}

/* Gewinner bestimmen; bei Gleichstand entscheidet der Zufall */
export function decideWinner(ranking, rand) {
  if (!ranking.length) return { winner: null, tie: [] };
  const top = ranking[0].score;
  const tied = ranking.filter(r => r.score === top);
  const r = rand || Math.random;
  const pick = tied[Math.floor(r() * tied.length)];
  return { winner: pick.id, tie: tied.length > 1 ? tied.map(t => t.id) : [] };
}

/* ---------- Diverses ---------- */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // ohne 0/O, 1/I
export function makeCode(rand) {
  const r = rand || Math.random;
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(r() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/* Aus TMDB release_dates die Altersfreigabe lesen (DE, sonst CH) */
export function fskFromReleaseDates(releaseDates) {
  const results = (releaseDates && releaseDates.results) || [];
  for (const country of ['DE', 'CH']) {
    const c = results.find(r => r.iso_3166_1 === country);
    if (!c) continue;
    const certs = (c.release_dates || [])
      .slice()
      .sort((a, b) => (a.type === 3 ? -1 : 0) - (b.type === 3 ? -1 : 0))   // Kinostart zuerst
      .map(d => String(d.certification || '').trim())
      .filter(Boolean);
    for (const cert of certs) {
      const n = parseInt(cert.replace(/^FSK\s*/i, ''), 10);
      if (Number.isFinite(n) && n >= 0 && n <= 18) return n;
    }
  }
  return null;
}
