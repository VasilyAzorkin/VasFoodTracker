// Вся математика калорий. Только чистые функции: без DOM, без БД, без Date.now().

export const NUTRIENTS = ['kcal', 'protein', 'fat', 'carbs'];

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Безопасное приведение к числу: всё нечисловое -> 0. */
export function num(v) {
  if (typeof v === 'string') v = v.replace(',', '.').trim();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Округление до d знаков (по умолчанию 1). */
export function round(v, d = 1) {
  const f = 10 ** d;
  return Math.round((num(v) + Number.EPSILON) * f) / f;
}

/** Пустой набор нутриентов. */
export function zero() {
  return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
}

/** Нутриенты для указанного веса по значениям на 100 г. */
export function scale(per100, grams) {
  const k = Math.max(0, num(grams)) / 100;
  return {
    kcal: num(per100?.kcal) * k,
    protein: num(per100?.protein) * k,
    fat: num(per100?.fat) * k,
    carbs: num(per100?.carbs) * k,
  };
}

/** Сумма списка наборов нутриентов. */
export function sum(list) {
  const t = zero();
  for (const n of list || []) {
    for (const key of NUTRIENTS) t[key] += num(n?.[key]);
  }
  return t;
}

/** Округлённая копия: ккал до целых, БЖУ до 1 знака. */
export function roundNutrients(n) {
  return {
    kcal: round(n?.kcal, 0),
    protein: round(n?.protein, 1),
    fat: round(n?.fat, 1),
    carbs: round(n?.carbs, 1),
  };
}

function lookup(productsById, id) {
  if (!productsById) return undefined;
  if (typeof productsById.get === 'function') return productsById.get(id);
  return productsById[id];
}

/**
 * Итог по блюду.
 * @param ingredients [{productId, grams}]
 * @param productsById Map или объект id -> продукт
 * @returns {kcal, protein, fat, carbs, totalGrams, lines, missing}
 */
export function dishTotals(ingredients, productsById) {
  const lines = [];
  const missing = [];
  let totalGrams = 0;
  for (const ing of ingredients || []) {
    const grams = Math.max(0, num(ing?.grams));
    totalGrams += grams;
    const product = lookup(productsById, ing?.productId);
    if (!product || product.deleted) {
      missing.push(ing?.productId);
      lines.push({ productId: ing?.productId, grams, ...zero(), missing: true });
      continue;
    }
    lines.push({ productId: ing.productId, grams, ...scale(product, grams), missing: false });
  }
  return { ...sum(lines), totalGrams, lines, missing };
}

/** Значения на 100 г из итога блюда. */
export function per100FromTotals(totals) {
  const g = num(totals?.totalGrams);
  if (g <= 0) return zero();
  return scale(totals, (100 * 100) / g);
}

/** Значения на порцию. Если порция не задана — порция = всё блюдо. */
export function perServing(totals, servingGrams) {
  const total = num(totals?.totalGrams);
  const sg = num(servingGrams) > 0 ? num(servingGrams) : total;
  return scale(per100FromTotals(totals), sg);
}

/** Количество порций в блюде. */
export function servingsCount(totals, servingGrams) {
  const total = num(totals?.totalGrams);
  const sg = num(servingGrams);
  if (sg <= 0 || total <= 0) return 1;
  return total / sg;
}

/** Полная сводка по блюду. */
export function dishSummary(dish, productsById) {
  const totals = dishTotals(dish?.ingredients, productsById);
  return {
    totals,
    per100: per100FromTotals(totals),
    perServing: perServing(totals, dish?.servingGrams),
    servingGrams: num(dish?.servingGrams) > 0 ? num(dish.servingGrams) : totals.totalGrams,
    servings: servingsCount(totals, dish?.servingGrams),
  };
}

/** Значения на 100 г для продукта или блюда. */
export function itemPer100(itemType, item, productsById) {
  if (!item) return zero();
  if (itemType === 'dish') return per100FromTotals(dishTotals(item.ingredients, productsById));
  return { kcal: num(item.kcal), protein: num(item.protein), fat: num(item.fat), carbs: num(item.carbs) };
}

/** Энергия по БЖУ (Атвотер: 4/9/4). */
export function kcalFromMacros(protein, fat, carbs) {
  return num(protein) * 4 + num(fat) * 9 + num(carbs) * 4;
}

/** Итог за день по снимкам в записях дневника. */
export function dayTotals(entries) {
  return sum(entries || []);
}

/** Группировка записей по приёмам пищи. */
export function groupByMeal(entries) {
  const groups = { breakfast: [], lunch: [], dinner: [], snack: [] };
  for (const e of entries || []) {
    const key = MEAL_TYPES.includes(e?.mealType) ? e.mealType : 'snack';
    groups[key].push(e);
  }
  return groups;
}

/** Прогресс относительно цели. */
export function goalProgress(consumed, goal) {
  const c = Math.max(0, num(consumed));
  const g = num(goal);
  if (g <= 0) return { percent: 0, clamped: 0, remaining: 0, over: false };
  const percent = (c / g) * 100;
  return {
    percent,
    clamped: Math.min(100, percent),
    remaining: g - c,
    over: c > g,
  };
}

/** Проверка попадания в диапазон; null/'' — граница не задана. */
export function inRange(value, min, max) {
  const v = num(value);
  const hasMin = min !== null && min !== undefined && min !== '' && Number.isFinite(Number(String(min).replace(',', '.')));
  const hasMax = max !== null && max !== undefined && max !== '' && Number.isFinite(Number(String(max).replace(',', '.')));
  if (hasMin && v < num(min)) return false;
  if (hasMax && v > num(max)) return false;
  return true;
}

/** Валидация продукта. Возвращает массив сообщений об ошибках. */
export function validateProduct(p) {
  const errors = [];
  if (!p || !String(p.name || '').trim()) errors.push('Укажите название');
  for (const key of NUTRIENTS) {
    const raw = p?.[key];
    if (raw === '' || raw === null || raw === undefined) {
      if (key === 'kcal') errors.push('Укажите калорийность');
      continue;
    }
    const v = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(v) || v < 0) errors.push(`Некорректное значение: ${key}`);
  }
  const macroSum = num(p?.protein) + num(p?.fat) + num(p?.carbs);
  if (macroSum > 100.5) errors.push('Сумма БЖУ больше 100 г на 100 г');
  return errors;
}

// ---------- Даты (ключи вида YYYY-MM-DD в локальном времени) ----------

const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' (локальное время). */
export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 'YYYY-MM-DD' -> Date (полдень, чтобы не ловить переходы времени). */
export function fromDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** Сдвиг даты на n дней. */
export function addDays(key, n) {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** Последние n дней, заканчивая endKey (по возрастанию). */
export function lastNDays(endKey, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(endKey, -i));
  return out;
}

/** Ряд калорий по дням: [{date, kcal}]. */
export function dailyKcalSeries(entries, days) {
  const byDay = new Map(days.map((d) => [d, 0]));
  for (const e of entries || []) {
    if (byDay.has(e.date)) byDay.set(e.date, byDay.get(e.date) + num(e.kcal));
  }
  return days.map((date) => ({ date, kcal: round(byDay.get(date), 0) }));
}
