/*
 * TMDB-Client (The Movie Database, API v3)
 * ------------------------------------------
 * Holt Suchergebnisse, Filmdetails (Genre, Laufzeit, Jahr, Poster,
 * Bewertung, FSK) und den YouTube-Trailer. Der Key kommt aus config.js.
 *
 * Titel:   Es wird immer der Originaltitel angezeigt. Ist die
 *          Originalsprache weder Deutsch noch Englisch, kommt der englische
 *          Titel als zweite Zeile dazu (titleEn).
 * Trailer: Bevorzugt in der Originalsprache des Films, dann Englisch,
 *          dann Deutsch, dann irgendeiner.
 * FSK:     Altersfreigabe Deutschland (sonst Schweiz), z.B. 12.
 */
import { fskFromReleaseDates, fskFromContentRatings, isTv, tmdbId } from './logic.js?v=__V__';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

function cfg() { return window.FILMABEND_CONFIG || {}; }
function key() { return String(cfg().tmdbApiKey || '').trim(); }
function lang() { return cfg().language || 'de-DE'; }

export function hasKey() { return key().length > 0; }

async function request(path, params) {
  const k = key();
  if (!k) throw new Error('TMDB-API-Key fehlt (docs/config.js).');

  const url = new URL(BASE + path);
  url.searchParams.set('language', lang());
  Object.entries(params || {}).forEach(([p, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(p, v);
  });

  const headers = { Accept: 'application/json' };
  if (k.startsWith('eyJ')) headers.Authorization = 'Bearer ' + k;   // v4 Read Access Token
  else url.searchParams.set('api_key', k);                          // v3 API Key

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    let msg = 'TMDB-Fehler ' + res.status;
    try {
      const j = await res.json();
      if (j && j.status_message) msg += ': ' + j.status_message;
    } catch (e) { /* ignore */ }
    if (res.status === 401) msg += ' – ist der Key in docs/config.js korrekt?';
    throw new Error(msg);
  }
  return res.json();
}

