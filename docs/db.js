/*
 * Filmabend – Datenbank (Firebase Firestore + anonyme Anmeldung)
 * ---------------------------------------------------------------
 * Gleiches Prinzip wie beim Essensplan: Jedes Gerät meldet sich im
 * Hintergrund anonym bei Firebase an; "angemeldet" wird nur mit dem Namen.
 *
 * Sammlungen:
 *   users/{userId}                 { name, nameLower, createdAt }
 *   lists/{userId}                 { watch: {m<id>: Zeit}  private Watchlist
 *                                    seen:  {m<id>: Zeit}  gesehen
 *                                    share: {<gid>: {m<id>: Zeit}}  in welcher Gruppe geteilt
 *                                    shareInit: {<gid>: true}       share für Gruppe angelegt
 *                                    inbox: {<id>: {movieId, by, gid, at}}  Rückfragen "gesehen"
 *                                    rewatch: {m<id>: Zeit}  nochmals schauen (bleibt bei "gesehen")
 *                                    updatedAt }
 *   movies/{tmdbId}                Filmdaten von TMDB (geteilt, Cache)
 *   groups/{groupId}               { name, code, members: [userId], createdBy, createdAt }
 *   groups/{groupId}/votes/{id}    Abstimmungen
 *   groups/{groupId}/watched/{tmdbId}  { movieId, at, by }  zusammen gesehen
 */
const FB = 'https://www.gstatic.com/firebasejs/13.1.0/';

let fs = null;        // Firestore-Modul
let db = null;

export async function init(config, onReady) {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-firestore.js')
  ]);
  fs = fsMod;
  const app = appMod.initializeApp(config);
  try {
    // Lokaler Zwischenspeicher: schneller Start, weniger Datenbank-Lesezugriffe
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
    });
  } catch (e) {
    db = fs.getFirestore(app);
  }
  const auth = authMod.getAuth(app);
  let started = false;
  authMod.onAuthStateChanged(auth, u => {
    if (u && !started) { started = true; onReady(); }
  });
  await authMod.signInAnonymously(auth);
}

/* ---------- Hilfen ---------- */
const now = () => Date.now();
const mk = id => 'm' + id;

function watchQuery(q, cb, onError) {
  return fs.onSnapshot(q, snap => {
    const out = {};
    snap.forEach(d => { out[d.id] = d.data(); });
    cb(out);
  }, onError);
}

/* ---------- Abos (live) ---------- */
/* cb(users, fromCache): fromCache = noch nicht vom Server bestätigt (lokaler Zwischenspeicher) */
export function watchUsers(cb, onError) {
  return fs.onSnapshot(fs.collection(db, 'users'), { includeMetadataChanges: true }, snap => {
    const out = {};
    snap.forEach(x => { out[x.id] = x.data(); });
    cb(out, !!(snap.metadata && snap.metadata.fromCache));
  }, onError);
}

export function watchMovies(cb, onError) {
  return watchQuery(fs.collection(db, 'movies'), cb, onError);
}

export function watchList(uid, cb, onError) {
  return fs.onSnapshot(fs.doc(db, 'lists', uid), snap => {
    const d = snap.exists() ? snap.data() : {};
    cb({ watch: d.watch || {}, seen: d.seen || {}, share: d.share || {}, shareInit: d.shareInit || {}, inbox: d.inbox || {}, rewatch: d.rewatch || {} });
  }, onError);
}

export function watchMyGroups(uid, cb, onError) {
  return watchQuery(fs.query(fs.collection(db, 'groups'), fs.where('members', 'array-contains', uid)), cb, onError);
}

export function watchVotes(groupId, cb, onError) {
  return watchQuery(fs.collection(db, 'groups', groupId, 'votes'), cb, onError);
}

/* ---------- Profile ---------- */
export async function createUser(name) {
  const ref = await fs.addDoc(fs.collection(db, 'users'), {
    name, nameLower: name.toLowerCase(), createdAt: now()
  });
  await ensureList(ref.id);
  return ref.id;
}

