/*
 * Filmabend – Oberfläche
 * -----------------------
 * Persönliche Watchlist, Gruppen (= gemeinsame Listen aus den persönlichen
 * Listen aller Mitglieder), Filter, Zufallsfilm und Abstimmungen.
 *
 *   tmdb.js   Filmdaten, Trailer, FSK
 *   db.js     Firestore (Profile, Listen, Gruppen, Abstimmungen)
 *   logic.js  Filter, Zusammenführen, Bedingungen, Auszählung
 */
import * as TMDB from './tmdb.js?v=__V__';
import * as L from './logic.js?v=__V__';
import * as DB from './db.js?v=__V__';

/* ====================================================================
   Zustand
   ==================================================================== */
const LS = {
  user: 'filmabend:user',
  space: 'filmabend:space',
  filtersOpen: 'filmabend:filtersOpen'
};

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* egal */ }
}

const S = {
  connected: false,
  userId: lsGet(LS.user),
  users: {}, usersLoaded: false,
  movies: {}, moviesLoaded: false,
  lists: {},                 // uid → { watch, seen }
  groups: {}, groupsLoaded: false,
  votes: {},                 // groupId → { voteId: vote }
  space: lsGet(LS.space) || 'me',
  tab: { me: 'watch', group: 'list' },
  filters: L.emptyFilters(),
  sortKey: 'added_desc',
  pickedId: null,
  form: null,                // Formular "Neue Abstimmung"
  pendingJoin: null,         // Einladungscode aus dem Link
  loginPending: null,
  usersFromServer: false,
  expectGroup: null          // gerade erstellt/beigetreten, noch nicht im Abo angekommen
};

const subs = { lists: new Map(), votes: new Map(), groups: null };

/* ====================================================================
   Hilfsfunktionen
   ==================================================================== */
const $ = id => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(t) {
  if (!t) return '';
  const d = new Date(typeof t === 'number' ? t : String(t));
  return isNaN(d) ? '' : d.toLocaleDateString('de-CH');
}

function fmtRuntime(min) {
  if (!min) return '–';
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return m + ' min';
  return h + ' h' + (m ? ' ' + m + ' min' : '');
}

function languageName(code) {
  if (!code) return null;
  try { return new Intl.DisplayNames(['de'], { type: 'language' }).of(code); }
  catch (e) { return code.toUpperCase(); }
}

const nameOf = uid => (S.users[uid] && S.users[uid].name) || '…';
const titleOf = m => (m && (m.originalTitle || m.title)) || 'Film';
const myList = () => S.lists[S.userId] || { watch: {}, seen: {} };
const inMyWatch = id => myList().watch[L.mkey(id)] != null;
const inMySeen = id => myList().seen[L.mkey(id)] != null;
const currentGroup = () => (S.space !== 'me' ? S.groups[S.space] : null);
const namesList = uids => uids.map(nameOf).join(', ');

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
  if (!msg) { el.classList.add('hidden'); return; }
  el.innerHTML = msg;
  el.className = 'banner ' + (kind || 'info');
}

function explainError(e) {
  const code = (e && e.code) || '';
  const msg = (e && e.message) || String(e);
  if (/permission-denied|insufficient permissions/i.test(code + msg)) {
    return 'Keine Berechtigung – sind die Firestore-Regeln veröffentlicht? (README, Schritt 2d)';
  }
  if (/does not exist|not-found.*database|NOT_FOUND/i.test(msg)) {
    return 'Die Firestore-Datenbank existiert noch nicht. (README, Schritt 2b)';
  }
  if (/operation-not-allowed|admin-restricted-operation/i.test(code + msg)) {
    return 'Die anonyme Anmeldung ist in Firebase nicht aktiviert. (README, Schritt 2c)';
  }
  return msg;
}

function fail(e) {
  console.error(e);
  toast('Fehler: ' + explainError(e), true);
}

/* ---------- Dialoge (statt Browser-Popups) ---------- */
let dialogResolve = null;

function openDialog(html) {
  $('dialog-body').innerHTML = html;
  $('dialog').classList.remove('hidden');
  const first = $('dialog-body').querySelector('input:not([readonly])');
  if (first && window.innerWidth > 700) setTimeout(() => first.focus(), 30);
}

function closeDialog(result) {
  $('dialog').classList.add('hidden');
  $('dialog-body').innerHTML = '';
  if (dialogResolve) { const r = dialogResolve; dialogResolve = null; r(!!result); }
  if (pickResolve) { const r = pickResolve; pickResolve = null; r(null); }
  if (inboxOpen) { inboxSkipped.add(inboxOpen); inboxOpen = null; }   // weggeklickt: später nochmals fragen
}

function uiConfirm(text, okLabel, danger) {
  if (dialogResolve) closeDialog(false);
  openDialog(
    '<p class="dlg-text">' + text + '</p>' +
    '<div class="dlg-actions">' +
      '<button type="button" class="btn" data-action="dlg-cancel">Abbrechen</button>' +
      '<button type="button" class="btn ' + (danger ? 'danger-solid' : 'primary') + '" data-action="dlg-ok">' + esc(okLabel || 'OK') + '</button>' +
    '</div>');
  return new Promise(res => { dialogResolve = res; });
}

