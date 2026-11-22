// Облачная синхронизация через Supabase.
// Стратегия: у каждой записи есть updatedAt и deleted (мягкое удаление);
// побеждает запись с большим updatedAt (last-write-wins).
// Pull идёт по серверной метке server_updated_at, push — по флагу dirty.
import { db, getMeta, setMeta, SYNCABLE_SETTINGS } from './db.js';

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const AUTO_INTERVAL_MS = 30 * 60 * 1000;
const PAGE = 1000;
const CHUNK = 500;

const TABLES = [
  { local: 'products', remote: 'products', key: 'id', filter: (r) => r.source === 'local' },
  { local: 'dishes', remote: 'dishes', key: 'id' },
  { local: 'diary', remote: 'diary_entries', key: 'id' },
  { local: 'settings', remote: 'settings', key: 'key', filter: (r) => SYNCABLE_SETTINGS.includes(r.key) },
];

let client = null;
let clientSig = '';
let running = null;
let timer = null;
let changeTimer = null;

// ---------- Конфигурация и клиент ----------

export async function getConfig() {
  return (await getMeta('syncConfig')) || { url: '', anonKey: '' };
}

export async function setConfig(cfg) {
  const clean = { url: String(cfg.url || '').trim().replace(/\/+$/, ''), anonKey: String(cfg.anonKey || '').trim() };
  await setMeta('syncConfig', clean);
  client = null;
  clientSig = '';
  emitStatus();
  return clean;
}

export async function isConfigured() {
  const cfg = await getConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.supabase?.createClient) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Не удалось загрузить библиотеку Supabase (нет сети?)'));
    document.head.appendChild(s);
  });
}

export async function getClient() {
  const cfg = await getConfig();
  if (!cfg.url || !cfg.anonKey) return null;
  const sig = cfg.url + '|' + cfg.anonKey;
  if (client && clientSig === sig) return client;
  await loadScript(SUPABASE_CDN);
  client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'kbzhu-auth' },
  });
  clientSig = sig;
  client.auth.onAuthStateChange((event) => {
    emitStatus();
    if (event === 'SIGNED_IN') setTimeout(() => syncNow().catch(() => {}), 0);
  });
  return client;
}

export async function getUser() {
  const c = await getClient().catch(() => null);
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data?.session?.user ?? null;
}

const redirectUrl = () => location.origin + location.pathname;

export async function signIn(email, password) {
  const c = await requireClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password) {
  const c = await requireClient();
  const { data, error } = await c.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl() } });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function sendMagicLink(email) {
  const c = await requireClient();
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl() } });
  if (error) throw error;
}

