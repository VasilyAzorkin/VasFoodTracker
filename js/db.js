// Локальное хранилище: IndexedDB через Dexie.
import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.mjs';

export const db = new Dexie('kbzhu-tracker');

// dirty = 1 — запись изменена локально и ещё не отправлена в облако.
db.version(1).stores({
  products: 'id, name, category, source, updatedAt, dirty',
  dishes: 'id, name, updatedAt, dirty',
  diary: 'id, date, mealType, updatedAt, dirty',
  sources: 'id',
  settings: 'key, dirty',
  meta: 'key',
});

export const SYNCABLE_SETTINGS = ['dailyGoalKcal'];
export const DEFAULT_SETTINGS = { dailyGoalKcal: 2000 };

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Сообщить экранам об изменении данных. local=true — изменение сделано пользователем. */
export function emitChange(table, local = true) {
  window.dispatchEvent(new CustomEvent('data-changed', { detail: { table, local } }));
}

const alive = (r) => r && !r.deleted;

// ---------- Общие операции ----------

function isSyncable(table, rec) {
  if (table === 'products') return rec.source === 'local';
  return table === 'dishes' || table === 'diary';
}

/** Сохранить запись (создать или обновить), проставив updatedAt и dirty. */
export async function saveRecord(table, data) {
  const rec = { ...data };
  if (!rec.id) rec.id = uid();
  rec.updatedAt = Date.now();
  rec.deleted = false;
  rec.dirty = isSyncable(table, rec) ? 1 : 0;
  await db[table].put(rec);
  emitChange(table);
  return rec;
}

/** Мягкое удаление (для синхронизации). */
export async function softDelete(table, id) {
  const rec = await db[table].get(id);
  if (!rec) return null;
  rec.deleted = true;
  rec.updatedAt = Date.now();
  rec.dirty = isSyncable(table, rec) ? 1 : 0;
  await db[table].put(rec);
  emitChange(table);
  return rec;
}

/** Отменить мягкое удаление. */
export async function restoreRecord(table, id) {
  const rec = await db[table].get(id);
  if (!rec) return null;
  rec.deleted = false;
  rec.updatedAt = Date.now();
  rec.dirty = isSyncable(table, rec) ? 1 : 0;
  await db[table].put(rec);
  emitChange(table);
  return rec;
}

// ---------- Продукты ----------

export async function listProducts() {
  return (await db.products.toArray()).filter(alive).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export async function getProduct(id) {
  const p = await db.products.get(id);
  return alive(p) ? p : null;
}

/** Map id -> продукт (включая удалённые — для расчёта старых блюд не нужны, поэтому только живые). */
export async function productsMap() {
  const map = new Map();
  for (const p of await db.products.toArray()) if (alive(p)) map.set(p.id, p);
  return map;
}

export const saveProduct = (p) => saveRecord('products', { source: 'local', ...p });

// ---------- Блюда ----------

export async function listDishes() {
  return (await db.dishes.toArray()).filter(alive).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export async function getDish(id) {
  const d = await db.dishes.get(id);
  return alive(d) ? d : null;
}

export const saveDish = (d) => saveRecord('dishes', d);

// ---------- Дневник ----------

export async function entriesForDate(date) {
  return (await db.diary.where('date').equals(date).toArray())
    .filter(alive)
    .sort((a, b) => (a.createdAt || a.updatedAt) - (b.createdAt || b.updatedAt));
}

export async function entriesBetween(from, to) {
  return (await db.diary.where('date').between(from, to, true, true).toArray()).filter(alive);
}

export async function allEntries() {
  return (await db.diary.toArray()).filter(alive);
}

export const saveEntry = (e) => saveRecord('diary', { createdAt: Date.now(), ...e });

// ---------- Настройки (синхронизируемые) ----------

export async function getSetting(key) {
  const rec = await db.settings.get(key);
  if (rec && !rec.deleted) return rec.value;
  return DEFAULT_SETTINGS[key];
}

export async function setSetting(key, value) {
  await db.settings.put({
    key,
    value,
    updatedAt: Date.now(),
    deleted: false,
    dirty: SYNCABLE_SETTINGS.includes(key) ? 1 : 0,
  });
  emitChange('settings');
}

// ---------- Служебные значения (только локально) ----------

export async function getMeta(key, fallback = null) {
  const rec = await db.meta.get(key);
  return rec ? rec.value : fallback;
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}

// ---------- Экспорт / импорт ----------

const strip = ({ dirty, ...rest }) => rest;

export async function exportAll() {
  return {
    app: 'kbzhu-tracker',
    format: 1,
    exportedAt: new Date().toISOString(),
    products: (await db.products.toArray()).map(strip),
    dishes: (await db.dishes.toArray()).map(strip),
    diary: (await db.diary.toArray()).map(strip),
    sources: await db.sources.toArray(),
    settings: (await db.settings.toArray()).map(strip),
  };
}

/** Импорт с объединением: побеждает запись с большим updatedAt. */
export async function importAll(data) {
  if (!data || typeof data !== 'object' || data.app !== 'kbzhu-tracker') {
    throw new Error('Файл не похож на резервную копию этого приложения');
  }
  const stats = { added: 0, updated: 0, skipped: 0 };
  const tables = ['products', 'dishes', 'diary', 'settings'];
  await db.transaction('rw', db.products, db.dishes, db.diary, db.settings, db.sources, async () => {
    for (const table of tables) {
      const pk = table === 'settings' ? 'key' : 'id';
      for (const rec of data[table] || []) {
        if (!rec || !rec[pk]) { stats.skipped++; continue; }
        const existing = await db[table].get(rec[pk]);
        if (existing && Number(existing.updatedAt) > Number(rec.updatedAt || 0)) { stats.skipped++; continue; }
        const syncable = table === 'settings' ? SYNCABLE_SETTINGS.includes(rec.key) : isSyncable(table, rec);
        await db[table].put({ ...rec, updatedAt: Number(rec.updatedAt) || Date.now(), dirty: syncable ? 1 : 0 });
        existing ? stats.updated++ : stats.added++;
      }
    }
    for (const src of data.sources || []) {
      if (src?.id && !(await db.sources.get(src.id))) await db.sources.put(src);
    }
  });
  emitChange('all');
  return stats;
}

export async function clearAll() {
  db.close();
  await Dexie.delete('kbzhu-tracker');
}