function openTrailer(m) {
  const a = document.createElement('a');
  a.href = TMDB.trailerUrl(m);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ====================================================================
   Start und Abos
   ==================================================================== */
async function boot() {
  const cfg = window.FILMABEND_CONFIG || {};
  const fb = cfg.firebase || {};

  // Einladungscode aus dem Link merken (…/?join=ABC123)
  const params = new URLSearchParams(location.search);
  if (params.get('join')) {
    S.pendingJoin = L.normalizeCode(params.get('join'));
    params.delete('join');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  }

  initStaticUi();

  if (!fb.apiKey || !fb.projectId) {
    setStatus('off', 'Nicht eingerichtet');
    showBanner('<b>Firebase ist noch nicht eingerichtet.</b> Trage die Werte in <code>docs/config.js</code> ein (README, Schritt 2).', 'warn');
    return;
  }

  try {
    await DB.init(fb, start);
  } catch (e) {
    console.error(e);
    setStatus('off', 'Keine Verbindung');
    showBanner('<b>Verbindung fehlgeschlagen.</b> ' + esc(explainError(e)) + ' Seite neu laden zum erneut Versuchen.', 'warn');
  }
}

function setStatus(kind, text) {
  $('status-dot').className = 'dot ' + kind;
  $('status-text').textContent = text;
}

function onDbError(e) {
  console.error(e);
  showBanner('<b>Datenbank-Fehler:</b> ' + esc(explainError(e)), 'warn');
}

function start() {
  S.connected = true;
  setStatus('live', 'Live verbunden');

  DB.watchUsers((users, fromCache) => {
    S.users = users;
    S.usersLoaded = true;
    if (!fromCache) S.usersFromServer = true;
    // Abmelden nur, wenn der Server bestätigt, dass es das Profil nicht gibt
    if (S.userId && !users[S.userId] && !fromCache) logout(true);
    else if (S.userId && users[S.userId]) onLogin();
    cleanOrphanMembers();
    render();
  }, onDbError);

  DB.watchMovies(movies => {
    const out = {};
    Object.values(movies).forEach(m => { if (m && m.id) out[m.id] = m; });
    S.movies = out;
    S.moviesLoaded = true;
    render();
    backfillFsk();
  }, onDbError);

  render();
}

let loginStarted = false;
async function onLogin() {
  if (!S.userId || loginStarted) return;
  loginStarted = true;
  try { await DB.ensureList(S.userId); } catch (e) { onDbError(e); }
  syncListSubs();
  subs.groups = DB.watchMyGroups(S.userId, groups => {
    S.groups = groups;
    S.groupsLoaded = true;
    cleanOrphanMembers();
    syncListSubs();
    syncVoteSubs();
    handlePendingJoin();
    render();
  }, onDbError);
}

function logout(silent) {
  loginStarted = false;
  if (subs.groups) { subs.groups(); subs.groups = null; }
  subs.lists.forEach(u => u()); subs.lists.clear();
  subs.votes.forEach(u => u()); subs.votes.clear();
  S.userId = null;
  S.lists = {}; S.groups = {}; S.votes = {}; S.groupsLoaded = false;
  S.space = 'me';
  lsSet(LS.user, null);
  if (!silent) toast('Abgemeldet');
  render();
}

/* Gruppenmitglieder ohne Profil (z.B. nach einer abgebrochenen Anmeldung)
   erscheinen sonst als unbekannte Person – sie werden aus der Gruppe genommen. */
const orphanDone = new Set();
function cleanOrphanMembers() {
  if (!S.usersFromServer || !S.groupsLoaded) return;
  Object.entries(S.groups).forEach(([gid, g]) => {
    (g.members || []).forEach(uid => {
      const key = gid + '/' + uid;
      if (S.users[uid] || orphanDone.has(key)) return;
      orphanDone.add(key);
      DB.leaveGroup(gid, uid).catch(e => console.warn('Aufräumen', key, e));
    });
  });
}

/* Listen aller Personen abonnieren, die man sehen muss: ich + Mitglieder meiner Gruppen */
function syncListSubs() {
  const needed = new Set([S.userId]);
  Object.values(S.groups).forEach(g => (g.members || []).forEach(uid => needed.add(uid)));
  subs.lists.forEach((unsub, uid) => {
    if (!needed.has(uid)) { unsub(); subs.lists.delete(uid); delete S.lists[uid]; }
  });
  needed.forEach(uid => {
    if (!uid || subs.lists.has(uid)) return;
    subs.lists.set(uid, DB.watchList(uid, list => { S.lists[uid] = list; render(); }, onDbError));
  });
}

function syncVoteSubs() {
  subs.votes.forEach((unsub, gid) => {
    if (!S.groups[gid]) { unsub(); subs.votes.delete(gid); delete S.votes[gid]; }
  });
  Object.keys(S.groups).forEach(gid => {
    if (subs.votes.has(gid)) return;
    subs.votes.set(gid, DB.watchVotes(gid, votes => { S.votes[gid] = votes; render(); }, onDbError));
  });
}

/* FSK für ältere Filme nachtragen (einmal pro Film, von irgendeinem Gerät) */
let fskBusy = false;
let fskDone = 0;
async function backfillFsk() {
  if (fskBusy || !S.userId || !TMDB.hasKey()) return;
  fskBusy = true;
  try {
    const todo = Object.values(S.movies).filter(m => !m.fskChecked);
    for (const m of todo) {
      if (fskDone >= 60) break;                      // pro Seitenaufruf begrenzt
      fskDone++;
      try {
        const fsk = await TMDB.fsk(m.id);
        await DB.saveMovie({ id: m.id, title: m.title || titleOf(m), fsk, fskChecked: true });
      } catch (e) { console.warn('FSK für', m.id, e); }
      await new Promise(r => setTimeout(r, 250));
    }
  } finally { fskBusy = false; }
}

/* ====================================================================
   Anmeldung (nur Name)
   ==================================================================== */
function findUserByName(name) {
  const low = name.trim().toLowerCase();
  return Object.entries(S.users).find(([, u]) => u.nameLower === low);
}

function loginAs(uid) {
  S.userId = uid;
  S.loginPending = null;
  lsSet(LS.user, uid);
  $('login-name').value = '';
  toast('Angemeldet als ' + nameOf(uid));
  onLogin();
  render();
}

function submitLogin() {
  const name = $('login-name').value.trim().replace(/\s+/g, ' ');
  if (!name) { toast('Bitte einen Namen eingeben.', true); return; }
  if (!S.usersLoaded) { toast('Noch nicht verbunden – bitte kurz warten.', true); return; }
  const found = findUserByName(name);
  if (found) { loginAs(found[0]); return; }
  // Erst ein neues Profil anbieten, wenn die Profilliste sicher vom Server kommt (sonst Doppelprofile)
  if (!S.usersFromServer) { toast('Verbinde mit der Datenbank … bitte nochmals tippen.', true); return; }
  S.loginPending = name;
  renderLogin();
}

async function registerPending() {
  const name = S.loginPending;
  if (!name) return;
  if (findUserByName(name)) { loginAs(findUserByName(name)[0]); return; }
  try {
    const uid = await DB.createUser(name);
    S.users[uid] = S.users[uid] || { name, nameLower: name.toLowerCase() };
    loginAs(uid);
    toast('Willkommen, ' + name + '!');
  } catch (e) { fail(e); }
}

function renderLogin() {
  const box = $('login-confirm');
  if (S.loginPending) {
    box.innerHTML =
      '<p>Es gibt noch kein Profil „<b>' + esc(S.loginPending) + '</b>“. Neu anlegen?</p>' +
      '<div class="dlg-actions left">' +
        '<button type="button" class="btn primary" data-action="login-register">Profil anlegen</button>' +
        '<button type="button" class="btn" data-action="login-cancel">Abbrechen</button>' +
      '</div>';
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
  const known = Object.entries(S.users).filter(([, u]) => u && u.name).sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'));
  $('login-known').innerHTML = known.length
    ? '<span class="muted">Schon dabei:</span> ' +
      known.map(([uid, u]) => '<button type="button" class="chip" data-action="login-as" data-uid="' + esc(uid) + '">' + esc(u.name) + '</button>').join('')
    : '';
}

/* ====================================================================
   Persönliche Liste – Aktionen
   ==================================================================== */
/* ---------- Hilfen für Listen und Gruppen ---------- */
const myGroupIds = () => Object.keys(S.groups).sort((a, b) => S.groups[a].name.localeCompare(S.groups[b].name, 'de'));
const gName = gid => (S.groups[gid] && S.groups[gid].name) || 'Gruppe';
const shareKey = (gid, id) => 'share.' + gid + '.' + L.mkey(id);
const iShare = (gid, id) => L.sharesIn(myList(), gid, id);
const inGroupList = (gid, id) => ((S.groups[gid] && S.groups[gid].members) || []).some(uid => L.sharesIn(S.lists[uid], gid, id));

/* Felder, um die Gruppen-Freigabe einer Person anzulegen (ältere Daten:
   bisher galt die ganze Watchlist als geteilt → wird übernommen). */
function initFields(uid, gid, exceptId) {
  const list = S.lists[uid];
  if (!list || (list.shareInit && list.shareInit[gid])) return {};
  const f = { ['shareInit.' + gid]: true };
  const watch = list.watch || {};
  const copy = {};
  Object.keys(watch).forEach(k => { if (exceptId == null || k !== L.mkey(exceptId)) copy[k] = watch[k]; });
  f['share.' + gid] = copy;
  return f;
}

/* Freigabe eines Films in einer Gruppe setzen (value = Zeit) oder löschen (null),
   inkl. Anlegen der Freigabe – ohne überlappende Feldpfade */
function shareFields(uid, gid, id, value) {
  const f = initFields(uid, gid);
  if (Object.keys(f).length) {
    const copy = f['share.' + gid];
    if (value == null) delete copy[L.mkey(id)]; else copy[L.mkey(id)] = value;
    return f;
  }
  return { [shareKey(gid, id)]: value };
}

/* Bestehende Gruppen ohne eigene Freigabe einmalig anlegen (Daten von vorher) */
const initSkip = new Set();
let initBusy = false, initPaused = 0;
async function initMyShares() {
  const l = S.lists[S.userId];
  if (initBusy || initPaused || !l || !S.groupsLoaded) return;
  const fields = {};
  Object.keys(S.groups).forEach(gid => { if (!initSkip.has(gid)) Object.assign(fields, initFields(S.userId, gid)); });
  if (!Object.keys(fields).length) return;
  initBusy = true;
  try { await DB.patchList(S.userId, fields); } catch (e) { onDbError(e); } finally { initBusy = false; }
}

/* Dialog mit Ankreuzfeldern. items: [{value, label, checked, disabled, note}]
   → Promise: Liste der angekreuzten (aktiven) Werte, oder null bei Abbrechen */
let pickResolve = null;
function uiPick(html, items, okLabel, danger) {
  if (dialogResolve) closeDialog(false);
  if (pickResolve) { pickResolve(null); pickResolve = null; }
  openDialog(html +
    (items.length ? '<div class="picks">' + items.map(it =>
      '<label class="pick' + (it.disabled ? ' disabled' : '') + '"><input type="checkbox" name="pick" value="' + esc(it.value) + '"' +
        (it.checked ? ' checked' : '') + (it.disabled ? ' disabled' : '') + '><span>' + it.label +
        (it.note ? ' <span class="muted small">' + esc(it.note) + '</span>' : '') + '</span></label>').join('') + '</div>' : '') +
    (items.filter(it => !it.disabled).length > 2
      ? '<div class="pick-all"><button type="button" class="linkbtn" data-action="pick-all">Alle</button> · <button type="button" class="linkbtn" data-action="pick-none">Keine</button></div>' : '') +
    '<div class="dlg-actions">' +
      '<button type="button" class="btn" data-action="pick-cancel">Abbrechen</button>' +
      '<button type="button" class="btn ' + (danger ? 'danger-solid' : 'primary') + '" data-action="pick-ok">' + esc(okLabel) + '</button>' +
    '</div>');
  return new Promise(res => { pickResolve = res; });
}

function finishPick(ok) {
  const vals = ok ? Array.from($('dialog-body').querySelectorAll('input[name="pick"]:checked:not(:disabled)')).map(i => i.value) : null;
  const r = pickResolve;
  pickResolve = null;
  closeDialog(false);
  if (r) r(vals);
}

async function ensureMovie(id) {
  if (!S.movies[id] || !S.movies[id].fskChecked) {
    const d = await TMDB.details(id);
    await DB.saveMovie(d);
    S.movies[d.id] = Object.assign({}, S.movies[d.id], d);
  }
}

/* ---------- Hinzufügen: wohin? ---------- */
async function addMovie(result) {
  const id = result.id;
  const gids = myGroupIds();
  const here = currentGroup() ? S.space : null;
  closeSearch();
  let targets;
  if (!gids.length) {
    if (inMyWatch(id)) { toast('Ist schon auf deiner Liste.'); return; }
    targets = ['me'];
  } else {
    const items = [{ value: 'me', label: '🔒 Meine Liste <span class="muted small">(privat)</span>', checked: true,
      disabled: inMyWatch(id), note: inMyWatch(id) ? '– schon drauf' : '' }]
      .concat(gids.map(gid => ({
        value: gid, label: '👥 ' + esc(gName(gid)),
        checked: iShare(gid, id) || (here ? gid === here : true),
        disabled: iShare(gid, id), note: iShare(gid, id) ? '– schon drin' : ''
      })));
    if (items.every(it => it.disabled)) { toast('„' + result.title + '“ ist schon überall drin.'); return; }
    targets = await uiPick('<h3>„' + esc(result.title) + '“ hinzufügen</h3>' +
      '<p class="muted">Auf welche Listen? In Gruppen sehen ihn alle Mitglieder.</p>', items, 'Hinzufügen');
    if (!targets) return;
    if (!targets.length) { toast('Nichts ausgewählt.'); return; }
  }

  const input = $('search-input');
  input.disabled = true;
  $('search-hint').textContent = '„' + result.title + '“ wird hinzugefügt …';
  try {
    await ensureMovie(id);
    const t = Date.now();
    const fields = {};
    if (targets.includes('me')) fields['watch.' + L.mkey(id)] = t;
    targets.filter(x => x !== 'me').forEach(gid => Object.assign(fields, shareFields(S.userId, gid, id, t)));
    await DB.patchList(S.userId, fields);
    const names = targets.map(x => x === 'me' ? 'deine Liste' : '„' + gName(x) + '“');
    toast('„' + result.title + '“ → ' + names.join(', '));
    input.value = '';
  } catch (e) {
    fail(e);
  } finally {
    input.disabled = false;
    $('search-hint').textContent = searchHint();
  }
}

/* ---------- Von der privaten Liste entfernen ---------- */
async function removeFromPrivate(id) {
  const m = S.movies[id];
  const shared = myGroupIds().filter(gid => iShare(gid, id));
  let groups = [];
  if (shared.length) {
    groups = await uiPick('<h3>„' + esc(titleOf(m)) + '“ entfernen</h3>' +
      '<p class="muted">Von deiner Liste entfernen. Auch aus diesen Gruppen nehmen?<br>' +
      '<span class="small">(Wollen ihn dort andere auch sehen, bleibt er für sie drin.)</span></p>',
      shared.map(gid => ({ value: gid, label: '👥 ' + esc(gName(gid)), checked: true })), 'Entfernen', true);
    if (!groups) return;
  } else if (!await uiConfirm('„<b>' + esc(titleOf(m)) + '</b>“ von deiner Liste entfernen?', 'Entfernen', true)) return;
  try {
    const fields = { ['watch.' + L.mkey(id)]: null };
    groups.forEach(gid => Object.assign(fields, shareFields(S.userId, gid, id, null)));
    await DB.patchList(S.userId, fields);
    toast('„' + titleOf(m) + '“ entfernt' + (groups.length ? ' (auch aus ' + groups.length + (groups.length > 1 ? ' Gruppen)' : ' Gruppe)') : ''));
  } catch (e) { fail(e); }
}

async function removeFromSeen(id) {
  if (!await uiConfirm('„<b>' + esc(titleOf(S.movies[id])) + '</b>“ aus deinen gesehenen Filmen entfernen?', 'Entfernen', true)) return;
  try { await DB.patchList(S.userId, { ['seen.' + L.mkey(id)]: null }); toast('Entfernt'); }
  catch (e) { fail(e); }
}

async function backToList(id) {
  try {
    await DB.patchList(S.userId, { ['seen.' + L.mkey(id)]: null, ['watch.' + L.mkey(id)]: Date.now() });
    toast('„' + titleOf(S.movies[id]) + '“ ist wieder auf deiner Liste');
  } catch (e) { fail(e); }
}

/* ---------- In einer Gruppe ---------- */
async function toggleGroupWant(gid, id) {
  const on = !iShare(gid, id);
  try {
    await DB.patchList(S.userId, shareFields(S.userId, gid, id, on ? Date.now() : null));
    toast(on ? 'Du willst ihn in „' + gName(gid) + '“ auch sehen' : 'Dein Wunsch in „' + gName(gid) + '“ ist entfernt');
  } catch (e) { fail(e); }
}

/* Film für alle aus einer Gruppe nehmen (private Listen bleiben) */
async function removeFromGroup(gid, id) {
  const g = S.groups[gid];
  const wanters = (g.members || []).filter(uid => L.sharesIn(S.lists[uid], gid, id));
  const others = wanters.filter(uid => uid !== S.userId);
  const text = '„<b>' + esc(titleOf(S.movies[id])) + '</b>“ aus „' + esc(g.name) + '“ entfernen?' +
    (others.length ? '<br><span class="muted">Gewünscht von ' + esc(namesList(wanters)) + ' – er verschwindet für alle aus dieser Gruppe.</span>' : '') +
    '<br><span class="muted">Auf den privaten Listen bleibt er.</span>';
  if (!await uiConfirm(text, 'Entfernen', true)) return;
  try {
    await Promise.all(wanters.map(uid => DB.patchList(uid, shareFields(uid, gid, id, null))));
    toast('Aus „' + g.name + '“ entfernt');
  } catch (e) { fail(e); }
}

/* ---------- Gesehen ---------- */
async function markSeen(id, contextGid) {
  const m = S.movies[id];
  const groups = myGroupIds().filter(gid => inGroupList(gid, id));
  let together = [];
  if (groups.length) {
    together = await uiPick('<h3>„' + esc(titleOf(m)) + '“ gesehen</h3>' +
      '<p class="muted">Mit welcher Gruppe hast du ihn geschaut? Dort wird er von der gemeinsamen Liste genommen. ' +
      'Wer ihn auch auf seiner Liste hat, wird beim nächsten Öffnen gefragt, ob er ihn ebenfalls entfernen will.</p>',
      groups.map(gid => ({ value: gid, label: '👥 ' + esc(gName(gid)), checked: gid === contextGid })), 'Als gesehen markieren');
    if (!together) return;
  }
  try {
    const t = Date.now();
    const k = L.mkey(id);
    // ich: gesehen, von privater Liste und allen meinen Freigaben weg
    const mine = { ['seen.' + k]: t, ['watch.' + k]: null };
    myGroupIds().forEach(gid => Object.assign(mine, shareFields(S.userId, gid, id, null)));
    const perUser = new Map([[S.userId, mine]]);
    let asked = 0;
    // die anderen in den gewählten Gruppen
    together.forEach(gid => {
      (S.groups[gid].members || []).forEach(uid => {
        if (uid === S.userId) return;
        const l = S.lists[uid];
        if (!l) return;
        const shares = L.sharesIn(l, gid, id), priv = (l.watch || {})[k] != null;
        if (!shares && !priv) return;
        const f = perUser.get(uid) || {};
        Object.assign(f, shareFields(uid, gid, id, null));
        if ((l.seen || {})[k] == null && !Object.keys(f).some(x => x.startsWith('inbox.') && f[x].movieId === id)) {
          f['inbox.n' + t.toString(36) + Math.random().toString(36).slice(2, 6)] = { movieId: id, by: S.userId, gid, at: t };
          asked++;
        }
        perUser.set(uid, f);
      });
    });
    await Promise.all(Array.from(perUser.entries()).map(([uid, f]) => DB.patchList(uid, f)));
    if (S.pickedId === id) S.pickedId = null;
    toast('„' + titleOf(m) + '“ als gesehen markiert' + (asked ? ' – ' + asked + (asked > 1 ? ' Personen werden' : ' Person wird') + ' gefragt' : ''));
  } catch (e) { fail(e); }
}

async function unmarkSeen(id) {
  try {
    await DB.patchList(S.userId, { ['seen.' + L.mkey(id)]: null });
    toast('Nicht mehr als gesehen markiert');
  } catch (e) { fail(e); }
}

/* ---------- Rückfragen: "X hat Y gesehen – auch entfernen?" ---------- */
let inboxOpen = null;
const inboxSkipped = new Set();
function checkInbox() {
  if (inboxOpen || !S.userId || !S.moviesLoaded || !$('dialog').classList.contains('hidden')) return;
  const l = S.lists[S.userId];
  if (!l || !l.inbox) return;
  const entries = Object.entries(l.inbox).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  for (const [key, n] of entries) {
    if (inboxSkipped.has(key)) continue;
    const id = n.movieId, k = L.mkey(id);
    const m = S.movies[id];
    if (!m) continue;
    if ((l.seen || {})[k] != null) {
      DB.patchList(S.userId, { ['inbox.' + key]: null }).catch(() => {});
      continue;
    }
    inboxOpen = key;
    const priv = (l.watch || {})[k] != null;
    const btn = (choice, label, primary) => '<button type="button" class="btn' + (primary ? ' primary' : '') + '" data-action="inbox" data-choice="' + choice +
      '" data-key="' + esc(key) + '" data-id="' + id + '">' + label + '</button>';
    openDialog(
      '<h3>🎬 Schon gesehen?</h3>' +
      '<p><b>' + esc(nameOf(n.by)) + '</b> hat „<b>' + esc(titleOf(m)) + '</b>“' +
        (S.groups[n.gid] ? ' mit „' + esc(gName(n.gid)) + '“' : '') + ' geschaut. Er ist dort von der gemeinsamen Liste genommen.</p>' +
      '<p class="muted">' + (priv ? 'Er ist auch auf deiner privaten Liste. Was soll damit passieren?' : 'Willst du ihn noch sehen?') + '</p>' +
      '<div class="inbox-actions">' +
        btn('seen', '👁 Ich war dabei – als gesehen markieren', true) +
        (priv ? btn('keep', 'Behalten – ich will ihn noch sehen') + btn('remove', 'Von meiner Liste entfernen')
              : btn('keep', 'Ja – auf meine private Liste setzen') + btn('remove', 'Nein, nicht nötig')) +
      '</div>');
    return;
  }
}

async function answerInbox(key, id, choice) {
  inboxOpen = null;
  closeDialog(false);
  const k = L.mkey(id), t = Date.now();
  const f = { ['inbox.' + key]: null };
  if (choice === 'keep') {
    if (!inMyWatch(id)) f['watch.' + k] = t;
  } else {
    f['watch.' + k] = null;
    myGroupIds().forEach(gid => Object.assign(f, shareFields(S.userId, gid, id, null)));
    if (choice === 'seen') f['seen.' + k] = t;
  }
  try {
    await DB.patchList(S.userId, f);
    toast(choice === 'keep' ? 'Bleibt auf deiner Liste' : choice === 'seen' ? 'Als gesehen markiert' : 'Entfernt');
  } catch (e) { fail(e); }
  setTimeout(checkInbox, 400);
}

/* ---------- Beim Beitreten: Gruppenliste auf die eigene Liste übernehmen? ---------- */
async function askTakeGroupList(gid, name) {
  // warten, bis die Listen der Mitglieder geladen sind (max. ~4 s)
  for (let i = 0; i < 40; i++) {
    const g = S.groups[gid];
    if (g && (g.members || []).every(uid => S.lists[uid])) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const g = S.groups[gid];
  if (!g) return;
  const ids = L.groupEntries(g.members || [], S.lists, S.movies, gid)
    .map(e => e.id).filter(id => !inMyWatch(id) && !inMySeen(id));
  if (!ids.length) return;
  const ok = await uiConfirm('In „' + esc(name || gName(gid)) + '“ sind <b>' + ids.length + (ids.length === 1 ? ' Film' : ' Filme') +
    '</b>, die nicht auf deiner privaten Liste sind. Alle auf deine Liste übernehmen?' +
    '<br><span class="muted">Oder später einzeln mit „＋ Meine Liste“ auf den Filmkarten.</span>', 'Alle übernehmen');
  if (!ok) return;
  const t = Date.now();
  const f = {};
  ids.forEach(id => { f['watch.' + L.mkey(id)] = t; });
  try { await DB.patchList(S.userId, f); toast(ids.length + ' Filme auf deine Liste übernommen'); }
  catch (e) { fail(e); }
}

async function addToPrivate(id) {
  try {
    await DB.patchList(S.userId, { ['watch.' + L.mkey(id)]: Date.now() });
    toast('„' + titleOf(S.movies[id]) + '“ ist jetzt auf deiner Liste');
  } catch (e) { fail(e); }
}

/* ---------- Beim Beitreten/Erstellen: Watchlist teilen? ---------- */
async function askShareAll(gid, name) {
  initSkip.add(gid);
  const watch = myList().watch || {};
  const n = Object.keys(watch).length;
  let share = {};
  if (n) {
    const ok = await uiConfirm('Deine Watchlist (<b>' + n + (n === 1 ? ' Film' : ' Filme') + '</b>) auch in „' + esc(name || gName(gid)) + '“ teilen?' +
      '<br><span class="muted">Einzelne Filme kannst du später jederzeit hinzufügen oder entfernen.</span>', 'Alle teilen');
    if (ok) share = Object.assign({}, watch);
  }
  try { await DB.patchList(S.userId, { ['shareInit.' + gid]: true, ['share.' + gid]: share }); }
  catch (e) { fail(e); }
  initSkip.delete(gid);
}

/* ====================================================================
   Gruppen
   ==================================================================== */
async function createGroup(name) {
  name = name.trim();
  if (!name) { toast('Bitte einen Namen für die Gruppe eingeben.', true); return; }
  initPaused++;
  try {
    const g = await DB.createGroup(name, S.userId, L.makeCode);
    initSkip.add(g.id);
    closeDialog();
    S.expectGroup = g.id;
    S.space = g.id; lsSet(LS.space, g.id);
    S.tab.group = 'list';
    S.filters = L.emptyFilters();
    toast('Gruppe „' + name + '“ erstellt');
    render();
    await askShareAll(g.id, name);
    openInvite(g.id, name, g.code);
  } catch (e) { fail(e); }
  finally { initPaused--; }
}

async function joinByCode(code, silentIfMember) {
  code = L.normalizeCode(code);
  if (code.length !== 6) { toast('Der Code hat 6 Zeichen.', true); return; }
  initPaused++;
  try {
    const g = await DB.findGroupByCode(code);
    if (!g) { toast('Keine Gruppe mit dem Code ' + code + ' gefunden.', true); return; }
    let joined = false;
    if ((g.members || []).includes(S.userId)) {
      if (!silentIfMember) toast('Du bist schon in „' + g.name + '“');
    } else {
      initSkip.add(g.id);
      await DB.joinGroup(g.id, S.userId);
      joined = true;
      toast('Willkommen in „' + g.name + '“!');
    }
    closeDialog();
    S.expectGroup = g.id;
    S.space = g.id; lsSet(LS.space, g.id);
    S.tab.group = 'list';
    S.filters = L.emptyFilters();
    render();
    if (joined) { await askShareAll(g.id, g.name); await askTakeGroupList(g.id, g.name); }
  } catch (e) { fail(e); }
  finally { initPaused--; }
}

async function handlePendingJoin() {
  if (!S.pendingJoin || !S.userId || !S.groupsLoaded) return;
  const code = S.pendingJoin;
  S.pendingJoin = null;
  try {
    const g = await DB.findGroupByCode(code);
    if (!g) { toast('Die Einladung ist ungültig (Code ' + code + ').', true); return; }
    if ((g.members || []).includes(S.userId)) { switchSpace(g.id); return; }
    const ok = await uiConfirm('Der Gruppe „<b>' + esc(g.name) + '</b>“ beitreten?' +
      '<br><span class="muted">Mitglieder: ' + esc(namesList(g.members || [])) + '</span>', 'Beitreten');
    if (ok) joinByCode(code);
  } catch (e) { fail(e); }
}

async function leaveGroup(gid) {
  const g = S.groups[gid];
  if (!g) return;
  if (!await uiConfirm('Die Gruppe „<b>' + esc(g.name) + '</b>“ verlassen? Deine persönliche Liste bleibt erhalten.', 'Verlassen', true)) return;
  try {
    await DB.leaveGroup(gid, S.userId);
    switchSpace('me');
    toast('Gruppe verlassen');
  } catch (e) { fail(e); }
}

function inviteLink(code) {
  return location.origin + location.pathname + '?join=' + code;
}

function openInvite(gid, name, code) {
  const g = S.groups[gid] || { name, code };
  const link = inviteLink(g.code);
  openDialog(
    '<h3>Leute einladen</h3>' +
    '<p class="muted">Schick diesen Link oder den Code an alle, die in „' + esc(g.name) + '“ mitmachen sollen.</p>' +
    '<div class="invite-code">' + esc(g.code) + '</div>' +
    '<input type="text" class="invite-link" readonly value="' + esc(link) + '" aria-label="Einladungslink">' +
    '<div class="dlg-actions">' +
      (navigator.share ? '<button type="button" class="btn" data-action="share-invite" data-link="' + esc(link) + '" data-name="' + esc(g.name) + '">Teilen …</button>' : '') +
      '<button type="button" class="btn primary" data-action="copy-invite" data-link="' + esc(link) + '">Link kopieren</button>' +
      '<button type="button" class="btn" data-action="dlg-cancel">Schliessen</button>' +
    '</div>');
}

function openNewGroup() {
  openDialog(
    '<h3>Neue Gruppe</h3>' +
    '<form class="dlg-form" data-form="create-group">' +
      '<input type="text" name="name" placeholder="Name, z.B. WG oder Filmclub" maxlength="40" aria-label="Gruppenname">' +
      '<button type="submit" class="btn primary">Erstellen</button>' +
    '</form>' +
    '<div class="dlg-sep">oder</div>' +
    '<h3>Mit Code beitreten</h3>' +
    '<form class="dlg-form" data-form="join-group">' +
      '<input type="text" name="code" placeholder="6-stelliger Code" maxlength="8" autocapitalize="characters" aria-label="Einladungscode">' +
      '<button type="submit" class="btn">Beitreten</button>' +
    '</form>' +
    '<div class="dlg-actions"><button type="button" class="btn ghost" data-action="dlg-cancel">Schliessen</button></div>');
}

function openRename(gid) {
  const g = S.groups[gid];
  openDialog(
    '<h3>Gruppe umbenennen</h3>' +
    '<form class="dlg-form" data-form="rename-group" data-gid="' + esc(gid) + '">' +
      '<input type="text" name="name" maxlength="40" value="' + esc(g.name) + '" aria-label="Gruppenname">' +
      '<button type="submit" class="btn primary">Speichern</button>' +
    '</form>' +
    '<div class="dlg-actions"><button type="button" class="btn ghost" data-action="dlg-cancel">Abbrechen</button></div>');
}

function openProfile() {
  const l = myList();
  const nWatch = Object.keys(l.watch).length, nSeen = Object.keys(l.seen).length;
  const nGroups = Object.keys(S.groups).length;
  openDialog(
    '<h3>👤 ' + esc(nameOf(S.userId)) + '</h3>' +
    '<p class="muted">' + nWatch + ' auf deiner Liste · ' + nSeen + ' gesehen · ' +
      nGroups + (nGroups === 1 ? ' Gruppe' : ' Gruppen') + '</p>' +
    '<div class="dlg-actions">' +
      '<button type="button" class="btn" data-action="logout">Profil wechseln</button>' +
      '<button type="button" class="btn primary" data-action="dlg-cancel">Schliessen</button>' +
    '</div>');
}

function switchSpace(space) {
  if (S.space !== space) {
    S.space = space;
    S.filters = L.emptyFilters();
    S.pickedId = null;
    S.form = null;
    $('list-search').value = '';
  }
  lsSet(LS.space, space);
  render();
}

/* ====================================================================
   Abstimmungen
   ==================================================================== */
function groupVotes(gid) {
  return Object.entries(S.votes[gid] || {})
    .map(([id, v]) => Object.assign({ id }, v))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function activeVote(gid) {
  return groupVotes(gid).find(v => v.status !== 'closed') || null;
}

/* Muss ich in dieser Abstimmung noch etwas tun? (für den Punkt am Tab) */
function voteNeedsMe(v) {
  if (!v) return false;
  if (v.status === 'nominate') return L.nominationsBy(v, S.userId).length === 0;
  if (v.status === 'vote') return !((v.ballots || {})[S.userId] || []).length;
  return false;
}

function currentGroupEntries() {
  const g = currentGroup();
  if (!g) return [];
  return L.groupEntries(g.members || [], S.lists, S.movies, S.space);
}

function newVoteForm() {
  return {
    title: 'Filmabend ' + new Date().toLocaleDateString('de-CH'),
    method: 'approval', maxNominations: 2,
    maxRuntime: null, maxFsk: null, genres: [],
    seenMode: 'any', seenMax: 1, notBy: []
  };
}

function formConditions(f) {
  return {
    maxRuntime: f.maxRuntime, maxFsk: f.maxFsk, genres: f.genres.slice(),
    seen: { mode: f.seenMode, max: f.seenMax, notBy: f.notBy.slice() }
  };
}

async function startVote() {
  const g = currentGroup();
  const f = S.form;
  if (!g || !f) return;
  const title = (f.title || '').trim() || 'Filmabend';
  if (activeVote(S.space)) { toast('Es läuft schon eine Abstimmung.', true); return; }
  try {
    await DB.createVote(S.space, {
      title: title.slice(0, 60),
      createdBy: S.userId,
      createdAt: Date.now(),
      status: 'nominate',
      method: f.method,
      maxNominations: f.maxNominations,
      conditions: formConditions(f),
      nominations: {},
      ballots: {},
      result: null,
      closedAt: null
    });
    S.form = null;
    toast('Abstimmung gestartet – jetzt Filme nominieren');
    render();
  } catch (e) { fail(e); }
}

async function nominate(v, id, on) {
  if (on && !L.canNominate(v, S.userId)) { toast('Du hast schon ' + v.maxNominations + ' Film(e) nominiert.', true); return; }
  try { await DB.setNomination(S.space, v.id, id, on ? S.userId : null); }
  catch (e) { fail(e); }
}

async function toVotePhase(v) {
  const n = L.nominatedIds(v).length;
  if (n < 2) { toast('Für die Abstimmung braucht es mindestens 2 nominierte Filme.', true); return; }
  if (!await uiConfirm('Nominierung beenden und mit der Abstimmung beginnen? Danach kann nichts mehr nominiert werden.', 'Abstimmung starten')) return;
  try { await DB.updateVote(S.space, v.id, { status: 'vote' }); }
  catch (e) { fail(e); }
}

async function castBallot(v, id) {
  const nominees = L.nominatedIds(v);
  const cur = (v.ballots || {})[S.userId] || [];
  const next = L.toggleBallot(v.method, cur, id, nominees);
  if (v.method === 'ranked' && next.length === cur.length && !cur.includes(id)) {
    toast('Du hast schon ' + next.length + ' Plätze vergeben – tippe einen an, um ihn zu entfernen.');
    return;
  }
  try { await DB.setBallot(S.space, v.id, S.userId, next); }
  catch (e) { fail(e); }
}

async function closeVote(v) {
  const g = currentGroup();
  const voted = Object.keys(v.ballots || {}).filter(uid => (v.ballots[uid] || []).length);
  const missing = (g.members || []).filter(uid => !voted.includes(uid));
  const text = missing.length
    ? 'Noch nicht abgestimmt: <b>' + esc(namesList(missing)) + '</b>. Trotzdem auszählen?'
    : 'Alle haben abgestimmt. Jetzt auszählen?';
  if (!await uiConfirm(text, 'Auszählen')) return;
  const { ranking } = L.tally(v);
  const { winner, tie } = L.decideWinner(ranking);
  try {
    await DB.updateVote(S.space, v.id, {
      status: 'closed',
      closedAt: Date.now(),
      result: { winner, tie, ranking }
    });
    if (winner) toast('🏆 ' + titleOf(S.movies[winner]));
  } catch (e) { fail(e); }
}

async function deleteVote(v) {
  if (!await uiConfirm('Abstimmung „<b>' + esc(v.title) + '</b>“ löschen?', 'Löschen', true)) return;
  try { await DB.deleteVote(S.space, v.id); toast('Abstimmung gelöscht'); }
  catch (e) { fail(e); }
}

/* ====================================================================
   Rendering
   ==================================================================== */
function render() {
  // Kopf
  const me = S.userId && S.users[S.userId];
  $('me-btn').classList.toggle('hidden', !me);
  if (me) $('me-btn').textContent = '👤 ' + me.name;

  if (!S.connected || !S.usersLoaded) return;

  if (!S.userId || !me) {
    $('login').classList.remove('hidden');
    $('main').classList.add('hidden');
    renderLogin();
    return;
  }
  $('login').classList.add('hidden');
  $('main').classList.remove('hidden');

  if (S.expectGroup && S.groups[S.expectGroup]) S.expectGroup = null;
  if (S.space !== 'me' && S.groupsLoaded && !S.groups[S.space] && S.space !== S.expectGroup) { S.space = 'me'; lsSet(LS.space, 'me'); }
  if (S.space !== 'me' && !S.groups[S.space]) {
    // Gruppe kommt gleich an – bis dahin nur kurz warten
    $('main').classList.add('hidden');
    return;
  }

  renderSpaces();
  renderGroupHead();
  renderSubtabs();

  const isVote = !!currentGroup() && S.tab.group === 'vote';
  $('view-list').classList.toggle('hidden', isVote);
  $('view-vote').classList.toggle('hidden', !isVote);
  if (isVote) renderVoteView(); else renderListView();

  initMyShares();
  setTimeout(checkInbox, 0);
}

function renderSpaces() {
  const pills = [];
  const nMine = Object.keys(myList().watch).length;
  pills.push(pill('me', 'Meine Liste', nMine, false));
  Object.entries(S.groups)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'))
    .forEach(([gid, g]) => {
      const v = activeVote(gid);
      pills.push(pill(gid, g.name, null, !!v, voteNeedsMe(v)));
    });
  pills.push('<button type="button" class="space add-space" data-action="new-group">＋ Gruppe</button>');
  $('spaces').innerHTML = pills.join('');
}

function pill(id, label, count, voting, needsMe) {
  const active = S.space === id;
  return '<button type="button" class="space' + (active ? ' active' : '') + '" data-action="space" data-space="' + esc(id) + '">' +
    (id === 'me' ? '' : '👥 ') + esc(label) +
    (count != null ? ' <span class="count">' + count + '</span>' : '') +
    (voting ? ' <span class="vote-flag' + (needsMe ? ' needs' : '') + '" title="Abstimmung läuft">🗳</span>' : '') +
    '</button>';
}

function renderGroupHead() {
  const g = currentGroup();
  const el = $('group-head');
  if (!g) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const members = (g.members || []).slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'de'));
  el.innerHTML =
    '<div class="gh-main">' +
      '<h2>' + esc(g.name) + '</h2>' +
      '<div class="members">' + members.map(uid =>
        '<span class="member' + (uid === S.userId ? ' me' : '') + '">' + esc(nameOf(uid)) + '</span>').join('') +
      '</div>' +
    '</div>' +
    '<div class="gh-actions">' +
      '<button type="button" class="btn primary" data-action="invite">📨 Einladen</button>' +
      '<button type="button" class="btn" data-action="rename-group" title="Umbenennen" aria-label="Umbenennen">✏️</button>' +
      '<button type="button" class="btn danger" data-action="leave-group">Verlassen</button>' +
    '</div>';
}

function renderSubtabs() {
  const g = currentGroup();
  let tabs;
  if (!g) {
    const l = myList();
    tabs = [
      ['watch', 'Watchlist', Object.keys(l.watch).length, S.tab.me === 'watch'],
      ['seen', 'Gesehen', Object.keys(l.seen).length, S.tab.me === 'seen']
    ];
  } else {
    const v = activeVote(S.space);
    tabs = [
      ['list', 'Gemeinsame Liste', currentGroupEntries().length, S.tab.group === 'list'],
      ['vote', 'Abstimmung' + (v ? (voteNeedsMe(v) ? ' 🔴' : ' 🗳') : ''), null, S.tab.group === 'vote']
    ];
  }
  $('subtabs').innerHTML = tabs.map(([key, label, count, active]) =>
    '<button type="button" class="tab' + (active ? ' active' : '') + '" role="tab" aria-selected="' + active +
      '" data-action="subtab" data-tab="' + key + '">' + label +
      (count != null ? ' <span class="count">' + count + '</span>' : '') + '</button>').join('');
}

/* ---------- Liste ---------- */
function currentEntries() {
  if (currentGroup()) return currentGroupEntries();
  return L.personalEntries(myList(), S.movies, S.tab.me === 'seen' ? 'seen' : 'watch');
}

function chip(type, value, label, count, active) {
  return '<button type="button" class="chip' + (active ? ' active' : '') +
    '" data-filter="' + type + '" data-value="' + esc(value) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
    esc(label) + (count != null ? '<span class="n">' + count + '</span>' : '') + '</button>';
}

let sortMode = null;
function renderSort(isGroup) {
  const mode = isGroup ? 'group' : 'me';
  if (sortMode === mode) return;
  sortMode = mode;
  if (!isGroup && L.SORTS[S.sortKey].groupOnly) S.sortKey = 'added_desc';
  $('sort').innerHTML = Object.entries(L.SORTS)
    .filter(([, s]) => isGroup || !s.groupOnly)
    .map(([k, s]) => '<option value="' + k + '">' + esc(s.label) + '</option>').join('');
  $('sort').value = S.sortKey;
}

function renderChips(entries, g) {
  const f = S.filters;

  const genreCount = {};
  entries.forEach(e => (e.movie.genres || []).forEach(x => { genreCount[x] = (genreCount[x] || 0) + 1; }));
  const genres = Object.keys(genreCount).sort((a, b) => a.localeCompare(b, 'de'));
  f.genres.forEach(x => { if (!genreCount[x]) f.genres.delete(x); });
  $('chips-genre').innerHTML = genres.length
    ? genres.map(x => chip('genre', x, x, genreCount[x], f.genres.has(x))).join('')
    : '<span class="muted">–</span>';

  const lengthCount = {};
  entries.forEach(e => { const k = L.lengthBucket(e.movie.runtime); lengthCount[k] = (lengthCount[k] || 0) + 1; });
  $('chips-length').innerHTML = L.LENGTH_BUCKETS
    .filter(b => b.key !== 'unknown' || lengthCount.unknown)
    .map(b => chip('length', b.key, b.label, lengthCount[b.key] || 0, f.lengths.has(b.key))).join('');

  const decadeCount = {};
  entries.forEach(e => { const d = String(L.decadeOf(e.movie.year)); decadeCount[d] = (decadeCount[d] || 0) + 1; });
  const decades = Object.keys(decadeCount).sort((a, b) => a === 'null' ? 1 : b === 'null' ? -1 : Number(b) - Number(a));
  f.decades.forEach(d => { if (!decadeCount[d]) f.decades.delete(d); });
  $('chips-year').innerHTML = decades.length
    ? decades.map(d => chip('decade', d, L.decadeLabel(d === 'null' ? null : Number(d)), decadeCount[d], f.decades.has(d))).join('')
    : '<span class="muted">–</span>';

  if (g) {
    const members = (g.members || []).slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'de'));
    f.notSeenBy.forEach(uid => { if (!members.includes(uid)) f.notSeenBy.delete(uid); });
    $('chips-notseen').innerHTML = members.map(uid => {
      const n = entries.filter(e => e.seenBy.includes(uid)).length;
      return chip('notseen', uid, nameOf(uid), null, f.notSeenBy.has(uid)) .replace('</button>', '<span class="n" title="' + n + ' gesehen">👁 ' + n + '</span></button>');
    }).join('');
    const opts = [['', 'egal']].concat(
      Array.from({ length: Math.max(1, members.length) }, (_, i) => [String(i), i === 0 ? 'niemandem' : i + (i === 1 ? ' Person' : ' Personen')]));
    if (f.maxSeen != null && f.maxSeen >= members.length) f.maxSeen = null;
    $('chips-maxseen').innerHTML = opts.map(([v, label]) =>
      chip('maxseen', v, label, null, (f.maxSeen == null ? '' : String(f.maxSeen)) === v)).join('');
  }
}