export async function verifyCode(email, token) {
  const c = await requireClient();
  const { error } = await c.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function signOut() {
  const c = await getClient();
  if (c) await c.auth.signOut();
  emitStatus();
}

async function requireClient() {
  const c = await getClient();
  if (!c) throw new Error('Сначала укажите URL и anon key Supabase');
  return c;
}

// ---------- Статус ----------

export async function getStatus() {
  return (await getMeta('syncStatus')) || null;
}

function emitStatus() {
  window.dispatchEvent(new CustomEvent('sync-status'));
}

export const isRunning = () => Boolean(running);

// ---------- Преобразование записей ----------

function toRemote(rec, key, userId) {
  const { dirty, ...data } = rec;
  return {
    user_id: userId,
    id: String(rec[key]),
    data,
    updated_at: Math.round(Number(rec.updatedAt) || 0),
    deleted: Boolean(rec.deleted),
  };
}

function fromRemote(row, key) {
  return {
    ...(row.data || {}),
    [key]: row.id,
    updatedAt: Number(row.updated_at) || 0,
    deleted: Boolean(row.deleted),
    dirty: 0,
  };
}

// ---------- Pull / Push ----------

async function pullTable(c, t, userId) {
  const cursorKey = `syncCursor:${userId}:${t.remote}`;
  let cursor = (await getMeta(cursorKey)) || '1970-01-01T00:00:00Z';
  let pulled = 0;
  for (;;) {
    const { data, error } = await c
      .from(t.remote)
      .select('id,data,updated_at,deleted,server_updated_at')
      .eq('user_id', userId)
      .gt('server_updated_at', cursor)
      .order('server_updated_at', { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`${t.remote}: ${error.message}`);
    if (!data.length) break;
    await db.transaction('rw', db[t.local], async () => {
      for (const row of data) {
        const incoming = fromRemote(row, t.key);
        const existing = await db[t.local].get(incoming[t.key]);
        if (!existing || incoming.updatedAt >= Number(existing.updatedAt || 0)) {
          await db[t.local].put(incoming);
          pulled++;
        } else if (!existing.dirty) {
          // Локальная версия новее, но не помечена — отправим её.
          await db[t.local].put({ ...existing, dirty: 1 });
        }
      }
    });
    cursor = data[data.length - 1].server_updated_at;
    await setMeta(cursorKey, cursor);
    if (data.length < PAGE) break;
  }
  return pulled;
}

async function pushTable(c, t, userId) {
  const dirty = (await db[t.local].where('dirty').equals(1).toArray()).filter((r) => !t.filter || t.filter(r));
  let pushed = 0;
  for (let i = 0; i < dirty.length; i += CHUNK) {
    const chunk = dirty.slice(i, i + CHUNK);
    const { error } = await c.from(t.remote).upsert(chunk.map((r) => toRemote(r, t.key, userId)), { onConflict: 'user_id,id' });
    if (error) throw new Error(`${t.remote}: ${error.message}`);
    await db.transaction('rw', db[t.local], async () => {
      for (const r of chunk) {
        const cur = await db[t.local].get(r[t.key]);
        if (cur && cur.updatedAt === r.updatedAt) await db[t.local].put({ ...cur, dirty: 0 });
      }
    });
    pushed += chunk.length;
  }
  return pushed;
}

/** При первом входе пользователя на этом устройстве отправляем всё локальное. */
async function markAllDirtyOnce(userId) {
  const flag = `syncInitial:${userId}`;
  if (await getMeta(flag)) return;
  for (const t of TABLES) {
    await db[t.local].toCollection().modify((r) => {
      if (!t.filter || t.filter(r)) r.dirty = 1;
    });
  }
  await setMeta(flag, true);
}

/** Полный цикл синхронизации. Повторные вызовы во время работы возвращают тот же промис. */
export function syncNow() {
  if (running) return running;
  running = (async () => {
    emitStatus();
    const startedAt = Date.now();
    try {
      if (!(await isConfigured())) throw new Error('Синхронизация не настроена');
      if (!navigator.onLine) throw new Error('Нет сети');
      const c = await getClient();
      const { data } = await c.auth.getSession();
      const user = data?.session?.user;
      if (!user) throw new Error('Не выполнен вход');
      await markAllDirtyOnce(user.id);
      let pulled = 0;
      let pushed = 0;
      for (const t of TABLES) pulled += await pullTable(c, t, user.id);
      for (const t of TABLES) pushed += await pushTable(c, t, user.id);
      const status = { ok: true, at: Date.now(), pulled, pushed, ms: Date.now() - startedAt, message: 'Синхронизировано' };
      await setMeta('syncStatus', status);
      if (pulled) window.dispatchEvent(new CustomEvent('data-changed', { detail: { table: 'all', local: false } }));
      return status;
    } catch (e) {
      const status = { ok: false, at: Date.now(), message: e.message || String(e) };
      await setMeta('syncStatus', status);
      return status;
    } finally {
      running = null;
      emitStatus();
    }
  })();
  return running;
}

/** Автосинхронизация: при запуске, раз в 30 минут, при появлении сети и после локальных правок. */
export async function startAutoSync() {
  if (timer) return;
  const tryRun = async () => {
    if (!(await isConfigured())) return;
    if (!(await getUser())) return;
    await syncNow();
  };
  timer = setInterval(() => tryRun().catch(() => {}), AUTO_INTERVAL_MS);
  window.addEventListener('online', () => tryRun().catch(() => {}));
  window.addEventListener('data-changed', (e) => {
    if (!e.detail?.local) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => tryRun().catch(() => {}), 15000);
  });
  await tryRun().catch(() => {});
}