export async function ensureList(uid) {
  const ref = fs.doc(db, 'lists', uid);
  const snap = await fs.getDoc(ref);
  if (!snap.exists()) await fs.setDoc(ref, { watch: {}, seen: {}, share: {}, shareInit: {}, inbox: {}, rewatch: {}, updatedAt: now() });
}

/* Beliebige Felder einer Liste ändern: { 'share.<gid>.m123': Zeit | null } – null löscht */
export function patchList(uid, fields) {
  const patch = { updatedAt: now() };
  Object.entries(fields).forEach(([k, v]) => { patch[k] = v === null ? fs.deleteField() : v; });
  return fs.updateDoc(fs.doc(db, 'lists', uid), patch);
}

/* ---------- Persönliche Liste ----------
   changes = { watch: {id: true|false}, seen: {id: true|false} } */
export function updateList(uid, changes) {
  const t = now();
  const patch = { updatedAt: t };
  ['watch', 'seen'].forEach(which => {
    Object.entries(changes[which] || {}).forEach(([id, on]) => {
      patch[which + '.' + mk(id)] = on ? t : fs.deleteField();
    });
  });
  return fs.updateDoc(fs.doc(db, 'lists', uid), patch);
}

/* ---------- Filmdaten ---------- */
export function saveMovie(movie) {
  const clean = {};
  Object.entries(movie).forEach(([k, v]) => { if (v !== undefined) clean[k] = v; });
  clean.updatedAt = now();
  return fs.setDoc(fs.doc(db, 'movies', String(movie.id)), clean, { merge: true });
}

/* ---------- Gruppen ---------- */
export async function findGroupByCode(code) {
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'groups'), fs.where('code', '==', code)));
  let found = null;
  snap.forEach(d => { if (!found) found = { id: d.id, ...d.data() }; });
  return found;
}

export async function createGroup(name, uid, makeCode) {
  let code = makeCode();
  for (let i = 0; i < 5 && await findGroupByCode(code); i++) code = makeCode();
  const ref = await fs.addDoc(fs.collection(db, 'groups'), {
    name, code, members: [uid], createdBy: uid, createdAt: now()
  });
  return { id: ref.id, code };
}

export function joinGroup(groupId, uid) {
  return fs.updateDoc(fs.doc(db, 'groups', groupId), { members: fs.arrayUnion(uid) });
}

export function leaveGroup(groupId, uid) {
  return fs.updateDoc(fs.doc(db, 'groups', groupId), { members: fs.arrayRemove(uid) });
}

export function renameGroup(groupId, name) {
  return fs.updateDoc(fs.doc(db, 'groups', groupId), { name });
}

/* ---------- Abstimmungen ---------- */
export async function createVote(groupId, vote) {
  const ref = await fs.addDoc(fs.collection(db, 'groups', groupId, 'votes'), vote);
  return ref.id;
}

function voteRef(groupId, voteId) {
  return fs.doc(db, 'groups', groupId, 'votes', voteId);
}

export function setNomination(groupId, voteId, movieId, uid) {
  return fs.updateDoc(voteRef(groupId, voteId), { ['nominations.' + mk(movieId)]: uid || fs.deleteField() });
}

export function setBallot(groupId, voteId, uid, ids) {
  return fs.updateDoc(voteRef(groupId, voteId), { ['ballots.' + uid]: ids });
}

export function updateVote(groupId, voteId, patch) {
  return fs.updateDoc(voteRef(groupId, voteId), patch);
}

export function deleteVote(groupId, voteId) {
  return fs.deleteDoc(voteRef(groupId, voteId));
}

/* ---------- Zusammen gesehen (Verlauf einer Gruppe) ---------- */
export function watchGroupWatched(groupId, cb, onError) {
  return watchQuery(fs.collection(db, 'groups', groupId, 'watched'), cb, onError);
}

export function addWatched(groupId, movieId, uid) {
  return fs.setDoc(fs.doc(db, 'groups', groupId, 'watched', String(movieId)), { movieId: Number(movieId), at: now(), by: uid });
}

export function removeWatched(groupId, movieId) {
  return fs.deleteDoc(fs.doc(db, 'groups', groupId, 'watched', String(movieId)));
}