function renderListView() {
  const g = currentGroup();
  const isGroup = !!g;
  document.body.classList.toggle('in-group', isGroup);
  $('add-title').textContent = 'Film hinzufügen';
  renderSort(isGroup);

  const entries = currentEntries();
  renderChips(entries, g);

  const list = L.sortEntries(L.applyFilters(entries, S.filters, nameOf), S.sortKey);
  const mode = isGroup ? 'group' : (S.tab.me === 'seen' ? 'seen' : 'watch');

  const grid = $('grid'), empty = $('empty');
  if (!entries.length) {
    grid.innerHTML = '';
    empty.innerHTML = isGroup
      ? 'Noch keine Filme. Die gemeinsame Liste besteht aus den persönlichen Listen aller Mitglieder – füge oben Filme zu deiner Liste hinzu oder lade Leute ein.'
      : (mode === 'seen' ? 'Noch nichts gesehen. Markiere Filme auf deiner Watchlist mit „Gesehen“.' : 'Deine Watchlist ist leer – füge oben den ersten Film hinzu!');
    empty.classList.remove('hidden');
  } else if (!list.length) {
    grid.innerHTML = '';
    empty.textContent = 'Kein Film passt zu den Filtern.';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    grid.innerHTML = list.map(e => renderCard(e, mode)).join('');
  }

  const active = L.activeFilterCount(S.filters);
  const noun = entries.length === 1 ? 'Film' : 'Filme';
  $('summary').textContent = active
    ? list.length + ' von ' + entries.length + ' ' + noun
    : entries.length + ' ' + noun + (isGroup ? ' in der gemeinsamen Liste' : mode === 'seen' ? ' gesehen' : ' auf deiner Watchlist');
  $('reset-filters').classList.toggle('hidden', !active);
  $('filter-count').textContent = active;
  $('filter-count').classList.toggle('hidden', !active);
  $('random').classList.toggle('hidden', mode === 'seen');
  $('search-hint').textContent = $('search-input').disabled ? $('search-hint').textContent : searchHint();
}

