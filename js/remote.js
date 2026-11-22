// Удалённые источники продуктов (JSON-массивы по URL).
import { db, uid, emitChange } from './db.js';
import { num } from './calc.js';

export const STALE_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 15000;

export async function listSources() {
  return (await db.sources.toArray()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function addSource(name, url) {
  const clean = String(url || '').trim();
  if (!clean) throw new Error('Укажите URL');
  try { new URL(clean, location.href); } catch { throw new Error('Некорректный URL'); }
  const src = {
    id: 'src-' + uid().slice(0, 8),
    name: String(name || '').trim() || new URL(clean, location.href).hostname || 'Источник',
    url: clean,
    enabled: true,
    lastFetchedAt: null,
    lastError: null,
    count: 0,
    createdAt: Date.now(),
  };
  await db.sources.put(src);
  emitChange('sources');
  return src;
}

export async function updateSource(id, patch) {
  const src = await db.sources.get(id);
  if (!src) return null;
  const next = { ...src, ...patch };
  await db.sources.put(next);
  emitChange('sources');
  return next;
}

/** Удаляет источник вместе с его продуктами (они не синхронизируются, поэтому удаляем физически). */
export async function removeSource(id) {
  await db.transaction('rw', db.sources, db.products, async () => {
    await db.sources.delete(id);
    await db.products.where('source').equals(id).delete();
  });
  emitChange('sources');
  emitChange('products');
}

/** Включение/выключение: выключенный источник не показывает свои продукты. */
export async function setSourceEnabled(id, enabled) {
  const src = await updateSource(id, { enabled });
  if (!src) return null;
  if (enabled) return fetchSource(src);
  await db.products.where('source').equals(id).delete();
  await db.sources.put({ ...src, count: 0, lastFetchedAt: null });
  emitChange('products', false);
  emitChange('sources', false);
  return { ok: true, count: 0 };
}

/** Преобразует элемент источника в продукт. Чистая функция. */
export function normalizeRemoteItem(item, sourceId, fetchedAt) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name ?? '').trim();
  const kcal = Number(String(item.kcal ?? '').replace(',', '.'));
  if (!name || !Number.isFinite(kcal) || kcal < 0) return null;
  const remoteId = String(item.id ?? name.toLowerCase().replace(/\s+/g, '-'));
  return {
    id: `${sourceId}:${remoteId}`,
    remoteId,
    name,
    brand: item.brand ? String(item.brand) : '',
    kcal,
    protein: num(item.protein),
    fat: num(item.fat),
    carbs: num(item.carbs),
    category: item.category ? String(item.category) : 'Другое',
    source: sourceId,
    updatedAt: fetchedAt,
    deleted: false,
    dirty: 0,
  };
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(new URL(url, location.href), { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Превышено время ожидания');
    if (e instanceof SyntaxError) throw new Error('Ответ не является JSON');
    if (e instanceof TypeError) throw new Error('Сеть недоступна или CORS запрещён');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Загружает один источник. Никогда не бросает — ошибка сохраняется в источнике. */
export async function fetchSource(source) {
  const fetchedAt = Date.now();
  try {
    const data = await fetchJson(source.url);
    const list = Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : null;
    if (!list) throw new Error('Ожидался JSON-массив продуктов');
    const products = list.map((it) => normalizeRemoteItem(it, source.id, fetchedAt)).filter(Boolean);
    const ids = new Set(products.map((p) => p.id));
    await db.transaction('rw', db.products, db.sources, async () => {
      const stale = (await db.products.where('source').equals(source.id).primaryKeys()).filter((k) => !ids.has(k));
      if (stale.length) await db.products.bulkDelete(stale);
      await db.products.bulkPut(products);
      await db.sources.put({
        ...source,
        lastFetchedAt: fetchedAt,
        lastError: list.length && !products.length ? 'Нет корректных записей' : null,
        count: products.length,
      });
    });
    emitChange('products', false);
    emitChange('sources', false);
    return { ok: true, count: products.length };
  } catch (e) {
    await db.sources.put({ ...source, lastError: e.message || String(e), lastAttemptAt: fetchedAt });
    emitChange('sources', false);
    return { ok: false, error: e.message };
  }
}

/** Загружает включённые источники, которые старше STALE_MS. */
export async function fetchStaleSources(force = false) {
  const sources = (await listSources()).filter((s) => s.enabled);
  const now = Date.now();
  const due = force ? sources : sources.filter((s) => !s.lastFetchedAt || now - s.lastFetchedAt > STALE_MS);
  return Promise.all(due.map(fetchSource));
}
