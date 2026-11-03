// Keeps a page up to date with the database, so nobody has to refresh by hand.
//
// How it works: every `intervalMs` the page asks a tiny PHP address "what is the latest version of the data?" (changes.php).
// Only when the answer is different from last time does it call YOUR onChange(), where the page reloads its data and redraws itself.
// So a check costs almost nothing, and the full list is downloaded only when something really changed.
//
//   import { startLive } from '../../shared/live.js';
//   const live = startLive({
//     url: new URL('../../PHP/Staff/changes.php?scope=orders,menu', import.meta.url),
//     intervalMs: 1000,
//     onChange: async () => { await app.reloadFromServer(); app.redrawCurrentScreen(); },
//     onUnauthorized: () => { location.href = 'index.html'; },        // signed out: go to the login page
//   });
//   // right after a button that changes data (for example "Mark Baking"), so the person who pressed it sees it at once:
//   await live.refreshNow();

const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

// Do not redraw the page under someone who is in the middle of typing.
function defaultIsBusy() {
  if (typeof document === 'undefined') return false;
  const a = document.activeElement;
  if (!a) return false;
  const tag = String(a.tagName || '');
  if (tag === 'TEXTAREA') return (a.value || '') !== '';
  if (tag === 'INPUT') return !NOT_TEXT.has(String(a.type || '').toLowerCase()) && (a.value || '') !== '';
  return false;
}
function defaultVisibility() {
  if (typeof document === 'undefined') return { hidden: () => false, onShow: () => () => {} };
  return {
    hidden: () => document.hidden,
    onShow: cb => { const f = () => { if (!document.hidden) cb(); }; document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); },
  };
}

export function startLive({
  url, onChange,
  intervalMs = 2000,            // how often to ask. 1000 = every second.
  maxIntervalMs = 30000,        // when the server is unreachable, slow down to at most this
  isBusy = defaultIsBusy,
  onUnauthorized = null,        // called once if the server says "not signed in" (401/403); live updates then stop
  onError = e => console.warn('Live update:', e && e.message ? e.message : e),
  fetchFn = (...a) => fetch(...a),
  timer = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) },
  visibility = defaultVisibility(),
} = {}) {
  if (!url || typeof onChange !== 'function') throw new Error('startLive needs a url and an onChange function');
  let version = null, inFlight = false, stopped = false, fails = 0, handle = null;

  const delay = () => (fails ? Math.min(intervalMs * 2 ** fails, maxIntervalMs) : intervalMs);
  const schedule = () => { if (!stopped) handle = timer.set(tick, delay()); };

  async function readVersion() {
    const res = await fetchFn(url, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) { const e = new Error('Not signed in'); e.unauthorized = true; throw e; }
    let body = null;
    try { body = await res.json(); } catch { /* the server did not send JSON */ }
    if (!res.ok || !body || body.ok === false || body.version === undefined) throw new Error((body && body.error) || `changes answered HTTP ${res.status}`);
    return String(body.version);
  }

  async function tick() {
    if (stopped || inFlight) return;                  // never two checks at the same time
    if (visibility.hidden()) { schedule(); return; }  // a hidden tab costs nothing; it catches up when shown again
    inFlight = true;
    try {
      const v = await readVersion();
      fails = 0;
      if (version === null) version = v;              // the first answer is what the page already shows
      else if (v !== version && !isBusy()) { await onChange(v); version = v; }   // version moves on only after the page really updated
    } catch (e) {
      if (e && e.unauthorized) { stop(); if (onUnauthorized) onUnauthorized(); return; }
      fails = Math.min(fails + 1, 10);
      onError(e);
    } finally { inFlight = false; }
    schedule();
  }

  async function refreshNow() {
    if (stopped) return;
    timer.clear(handle);
    try {
      const v = await readVersion().catch(() => null);
      await onChange(v);
      if (v !== null) version = v;
      fails = 0;
    } catch (e) { onError(e); }
    schedule();
  }

  function stop() { stopped = true; timer.clear(handle); offShow(); }

  const offShow = visibility.onShow(() => { if (!stopped) { timer.clear(handle); tick(); } });
  handle = timer.set(tick, 0);                        // first check straight away
  return { stop, refreshNow, get version() { return version; }, get failures() { return fails; } };
}