function renderCard(e, mode) {
  const m = e.movie;
  const poster = TMDB.posterUrl(m.posterPath);
  const genres = m.genres || [];
  const picked = e.id === S.pickedId;
  const subtitle = TMDB.subtitleOf(m);
  const trailerLang = m.trailerKey ? languageName(m.trailerLanguage) : null;
  const trailerTitle = trailerLang ? 'Trailer auf ' + trailerLang : (m.trailerKey ? 'Trailer' : 'Trailer auf YouTube suchen');
  const meta = [];
  if (m.runtime) meta.push('<span title="' + m.runtime + ' Minuten">⏱ ' + esc(fmtRuntime(m.runtime)) + '</span>');
  if (m.fsk != null) meta.push('<span class="fsk fsk' + m.fsk + '" title="Altersfreigabe">FSK ' + m.fsk + '</span>');
  if (m.rating) meta.push('<span title="TMDB-Bewertung">★ ' + esc(Number(m.rating).toFixed(1)) + '</span>');

  let info = '', actions = '';
  const trailerBtn = '<button type="button" class="btn primary" data-action="trailer" data-id="' + e.id + '" title="' + esc(trailerTitle) + '">' +
    (m.trailerKey ? '▶ Trailer' : '▶ Trailer suchen') + '</button>';

  if (mode === 'watch') {
    info = '<span class="added">auf der Liste seit ' + fmtDate(e.addedAt) + '</span>';
    actions = trailerBtn +
      '<button type="button" class="btn" data-action="seen" data-id="' + e.id + '">✓ Gesehen</button>' +
      '<button type="button" class="btn danger" data-action="remove-watch" data-id="' + e.id + '" title="Entfernen" aria-label="Entfernen">🗑</button>';
  } else if (mode === 'seen') {
    info = '<span class="added">gesehen am ' + fmtDate(e.seenAt) + '</span>';
    actions = trailerBtn +
      '<button type="button" class="btn" data-action="back-to-list" data-id="' + e.id + '">↩ Nochmals schauen</button>' +
      '<button type="button" class="btn danger" data-action="remove-seen" data-id="' + e.id + '" title="Entfernen" aria-label="Entfernen">🗑</button>';
  } else {
    const mine = e.wantedBy.includes(S.userId);
    const iSaw = e.seenBy.includes(S.userId);
    info =
      '<div class="people"><span class="pl">Will sehen:</span> ' + e.wantedBy.map(uid =>
        '<span class="person' + (uid === S.userId ? ' me' : '') + '">' + esc(nameOf(uid)) + '</span>').join('') + '</div>' +
      '<div class="people seen"><span class="pl">Gesehen:</span> ' + (e.seenBy.length
        ? e.seenBy.map(uid => '<span class="person seen' + (uid === S.userId ? ' me' : '') + '">👁 ' + esc(nameOf(uid)) + '</span>').join('')
        : '<span class="nobody">noch niemand</span>') + '</div>' +
      (inMyWatch(e.id) ? '<div class="people"><span class="pl">🔒 auf deiner privaten Liste</span></div>' : '');
    actions = trailerBtn +
      '<button type="button" class="btn' + (mine ? ' on' : '') + '" data-action="toggle-want" data-id="' + e.id + '" title="' +
        (mine ? 'Deinen Wunsch in dieser Gruppe zurücknehmen' : 'Du willst ihn in dieser Gruppe auch sehen') + '">' + (mine ? '🙋 Ich auch ✓' : '🙋 Ich auch') + '</button>' +
      (inMyWatch(e.id) ? '' : '<button type="button" class="btn" data-action="add-private" data-id="' + e.id + '" title="Auf deine private Liste setzen">＋ Meine Liste</button>') +
      '<button type="button" class="btn' + (iSaw ? ' on' : '') + '" data-action="toggle-seen" data-id="' + e.id + '">' +
        (iSaw ? '👁 Gesehen ✓' : '👁 Gesehen?') + '</button>' +
      '<button type="button" class="btn danger" data-action="remove-group" data-id="' + e.id + '" title="Aus dieser Gruppe entfernen" aria-label="Aus dieser Gruppe entfernen">✕</button>';
  }

  return '' +
    '<article class="movie' + (picked ? ' picked' : '') + (mode === 'seen' ? ' watched' : '') +
      '" data-id="' + e.id + '" tabindex="0" role="link" aria-label="Trailer von ' + esc(titleOf(m)) + ' öffnen">' +
      (picked ? '<div class="pick-badge">🎲 Vorschlag</div>' : '') +
      '<div class="poster">' +
        (poster ? '<img src="' + esc(poster) + '" alt="" loading="lazy">' : '<div class="noposter">🎬</div>') +
      '</div>' +
      '<div class="body">' +
        '<div class="title-row"><h3>' + esc(titleOf(m)) + '</h3><span class="year">' + (m.year || '') + '</span></div>' +
        (subtitle ? '<div class="alt-title">' + esc(subtitle) + '</div>' : '') +
        (meta.length ? '<div class="meta">' + meta.join('') + '</div>' : '') +
        (genres.length ? '<div class="genres">' + genres.map(x => '<span class="g">' + esc(x) + '</span>').join('') + '</div>' : '') +
        (m.overview ? '<p class="overview">' + esc(m.overview) + '</p>' : '') +
        '<div class="foot">' + info + '<div class="actions">' + actions + '</div></div>' +
      '</div>' +
    '</article>';
}