function yearOf(date) {
  const y = parseInt(String(date || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function isDeOrEn(langCode) {
  return langCode === 'de' || langCode === 'en';
}

/* Suche nach Filmen und Serien (findet auch deutsche/alternative Titel) – max. 10 Treffer. */
export async function search(query) {
  const data = await request('/search/multi', {
    query: query, include_adult: 'false', page: 1, language: 'en-US'
  });
  return (data.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 10).map(r => {
    const tv = r.media_type === 'tv';
    if (tv) { r.title = r.name; r.original_title = r.original_name; r.release_date = r.first_air_date; }
    const original = r.original_title || r.title;
    return {
      id: r.id,
      type: tv ? 'tv' : 'movie',
      key: (tv ? 't' : 'm') + r.id,
      title: original,
      titleEn: r.title || original,
      originalLanguage: r.original_language || null,
      subtitle: (!isDeOrEn(r.original_language) && r.title && r.title !== original) ? r.title : null,
      year: yearOf(r.release_date),
      posterPath: r.poster_path || null
    };
  });
}

/* Besten YouTube-Trailer wählen: Originalsprache > Englisch > Deutsch > andere;
   Trailer > Teaser > Rest; offiziell > inoffiziell; bei Gleichstand der neueste. */
export function pickTrailer(videos, originalLanguage) {
  const list = (videos || []).filter(v => v && v.site === 'YouTube' && v.key);
  const langRank = v =>
    v.iso_639_1 === originalLanguage ? 0 : v.iso_639_1 === 'en' ? 1 : v.iso_639_1 === 'de' ? 2 : 3;
  const typeRank = v => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : 2);
  const score = v => langRank(v) * 100 + typeRank(v) * 10 + (v.official ? 0 : 1);
  list.sort((a, b) =>
    score(a) - score(b) ||
    String(b.published_at || '').localeCompare(String(a.published_at || '')));
  return list.length ? { key: list[0].key, language: list[0].iso_639_1 || null } : null;
}

/* Nur die Altersfreigabe (für Titel, die noch keine haben); key = m123 / t123 */
export async function fsk(key) {
  if (isTv(key)) return fskFromContentRatings(await request('/tv/' + tmdbId(key) + '/content_ratings'));
  return fskFromReleaseDates(await request('/movie/' + tmdbId(key) + '/release_dates'));
}

/* Details zu einem Film oder einer Serie (key = m123 / t123 oder Film-ID) */
export async function details(key) {
  if (isTv(key)) return tvDetails(tmdbId(key));
  return movieDetails(tmdbId(key));
}

/* Alle Details zu einer Serie (Titel, Staffeln, Folgen, FSK, Trailer). */
async function tvDetails(id) {
  const m = await request('/tv/' + id, { append_to_response: 'content_ratings' });
  const originalLanguage = m.original_language || null;
  const originalTitle = m.original_name || m.name || ('Serie ' + m.id);
  let titleEn = originalTitle;
  if (originalLanguage !== 'en') {
    try {
      const en = await request('/tv/' + id, { language: 'en-US' });
      if (en && en.name) titleEn = en.name;
    } catch (e) { /* ohne englischen Titel weiter */ }
  }
  let trailer = null;
  try {
    const langs = [originalLanguage, 'en', 'de', 'null'].filter(Boolean);
    const v = await request('/tv/' + id + '/videos', { language: 'en-US', include_video_language: Array.from(new Set(langs)).join(',') });
    trailer = pickTrailer(v.results, originalLanguage);
  } catch (e) { /* kein Trailer */ }
  return {
    id: m.id,
    type: 'tv',
    title: originalTitle,
    originalTitle: originalTitle,
    originalLanguage: originalLanguage,
    titleEn: titleEn,
    titleDe: m.name || null,
    year: yearOf(m.first_air_date),
    releaseDate: m.first_air_date || null,
    runtime: null,
    seasons: m.number_of_seasons || null,
    episodes: m.number_of_episodes || null,
    episodeRuntime: (m.episode_run_time && m.episode_run_time[0]) || (m.last_episode_to_air && m.last_episode_to_air.runtime) || null,
    genres: (m.genres || []).map(g => g.name),
    overview: m.overview || '',
    posterPath: m.poster_path || null,
    rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : null,
    trailerKey: trailer ? trailer.key : null,
    trailerLanguage: trailer ? trailer.language : null,
    fsk: fskFromContentRatings(m.content_ratings),
    fskChecked: true,
    collectionId: null,
    collectionChecked: true
  };
}

/* Alle Details zu einem Film (inkl. englischem Titel, Trailer, FSK). */
async function movieDetails(id) {
  const m = await request('/movie/' + id, { append_to_response: 'release_dates' });
  const originalLanguage = m.original_language || null;
  const originalTitle = m.original_title || m.title || ('Film ' + m.id);

  let titleEn = originalTitle;
  if (originalLanguage !== 'en') {
    try {
      const en = await request('/movie/' + id, { language: 'en-US' });
      if (en && en.title) titleEn = en.title;
    } catch (e) { /* ohne englischen Titel weiter */ }
  }

  let trailer = null;
  try {
    const langs = [originalLanguage, 'en', 'de', 'null'].filter(Boolean);
    const v = await request('/movie/' + id + '/videos', {
      language: 'en-US',
      include_video_language: Array.from(new Set(langs)).join(',')
    });
    trailer = pickTrailer(v.results, originalLanguage);
  } catch (e) { /* kein Trailer – später YouTube-Suche */ }

  return {
    id: m.id,
    type: 'movie',
    title: originalTitle,
    originalTitle: originalTitle,
    originalLanguage: originalLanguage,
    titleEn: titleEn,
    titleDe: m.title || null,
    year: yearOf(m.release_date),
    releaseDate: m.release_date || null,
    runtime: m.runtime || null,
    genres: (m.genres || []).map(g => g.name),
    overview: m.overview || '',
    posterPath: m.poster_path || null,
    rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : null,
    trailerKey: trailer ? trailer.key : null,
    trailerLanguage: trailer ? trailer.language : null,
    fsk: fskFromReleaseDates(m.release_dates),
    fskChecked: true,
    collectionId: m.belongs_to_collection ? m.belongs_to_collection.id : null,
    collectionChecked: true
  };
}

/* Zu welcher Filmreihe gehört ein Film? (für ältere Einträge ohne diese Angabe) */
export async function collectionOf(key) {
  if (isTv(key)) return null;
  const m = await request('/movie/' + tmdbId(key));
  return m.belongs_to_collection ? m.belongs_to_collection.id : null;
}

/* Alle Teile einer Filmreihe */
export async function collectionParts(collectionId) {
  const c = await request('/collection/' + collectionId, { language: 'en-US' });
  return {
    name: c.name || '',
    parts: (c.parts || []).map(p => ({
      id: p.id,
      title: p.original_title || p.title,
      titleEn: p.title,
      originalLanguage: p.original_language || null,
      subtitle: (!isDeOrEn(p.original_language) && p.title && p.title !== p.original_title) ? p.title : null,
      release_date: p.release_date || '',
      year: yearOf(p.release_date),
      posterPath: p.poster_path || null
    }))
  };
}

/* Zweite Titelzeile: englischer Titel, wenn das Original weder deutsch noch englisch ist. */
export function subtitleOf(movie) {
  if (isDeOrEn(movie.originalLanguage)) return null;
  const main = movie.originalTitle || movie.title;
  return movie.titleEn && movie.titleEn !== main ? movie.titleEn : null;
}

export function posterUrl(path, size) {
  return path ? IMG + (size || 'w342') + path : null;
}

/* Trailer-Link: direkter YouTube-Link, sonst YouTube-Suche. */
export function trailerUrl(movie) {
  if (movie.trailerKey) return 'https://www.youtube.com/watch?v=' + movie.trailerKey;
  const q = [movie.originalTitle || movie.title, movie.year, movie.type === 'tv' ? 'series trailer' : 'trailer'].filter(Boolean).join(' ');
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
}
