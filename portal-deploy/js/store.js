/* store.js — user-input persistence layer.
 *
 * CURRENT: browser localStorage (per-user, per-browser).
 * No backend required; the site deploys as pure static files.
 *
 * TO ENABLE SHARED TEAM STATE WITH SUPABASE:
 *   1. Create a Supabase project and a table, e.g.:
 *      create table portal_state (
 *        team_id text not null,
 *        key text not null,
 *        value jsonb not null,
 *        updated_at timestamptz default now(),
 *        primary key (team_id, key)
 *      );
 *   2. Add the Supabase JS client (CDN or npm) and set SUPABASE_URL /
 *      SUPABASE_ANON_KEY below (use a .env / Vercel env var in production —
 *      never hardcode the service_role key client-side).
 *   3. Replace _read() and _write() with Supabase calls:
 *        _read:  supabase.from('portal_state').select('value').eq('team_id', TEAM_ID).eq('key', key)
 *        _write: supabase.from('portal_state').upsert({team_id: TEAM_ID, key, value})
 *      Keep the in-memory cache (_mem) so reads stay synchronous after first load.
 *   4. Optionally subscribe with supabase realtime to refresh other tabs when
 *      a teammate changes a value.
 *
 * IMPORTANT CONTRACT (do not break): a value the user typed must NEVER be
 * overwritten by a recalculation. All computed fields must check
 * Store.get() first; an existing stored value always wins.
 */
const Store = (() => {
  const PREFIX = "mm_portal_v1:";
  const _mem = {};

  // ---- Supabase swap points (leave null for localStorage mode) ----
  const SUPABASE_URL = null;      // e.g. "https://xyz.supabase.co"
  const SUPABASE_ANON_KEY = null; // anon public key only
  const TEAM_ID = "malia-mills";  // shared partition key when backend is on

  function _read(key) {
    // SUPABASE MODE: return _mem[key] (populated at boot from portal_state).
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (e) { return undefined; }
  }
  function _write(key, value) {
    // SUPABASE MODE: upsert {team_id: TEAM_ID, key, value} into portal_state.
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
    catch (e) { /* storage full/blocked — keep memory copy */ }
  }

  return {
    get(key, fallback) {
      if (key in _mem) return _mem[key];
      const v = _read(key);
      if (v === undefined) return fallback;
      _mem[key] = v;
      return v;
    },
    set(key, value) {
      _mem[key] = value;
      _write(key, value);
    },
    remove(key) {
      delete _mem[key];
      try { localStorage.removeItem(PREFIX + key); } catch (e) {}
      // SUPABASE MODE: delete from portal_state where team_id + key.
    },
    clearAll() {
      Object.keys(_mem).forEach(k => delete _mem[k]);
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith(PREFIX))
          .forEach(k => localStorage.removeItem(k));
      } catch (e) {}
    }
  };
})();