function pickRandom() {
  const entries = currentEntries();
  const list = L.applyFilters(entries, S.filters, nameOf);
  if (!list.length) { toast('Keine Filme zur Auswahl – Filter anpassen oder Filme hinzufügen.', true); return; }
  const pool = list.length > 1 ? list.filter(e => e.id !== S.pickedId) : list;
  const e = pool[Math.floor(Math.random() * pool.length)];
  S.pickedId = e.id;
  render();
  const card = document.querySelector('.movie[data-id="' + e.id + '"]');
  if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('🎲 Vorschlag: ' + titleOf(e.movie) + (e.movie.year ? ' (' + e.movie.year + ')' : ''));
}

/* ---------- Abstimmungs-Ansicht ---------- */
function miniMovie(m, extra, actions, rowAction) {
  const poster = TMDB.posterUrl(m.posterPath, 'w92');
  const bits = [m.year, m.runtime ? fmtRuntime(m.runtime) : null, m.fsk != null ? 'FSK ' + m.fsk : null].filter(Boolean);
  return '<div class="vrow' + (rowAction ? ' clickable' : '') + '"' + (rowAction || '') + '>' +
    (poster ? '<img src="' + esc(poster) + '" alt="">' : '<span class="noposter">🎬</span>') +
    '<div class="vtext"><b>' + esc(titleOf(m)) + '</b>' +
      (TMDB.subtitleOf(m) ? ' <span class="muted">' + esc(TMDB.subtitleOf(m)) + '</span>' : '') +
      '<div class="vmeta">' + esc(bits.join(' · ')) + (extra ? ' · ' + extra : '') + '</div></div>' +
    '<div class="vact">' + (actions || '') + '</div>' +
  '</div>';
}

function trailerMini(id) {
  return '<button type="button" class="btn icon" data-action="trailer" data-id="' + id + '" title="Trailer" aria-label="Trailer">▶</button>';
}

function renderVoteView() {
  const gid = S.space;
  const g = currentGroup();
  const votes = groupVotes(gid);
  const active = votes.find(v => v.status !== 'closed');
  const closed = votes.filter(v => v.status === 'closed');
  const parts = [];

  // Formular wird nur bei eigenen Eingaben neu gezeichnet; hier nur die Trefferzahl aktualisieren
  $('vote-form').classList.toggle('hidden', !S.form);
  if (S.form && !$('vote-form').innerHTML) renderVoteForm();
  if (S.form) updateFormCount();

  // Das letzte Ergebnis bleibt gross sichtbar, bis eine neue Abstimmung startet
  const latest = !active && closed.length ? closed[0] : null;
  const older = latest ? closed.slice(1) : closed;

  if (active) parts.push(renderVoteCard(active, g));
  else if (!S.form) {
    parts.push('<div class="card vote-empty"><p>' + (latest ? 'Bereit für den nächsten Filmabend?' : 'Keine Abstimmung offen.') + '</p>' +
      '<button type="button" class="btn primary big" data-action="new-vote">🗳 Neue Abstimmung starten</button></div>');
  }
  if (latest) parts.push(renderVoteCard(latest, g));

  if (older.length) {
    parts.push('<h3 class="section-title">Frühere Abstimmungen</h3>');
    parts.push(older.slice(0, 10).map(v => renderVoteCard(v, g, true)).join(''));
  }
  $('vote-area').innerHTML = parts.join('');
}

function renderVoteCard(v, g, compact) {
  const conds = L.conditionsSummary(v.conditions, nameOf);
  const method = L.METHODS[v.method] || L.METHODS.approval;
  const phases = [['nominate', '1 Nominieren'], ['vote', '2 Abstimmen'], ['closed', '3 Ergebnis']];
  const phaseIdx = phases.findIndex(p => p[0] === v.status);
  const head =
    '<div class="vhead">' +
      '<div><h3>' + esc(v.title) + '</h3>' +
        '<div class="muted small">' + esc(method.label) + ' · gestartet von ' + esc(nameOf(v.createdBy)) + ' am ' + fmtDate(v.createdAt) +
        (v.status !== 'closed' ? ' · ' + L.nominationLimitText(v.maxNominations) : '') + '</div>' +
        (conds.length ? '<div class="conds">' + conds.map(c => '<span class="cond">' + esc(c) + '</span>').join('') + '</div>' : '') +
      '</div>' +
      (compact ? '' : '<div class="phases">' + phases.map((p, i) =>
        '<span class="phase' + (i === phaseIdx ? ' active' : i < phaseIdx ? ' done' : '') + '">' + p[1] + '</span>').join('') + '</div>') +
    '</div>';

  let body = '';
  if (v.status === 'nominate') body = renderNominate(v, g);
  else if (v.status === 'vote') body = renderBallot(v, g);
  else body = renderResult(v, compact);

  const foot = compact ? '' :
    '<div class="vfoot">' +
      (v.status === 'nominate' ? '<button type="button" class="btn primary" data-action="vote-next" data-vote="' + v.id + '">Weiter zur Abstimmung →</button>' : '') +
      (v.status === 'vote' ? '<button type="button" class="btn primary" data-action="vote-close" data-vote="' + v.id + '">Auszählen &amp; beenden</button>' : '') +
      '<button type="button" class="btn danger" data-action="vote-delete" data-vote="' + v.id + '">Löschen</button>' +
    '</div>';

  return '<section class="card vote' + (compact ? ' compact' : '') + '">' + head + body + foot + '</section>';
}

function renderNominate(v, g) {
  const entries = L.groupEntries(g.members || [], S.lists, S.movies, S.space);
  const nominated = L.nominatedIds(v);
  const mine = L.nominationsBy(v, S.userId);
  const can = L.canNominate(v, S.userId);
  const byId = new Map(entries.map(e => [e.id, e]));

  const nomRows = nominated.map(id => {
    const m = S.movies[id];
    if (!m) return '';
    const by = v.nominations[L.mkey(id)];
    const act = trailerMini(id) + (by === S.userId
      ? '<button type="button" class="btn small" data-action="vote-unnominate" data-vote="' + v.id + '" data-id="' + id + '">Zurückziehen</button>' : '');
    return miniMovie(m, 'von ' + esc(nameOf(by)), act);
  }).join('');

  const candidates = entries
    .filter(e => !nominated.includes(e.id) && L.eligible(e, v.conditions))
    .sort((a, b) => b.wantedBy.length - a.wantedBy.length || titleOf(a.movie).localeCompare(titleOf(b.movie), 'de'));
  const excluded = entries.filter(e => !nominated.includes(e.id) && !L.eligible(e, v.conditions)).length;

  const candRows = candidates.map(e => {
    const seen = e.seenBy.length ? '👁 ' + esc(namesList(e.seenBy)) : 'von niemandem gesehen';
    const act = trailerMini(e.id) +
      '<button type="button" class="btn small primary" data-action="vote-nominate" data-vote="' + v.id + '" data-id="' + e.id + '"' +
      (can ? '' : ' disabled') + '>Nominieren</button>';
    return miniMovie(e.movie, seen, act);
  }).join('');

  // Nominierte Filme, die nicht mehr in der Gruppe sind, trotzdem anzeigen (byId nur für Info)
  void byId;

  return '' +
    '<div class="vsec"><div class="vsec-title">Nominiert <span class="count">' + nominated.length + '</span>' +
      '<span class="muted small"> · du: ' + mine.length + (v.maxNominations ? ' / ' + v.maxNominations : '') + '</span></div>' +
      (nomRows || '<p class="muted small">Noch nichts nominiert.</p>') + '</div>' +
    '<div class="vsec"><div class="vsec-title">Passende Filme aus der Liste <span class="count">' + candidates.length + '</span>' +
      (excluded ? '<span class="muted small"> · ' + excluded + ' passen nicht zu den Bedingungen</span>' : '') + '</div>' +
      (candRows || '<p class="muted small">Keine (weiteren) Filme passen zu den Bedingungen.</p>') + '</div>';
}

function renderBallot(v, g) {
  const nominees = L.nominatedIds(v);
  const mine = ((v.ballots || {})[S.userId] || []).map(Number);
  const hint = v.method === 'approval' ? 'Tippe alle Filme an, die für dich okay sind.'
    : v.method === 'single' ? 'Tippe den einen Film an, den du am liebsten sehen willst.'
    : 'Tippe deine Favoriten der Reihe nach an: zuerst Platz 1 (3 Punkte), dann 2 (2), dann 3 (1). Nochmals tippen entfernt.';
  const rows = nominees.map(id => {
    const m = S.movies[id];
    if (!m) return '';
    const pos = mine.indexOf(id);
    let mark;
    if (v.method === 'ranked') mark = pos >= 0 ? '<span class="rank r' + (pos + 1) + '">' + (pos + 1) + '</span>' : '<span class="rank empty">–</span>';
    else if (v.method === 'single') mark = '<span class="radio' + (pos >= 0 ? ' on' : '') + '"></span>';
    else mark = '<span class="check' + (pos >= 0 ? ' on' : '') + '">' + (pos >= 0 ? '✓' : '') + '</span>';
    return miniMovie(m, 'nominiert von ' + esc(nameOf(v.nominations[L.mkey(id)])), trailerMini(id) + mark,
      ' data-action="vote-ballot" data-vote="' + v.id + '" data-id="' + id + '" role="button" tabindex="0"');
  }).join('');

  const voted = (g.members || []).filter(uid => ((v.ballots || {})[uid] || []).length);
  const open = (g.members || []).filter(uid => !voted.includes(uid));
  return '<p class="muted small vhint">' + hint + ' Das Ergebnis siehst du nach dem Auszählen.</p>' +
    '<div class="vsec ballot">' + rows + '</div>' +
    '<div class="voters">' +
      voted.map(uid => '<span class="person seen">✓ ' + esc(nameOf(uid)) + '</span>').join('') +
      open.map(uid => '<span class="person waiting">… ' + esc(nameOf(uid)) + '</span>').join('') +
    '</div>';
}

function renderResult(v, compact) {
  const res = v.result || { ranking: [], winner: null, tie: [] };
  const w = res.winner != null ? S.movies[res.winner] : null;
  if (!w) return '<p class="muted">Kein Ergebnis.</p>';
  const max = Math.max(1, ...res.ranking.map(r => r.score));
  const unit = v.method === 'ranked' ? 'Punkte' : 'Stimmen';
  const winnerBox =
    '<div class="winner">' +
      (TMDB.posterUrl(w.posterPath) ? '<img src="' + esc(TMDB.posterUrl(w.posterPath, 'w154')) + '" alt="">' : '<span class="noposter">🎬</span>') +
      '<div><div class="trophy">🏆 Gewinner</div><h3>' + esc(titleOf(w)) + ' <span class="muted">' + (w.year || '') + '</span></h3>' +
        (res.tie && res.tie.length > 1 ? '<div class="muted small">Gleichstand – das Los hat entschieden.</div>' : '') +
        '<div class="actions">' +
          '<button type="button" class="btn primary" data-action="trailer" data-id="' + res.winner + '">▶ Trailer</button>' +
          (inMySeen(res.winner)
            ? '<span class="muted small">👁 von dir gesehen</span>'
            : '<button type="button" class="btn" data-action="toggle-seen" data-id="' + res.winner + '">👁 Hab ich gesehen</button>') +
        '</div>' +
      '</div>' +
    '</div>';
  if (compact) {
    return '<div class="winner-line">🏆 <b>' + esc(titleOf(w)) + '</b> ' + (w.year ? '(' + w.year + ')' : '') +
      ' <span class="muted small">· ' + fmtDate(v.closedAt) + '</span> ' + trailerMini(res.winner) + '</div>';
  }
  const bars = res.ranking.map(r => {
    const m = S.movies[r.id];
    return '<div class="bar-row' + (r.id === res.winner ? ' win' : '') + '">' +
      '<span class="bar-label">' + esc(titleOf(m)) + '</span>' +
      '<span class="bar"><span style="width:' + Math.round(r.score / max * 100) + '%"></span></span>' +
      '<span class="bar-n">' + r.score + ' ' + unit + '</span></div>';
  }).join('');
  return winnerBox + '<div class="bars">' + bars + '</div>';
}

/* ---------- Formular "Neue Abstimmung" ---------- */
function formEntries() {
  return currentGroupEntries();
}

function renderVoteForm() {
  const f = S.form;
  const g = currentGroup();
  if (!f || !g) return;
  const members = (g.members || []).slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'de'));
  const genres = Array.from(new Set(formEntries().flatMap(e => e.movie.genres || []))).sort((a, b) => a.localeCompare(b, 'de'));
  const opt = (key, value, label, on) =>
    '<button type="button" class="chip' + (on ? ' active' : '') + '" data-action="form-set" data-key="' + key + '" data-value="' + esc(String(value)) + '">' + esc(label) + '</button>';
  const tog = (key, value, label, on) =>
    '<button type="button" class="chip' + (on ? ' active' : '') + '" data-action="form-toggle" data-key="' + key + '" data-value="' + esc(value) + '">' + esc(label) + '</button>';

  $('vote-form').innerHTML =
    '<h2>🗳 Neue Abstimmung</h2>' +
    '<label class="fl">Titel<input type="text" id="form-title" maxlength="60" value="' + esc(f.title) + '"></label>' +

    '<div class="fl">Abstimmungsart</div>' +
    '<div class="methods">' + Object.entries(L.METHODS).map(([k, mth]) =>
      '<button type="button" class="method' + (f.method === k ? ' active' : '') + '" data-action="form-set" data-key="method" data-value="' + k + '">' +
        '<b>' + esc(mth.label) + '</b><span>' + esc(mth.hint) + '</span></button>').join('') + '</div>' +

    '<div class="fl">Nominierungen pro Person</div>' +
    '<div class="chips nom-chips">' + [1, 2, 3, 4, 5].map(n => opt('maxNominations', n, String(n), f.maxNominations === n)).join('') +
      '<input type="number" id="form-maxnom" class="nom-input' + (f.maxNominations > 5 ? ' active' : '') + '" min="1" max="100" inputmode="numeric" placeholder="andere" aria-label="Andere Anzahl" value="' + (f.maxNominations > 5 ? f.maxNominations : '') + '">' +
      opt('maxNominations', 0, '∞ Unbegrenzt', f.maxNominations === 0) + '</div>' +

    '<h3 class="fsub">Bedingungen <span class="muted small">(optional)</span></h3>' +
    '<div class="fl">Länge höchstens</div>' +
    '<div class="chips">' + [[null, 'egal'], [90, '90 min'], [120, '2 h'], [150, '2½ h']].map(([v, l]) => opt('maxRuntime', v, l, f.maxRuntime === v)).join('') + '</div>' +

    '<div class="fl">Altersfreigabe höchstens</div>' +
    '<div class="chips">' + [[null, 'egal']].concat(L.FSK_LEVELS.slice(0, 4).map(n => [n, 'FSK ' + n])).map(([v, l]) => opt('maxFsk', v, l, f.maxFsk === v)).join('') + '</div>' +

    '<div class="fl">Genre <span class="muted small">(keins gewählt = alle)</span></div>' +
    '<div class="chips">' + (genres.length ? genres.map(x => tog('genres', x, x, f.genres.includes(x))).join('') : '<span class="muted">–</span>') + '</div>' +

    '<div class="fl">Schon gesehen</div>' +
    '<div class="chips">' +
      opt('seenMode', 'any', 'egal', f.seenMode === 'any') +
      opt('seenMode', 'none', 'von niemandem', f.seenMode === 'none') +
      opt('seenMode', 'max', 'von höchstens …', f.seenMode === 'max') +
      opt('seenMode', 'notBy', 'nicht von bestimmten Leuten', f.seenMode === 'notBy') +
    '</div>' +
    (f.seenMode === 'max'
      ? '<div class="chips sub">' + Array.from({ length: Math.max(1, members.length - 1) }, (_, i) => i + 1)
          .map(n => opt('seenMax', n, n + (n === 1 ? ' Person' : ' Personen'), f.seenMax === n)).join('') + '</div>' : '') +
    (f.seenMode === 'notBy'
      ? '<div class="chips sub">' + members.map(uid => tog('notBy', uid, nameOf(uid), f.notBy.includes(uid))).join('') + '</div>' : '') +

    '<p class="form-count" id="form-count"></p>' +
    '<div class="dlg-actions left">' +
      '<button type="button" class="btn primary" data-action="form-start">Abstimmung starten</button>' +
      '<button type="button" class="btn" data-action="form-cancel">Abbrechen</button>' +
    '</div>';
  updateFormCount();
}

function updateFormCount() {
  const el = $('form-count');
  if (!el || !S.form) return;
  const cond = formConditions(S.form);
  const entries = formEntries();
  const n = entries.filter(e => L.eligible(e, cond)).length;
  el.innerHTML = '<b>' + n + '</b> von ' + entries.length + ' Filmen der Liste passen zu diesen Bedingungen.' +
    (S.form.maxFsk != null ? ' <span class="muted">(Filme ohne FSK-Angabe zählen nicht.)</span>' : '');
}

function parseFormValue(key, raw) {
  if (['maxRuntime', 'maxFsk'].includes(key)) return raw === 'null' || raw === '' ? null : Number(raw);
  if (['maxNominations', 'seenMax'].includes(key)) return Number(raw);
  return raw;
}

/* ====================================================================
   Suche (TMDB)
   ==================================================================== */
let searchResults = [], searchIndex = -1, searchTimer = null, searchSeq = 0;

function searchHint() {
  return TMDB.hasKey()
    ? 'Titel eingeben (deutsch, englisch oder original), Treffer antippen – Genre, Länge, Jahr, FSK und Trailer kommen von TMDB.'
    : 'TMDB-API-Key fehlt – trage ihn in docs/config.js ein (README, Schritt 1).';
}

function closeSearch() {
  searchResults = []; searchIndex = -1;
  $('search-results').innerHTML = '';
  $('search-results').classList.add('hidden');
}

function renderSearchResults() {
  const box = $('search-results');
  if (!searchResults.length) {
    box.innerHTML = '<div class="result-empty">Nichts gefunden.</div>';
  } else {
    box.innerHTML = searchResults.map((r, i) => {
      const poster = TMDB.posterUrl(r.posterPath, 'w92');
      const g = currentGroup();
      const inGroup = g && inGroupList(S.space, r.id);
      const onList = g ? inGroup : inMyWatch(r.id), seen = inMySeen(r.id);
      const tag = inGroup ? '✓ in der Gruppe' : onList ? '✓ auf deiner Liste' : seen ? '👁 gesehen · ' + (r.year || '') : (r.year || '');
      return '<button type="button" class="result' + (i === searchIndex ? ' hover' : '') + (onList ? ' onlist' : '') + '" data-index="' + i + '">' +
        (poster ? '<img src="' + esc(poster) + '" alt="">' : '<span class="noposter">🎬</span>') +
        '<span class="rt"><strong>' + esc(r.title) + '</strong>' + (r.subtitle ? ' <em>' + esc(r.subtitle) + '</em>' : '') + '</span>' +
        '<span class="ry">' + esc(tag) + '</span></button>';
    }).join('');
  }
  box.classList.remove('hidden');
}

async function runSearch(q) {
  const seq = ++searchSeq;
  $('search-hint').textContent = 'Suche …';
  try {
    const res = await TMDB.search(q);
    if (seq !== searchSeq) return;
    searchResults = res;
    searchIndex = res.length ? 0 : -1;
    renderSearchResults();
    $('search-hint').textContent = searchHint();
  } catch (e) {
    if (seq !== searchSeq) return;
    closeSearch();
    $('search-hint').textContent = searchHint();
    fail(e);
  }
}

/* ====================================================================
   Ereignisse
   ==================================================================== */
function initStaticUi() {
  // Suche
  const input = $('search-input');
  $('search-hint').textContent = searchHint();
  if (!TMDB.hasKey()) {
    input.disabled = true;
    input.placeholder = 'TMDB-API-Key fehlt';
    $('search-hint').classList.add('warn');
  }
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) { closeSearch(); return; }
    searchTimer = setTimeout(() => runSearch(q), 350);
  });
  input.addEventListener('keydown', e => {
    if (!searchResults.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); searchIndex = (searchIndex + 1) % searchResults.length; renderSearchResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); searchIndex = (searchIndex - 1 + searchResults.length) % searchResults.length; renderSearchResults(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (searchIndex >= 0) addMovie(searchResults[searchIndex]); }
    else if (e.key === 'Escape') closeSearch();
  });
  input.addEventListener('focus', () => { if (searchResults.length) renderSearchResults(); });
  $('search-results').addEventListener('click', e => {
    const r = e.target.closest('.result');
    if (r) addMovie(searchResults[Number(r.dataset.index)]);
  });

  // Kompakte Treffer, solange die Handy-Tastatur offen ist
  const vv = window.visualViewport;
  const updateCompact = () => {
    const keyboard = vv ? vv.height < window.innerHeight * 0.75 : document.activeElement === input;
    $('search-results').classList.toggle('compact', window.innerWidth <= 700 && keyboard);
  };
  if (vv) vv.addEventListener('resize', updateCompact);
  window.addEventListener('resize', updateCompact);
  input.addEventListener('focus', () => setTimeout(updateCompact, 300));
  input.addEventListener('blur', () => setTimeout(updateCompact, 300));

  // Filter auf-/zuklappen (gemerkt; Standard: Handy zu, Desktop offen)
  const setOpen = (open, remember) => {
    $('filters').classList.toggle('collapsed', !open);
    $('filter-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    $('filter-toggle').classList.toggle('open', open);
    if (remember) lsSet(LS.filtersOpen, open ? '1' : '0');
  };
  const saved = lsGet(LS.filtersOpen);
  setOpen(saved === null ? window.innerWidth > 700 : saved === '1', false);
  $('filter-toggle').addEventListener('click', () => setOpen($('filters').classList.contains('collapsed'), true));

  // Filter-Chips
  $('filters').addEventListener('click', e => {
    const c = e.target.closest('.chip[data-filter]');
    if (!c) return;
    const f = S.filters, v = c.dataset.value;
    if (c.dataset.filter === 'maxseen') f.maxSeen = v === '' ? null : Number(v);
    else {
      const set = { genre: f.genres, length: f.lengths, decade: f.decades, notseen: f.notSeenBy }[c.dataset.filter];
      if (set.has(v)) set.delete(v); else set.add(v);
    }
    render();
  });
  $('list-search').addEventListener('input', e => { S.filters.text = e.target.value; render(); });
  $('reset-filters').addEventListener('click', () => {
    S.filters = L.emptyFilters();
    $('list-search').value = '';
    render();
  });
  $('sort').addEventListener('change', () => { S.sortKey = $('sort').value; render(); });
  $('random').addEventListener('click', pickRandom);

  // Anmeldung
  $('login-form').addEventListener('submit', e => { e.preventDefault(); submitLogin(); });

  // Formulare in Dialogen
  document.addEventListener('submit', e => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const val = n => (form.elements[n] ? form.elements[n].value : '');
    if (form.dataset.form === 'create-group') createGroup(val('name'));
    else if (form.dataset.form === 'join-group') joinByCode(val('code'));
    else if (form.dataset.form === 'rename-group') {
      const name = val('name').trim();
      if (!name) return;
      DB.renameGroup(form.dataset.gid, name).then(() => { closeDialog(); toast('Umbenannt'); }, fail);
    }
  });

  // Titel im Abstimmungsformular mitschreiben
  document.addEventListener('input', e => {
    if (e.target.id === 'form-title' && S.form) S.form.title = e.target.value;
    if (e.target.id === 'form-maxnom' && S.form) {
      const n = Math.round(Number(e.target.value));
      if (n >= 1 && n <= 100) {
        S.form.maxNominations = n;
        // nur Chips umschalten, Eingabefeld nicht neu zeichnen (Fokus bleibt)
        document.querySelectorAll('.nom-chips .chip').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        if (n <= 5) { const c = document.querySelector('.nom-chips .chip[data-value="' + n + '"]'); if (c) { c.classList.add('active'); e.target.classList.remove('active'); } }
      }
    }
  });

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('dialog').classList.contains('hidden')) closeDialog(false);
    if (e.key === 'Enter' && e.target.matches('.vrow.clickable')) e.target.click();
    if (e.key === 'Enter' && e.target.matches('.movie[data-id]')) {
      const m = S.movies[e.target.dataset.id];
      if (m) openTrailer(m);
    }
  });
}

function onClick(ev) {
  if (!ev.target.closest('.search')) closeSearch();

  const el = ev.target.closest('[data-action]');
  if (!el) {
    const card = ev.target.closest('.movie[data-id]');
    if (card && S.movies[card.dataset.id]) openTrailer(S.movies[card.dataset.id]);
    return;
  }
  const a = el.dataset.action;
  const id = el.dataset.id != null ? Number(el.dataset.id) : null;
  const gid = S.space;
  const vote = el.dataset.vote ? Object.assign({ id: el.dataset.vote }, (S.votes[gid] || {})[el.dataset.vote]) : null;
  if (el.disabled) return;

  switch (a) {
    case 'overlay': if (ev.target === el) closeDialog(false); break;
    case 'dlg-cancel': closeDialog(false); break;
    case 'dlg-ok': closeDialog(true); break;

    case 'login-as': loginAs(el.dataset.uid); break;
    case 'login-register': registerPending(); break;
    case 'login-cancel': S.loginPending = null; renderLogin(); break;
    case 'open-profile': openProfile(); break;
    case 'logout': closeDialog(); logout(); break;

    case 'space': switchSpace(el.dataset.space); break;
    case 'subtab':
      if (currentGroup()) S.tab.group = el.dataset.tab; else S.tab.me = el.dataset.tab;
      S.pickedId = null;
      render();
      break;
    case 'new-group': openNewGroup(); break;
    case 'invite': { const g = currentGroup(); if (g) openInvite(gid, g.name, g.code); break; }
    case 'copy-invite':
      (navigator.clipboard ? navigator.clipboard.writeText(el.dataset.link) : Promise.reject(new Error('no clipboard')))
        .then(() => toast('Link kopiert'), () => {
          const inp = document.querySelector('.invite-link');
          if (inp) { inp.select(); toast('Link markiert – jetzt kopieren'); }
        });
      break;
    case 'share-invite':
      navigator.share({ title: 'Filmabend', text: 'Komm in unsere Filmabend-Gruppe „' + el.dataset.name + '“:', url: el.dataset.link }).catch(() => {});
      break;
    case 'rename-group': openRename(gid); break;
    case 'leave-group': leaveGroup(gid); break;

    case 'trailer': ev.stopPropagation(); if (S.movies[id]) openTrailer(S.movies[id]); break;
    case 'seen': markSeen(id, null); break;
    case 'back-to-list': backToList(id); break;
    case 'remove-watch': removeFromPrivate(id); break;
    case 'remove-seen': removeFromSeen(id); break;
    case 'toggle-want': toggleGroupWant(gid, id); break;
    case 'remove-group': removeFromGroup(gid, id); break;
    case 'add-private': addToPrivate(id); break;
    case 'toggle-seen': if (inMySeen(id)) unmarkSeen(id); else markSeen(id, currentGroup() ? gid : null); break;
    case 'pick-ok': finishPick(true); break;
    case 'pick-cancel': finishPick(false); break;
    case 'pick-all': case 'pick-none':
      $('dialog-body').querySelectorAll('input[name="pick"]:not(:disabled)').forEach(i => { i.checked = a === 'pick-all'; });
      break;
    case 'inbox': answerInbox(el.dataset.key, id, el.dataset.choice); break;

    case 'new-vote':
      S.form = newVoteForm();
      $('vote-form').innerHTML = '';
      render();
      $('vote-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    case 'form-set': {
      const key = el.dataset.key;
      S.form[key] = parseFormValue(key, el.dataset.value);
      renderVoteForm();
      break;
    }
    case 'form-toggle': {
      const arr = S.form[el.dataset.key];
      const v = el.dataset.value;
      const i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
      renderVoteForm();
      break;
    }
    case 'form-cancel': S.form = null; $('vote-form').innerHTML = ''; render(); break;
    case 'form-start': startVote(); break;

    case 'vote-nominate': nominate(vote, id, true); break;
    case 'vote-unnominate': nominate(vote, id, false); break;
    case 'vote-next': toVotePhase(vote); break;
    case 'vote-ballot': castBallot(vote, id); break;
    case 'vote-close': closeVote(vote); break;
    case 'vote-delete': deleteVote(vote); break;
  }
}

boot();

// Für Tests / Konsole
window.Filmabend = { S, L };
