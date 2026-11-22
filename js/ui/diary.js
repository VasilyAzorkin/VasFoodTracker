// Экран «Дневник»: день по приёмам пищи, прогресс к цели, график за 7 дней, список дней.
import {
  entriesForDate, entriesBetween, allEntries, saveEntry, softDelete, restoreRecord,
  getSetting, productsMap, listProducts, listDishes, getProduct, getDish,
} from '../db.js';
import {
  dayTotals, groupByMeal, goalProgress, toDateKey, fromDateKey, addDays, lastNDays,
  dailyKcalSeries, itemPer100, scale, roundNutrients, MEAL_TYPES, num,
} from '../calc.js';
import {
  h, clear, fmt, fmtKcal, parseNum, macrosLine, matches, toast, openSheet, field,
  numberInput, textInput, select, emptyState, searchBox, MEAL_LABELS,
} from './common.js';

const CHART_SRC = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js';
const state = { date: null, historyLimit: 14 };

export const title = 'Дневник';

const today = () => toDateKey(new Date());

function dateLabel(key) {
  const t = today();
  if (key === t) return 'Сегодня';
  if (key === addDays(t, -1)) return 'Вчера';
  if (key === addDays(t, 1)) return 'Завтра';
  return fromDateKey(key).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}

function guessMeal() {
  const hr = new Date().getHours();
  if (hr < 11) return 'breakfast';
  if (hr < 16) return 'lunch';
  if (hr < 21) return 'dinner';
  return 'snack';
}

export async function render(root, params, ctx) {
  state.date = params.get('date') || state.date || today();
  let chart = null;
  ctx.onCleanup(() => chart?.destroy());

  const dateInput = h('input', { type: 'date', class: 'date-input', value: state.date, 'aria-label': 'Выбрать дату' });
  const dateText = h('span', { class: 'date-text' });
  dateInput.addEventListener('change', () => { if (dateInput.value) setDate(dateInput.value); });

  const nav = h('div', { class: 'date-nav card' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Предыдущий день', onclick: () => setDate(addDays(state.date, -1)) }, '‹'),
    h('label', { class: 'date-pick' }, dateText, dateInput),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Следующий день', onclick: () => setDate(addDays(state.date, 1)) }, '›'),
  );
  const todayBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: () => setDate(today()) }, 'К сегодняшнему дню');

  const summary = h('div', { class: 'card summary' });
  const meals = h('div', { class: 'meals' });
  const chartCanvas = h('canvas', { height: 180, 'aria-label': 'Калории за последние 7 дней', role: 'img' });
  const chartBox = h('div', { class: 'card' }, h('h3', {}, 'Последние 7 дней'), h('div', { class: 'chart-wrap' }, chartCanvas));
  const historyCard = h("div", { class: "card" });

  root.append(nav, todayBtn, summary, meals, chartBox, historyCard,
    h('button', { class: 'fab', type: 'button', 'aria-label': 'Добавить запись', onclick: () => openAddEntry({ date: state.date }) }, '+'));

  function setDate(d) {
    state.date = d;
    dateInput.value = d;
    refresh();
  }

  async function refresh() {
    dateText.textContent = dateLabel(state.date);
    todayBtn.hidden = state.date === today();
    const [entries, goal] = await Promise.all([entriesForDate(state.date), getSetting('dailyGoalKcal')]);
    renderSummary(entries, goal);
    renderMeals(entries);
    await renderChart(goal);
    await renderHistory(goal);
  }

  function renderSummary(entries, goal) {
    const t = dayTotals(entries);
    const p = goalProgress(t.kcal, goal);
    clear(summary).append(
      h('div', { class: 'summary-top' },
        h('div', {}, h('span', { class: 'big' }, fmtKcal(t.kcal)), h('span', { class: 'muted' }, ` / ${fmtKcal(goal)} ккал`)),
        h('div', { class: p.over ? 'over' : 'muted' },
          p.over ? `+${fmtKcal(-p.remaining)} сверх цели` : `осталось ${fmtKcal(p.remaining)}`)),
      h('div', { class: `progress ${p.over ? 'over' : ''}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(p.clamped) },
        h('div', { class: 'progress-fill', style: `width:${p.clamped}%` })),
      h('div', { class: 'macros' },
        macroPill('Белки', t.protein), macroPill('Жиры', t.fat), macroPill('Углеводы', t.carbs)),
    );
  }

  function macroPill(label, v) {
    return h('div', { class: 'macro' }, h('b', {}, `${fmt(v, 0)} г`), h('small', {}, label));
  }

  function renderMeals(entries) {
    const groups = groupByMeal(entries);
    clear(meals);
    for (const meal of MEAL_TYPES) {
      const list = groups[meal];
      const t = dayTotals(list);
      meals.append(h('section', { class: 'card meal' },
        h('div', { class: 'meal-head' },
          h('h3', {}, MEAL_LABELS[meal]),
          h('span', { class: 'muted' }, list.length ? `${fmtKcal(t.kcal)} ккал` : ''),
          h('button', { class: 'icon-btn add', type: 'button', 'aria-label': `Добавить: ${MEAL_LABELS[meal]}`, onclick: () => openAddEntry({ date: state.date, mealType: meal }) }, '+')),
        list.map((e) => h('button', { class: 'entry', type: 'button', onclick: () => openEditEntry(e) },
          h('div', { class: 'row-main' },
            h('div', { class: 'row-title' }, e.name || '—', e.itemType === 'dish' ? h('span', { class: 'badge' }, 'блюдо') : null),
            h('div', { class: 'row-sub' }, `${fmt(e.grams, 0)} г`, e.note ? ` · ${e.note}` : '')),
          h('div', { class: 'row-side' }, h('b', {}, fmtKcal(e.kcal)), h('small', { class: 'muted' }, ' ккал')),
        )),
      ));
    }
  }

  async function renderChart(goal) {
    const days = lastNDays(state.date, 7);
    const entries = await entriesBetween(days[0], days[days.length - 1]);
    const series = dailyKcalSeries(entries, days);
    const Chart = await loadChart();
    if (!Chart) {
      chartBox.querySelector('.chart-wrap').replaceChildren(simpleBars(series, goal));
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const color = (n) => css.getPropertyValue(n).trim();
    const labels = series.map((s) => fromDateKey(s.date).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' }));
    const data = series.map((s) => s.kcal);
    const bg = series.map((s) => (s.date === state.date ? color('--accent') : s.kcal > goal ? color('--danger') : color('--accent-soft')));
    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = data;
      chart.data.datasets[0].backgroundColor = bg;
      chart.data.datasets[1].data = days.map(() => goal);
      chart.update();
      return;
    }
    chart = new Chart(chartCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Ккал', data, backgroundColor: bg, borderRadius: 6, maxBarThickness: 36 },
          { type: 'line', label: 'Цель', data: days.map(() => goal), borderColor: color('--muted'), borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtKcal(c.parsed.y)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: color('--muted') } },
          y: { beginAtZero: true, grid: { color: color('--border') }, ticks: { color: color('--muted') } },
        },
        onClick: (_e, els) => {
          const el = els.find((x) => x.datasetIndex === 0);
          if (el) setDate(days[el.index]);
        },
      },
    });
  }

  function simpleBars(series, goal) {
    const max = Math.max(goal, ...series.map((s) => s.kcal), 1);
    return h('div', { class: 'simple-bars' }, series.map((s) =>
      h('button', { class: 'sb', type: 'button', onclick: () => setDate(s.date), title: `${s.date}: ${s.kcal} ккал` },
        h('div', { class: `sb-fill ${s.kcal > goal ? 'over' : ''}`, style: `height:${(s.kcal / max) * 100}%` }),
        h('small', {}, fromDateKey(s.date).toLocaleDateString('ru-RU', { weekday: 'short' })))));
  }

  async function renderHistory(goal) {
    const entries = await allEntries();
    const byDay = new Map();
    for (const e of entries) byDay.set(e.date, (byDay.get(e.date) || 0) + num(e.kcal));
    const days = [...byDay.keys()].sort().reverse();
    clear(historyCard).append(h('h3', {}, 'Дни'));
    if (!days.length) {
      historyCard.append(h('p', { class: 'muted small' }, 'Записей пока нет. Нажмите «+», чтобы добавить первую.'));
      return;
    }
    for (const d of days.slice(0, state.historyLimit)) {
      const kcal = byDay.get(d);
      const p = goalProgress(kcal, goal);
      historyCard.append(h('button', { class: `day-row ${d === state.date ? 'active' : ''}`, type: 'button', onclick: () => { setDate(d); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
        h('span', { class: 'day-name' }, dateLabel(d)),
        h('span', { class: `mini-progress ${p.over ? 'over' : ''}` }, h('span', { style: `width:${p.clamped}%` })),
        h('span', { class: 'day-kcal' }, fmtKcal(kcal))));
    }
    if (days.length > state.historyLimit) {
      historyCard.append(h('button', { class: 'btn ghost small', type: 'button', onclick: () => { state.historyLimit += 30; renderHistory(goal); } }, 'Показать ещё'));
    }
  }

  ctx.on('data-changed', refresh);
  await refresh();
}

let chartPromise = null;
function loadChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!chartPromise) {
    chartPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = CHART_SRC;
      s.onload = () => resolve(window.Chart || null);
      s.onerror = () => { chartPromise = null; resolve(null); };
      document.head.appendChild(s);
    });
  }
  return chartPromise;
}

// ---------------------------------------------------------------------------
// Добавление и редактирование записи
// ---------------------------------------------------------------------------

/**
 * Лист добавления записи.
 * @param {{date?:string, mealType?:string, itemType?:'product'|'dish', itemId?:string}} opts
 */
export async function openAddEntry({ date = today(), mealType = guessMeal(), itemType = 'product', itemId = null } = {}) {
  const [products, dishes, pmap] = await Promise.all([listProducts(), listDishes(), productsMap()]);
  let type = itemType;
  let selected = null;
  if (itemId) selected = type === 'dish' ? dishes.find((d) => d.id === itemId) : products.find((p) => p.id === itemId);

  const tabs = h('div', { class: 'segmented', role: 'tablist' });
  const results = h('div', { class: 'list compact picker-results' });
  const chosen = h('div', { class: 'chosen' });
  const grams = numberInput({ value: '100' });
  const meal = select(MEAL_TYPES.map((m) => [m, MEAL_LABELS[m]]), mealType);
  const dateInput = h('input', { type: 'date', value: date });
  const note = textInput({ placeholder: 'необязательно' });
  const live = h('div', { class: 'live-kcal' });
  const search = searchBox({ placeholder: 'Найти продукт или блюдо', onInput: () => renderResults() });

  const per100 = () => (selected ? itemPer100(type, selected, pmap) : null);

  function defaultGrams() {
    if (type === 'dish' && selected) {
      const g = num(selected.servingGrams) || selected.ingredients?.reduce((s, i) => s + num(i.grams), 0) || 100;
      return String(Math.round(g));
    }
    return '100';
  }

  function renderTabs() {
    clear(tabs);
    for (const [t, label] of [['product', 'Продукт'], ['dish', 'Блюдо']]) {
      tabs.append(h('button', {
        type: 'button', role: 'tab', class: t === type ? 'active' : '', 'aria-selected': String(t === type),
        onclick: () => { if (type !== t) { type = t; selected = null; renderTabs(); renderResults(); updateLive(); } },
      }, label));
    }
  }

  function renderResults() {
    clear(results);
    clear(chosen);
    if (selected) {
      results.hidden = true;
      chosen.append(h('div', { class: 'row selected' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, selected.name),
          h('div', { class: 'row-sub' }, `${fmtKcal(per100().kcal)} ккал / 100 г`)),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => { selected = null; renderResults(); updateLive(); } }, 'Изменить')));
      return;
    }
    results.hidden = false;
    const source = type === 'dish' ? dishes : products;
    const q = search.input.value;
    const found = source.filter((x) => matches(q, x.name, x.brand, x.category, x.description)).slice(0, 40);
    if (!found.length) { results.append(emptyState('Ничего не найдено')); return; }
    for (const x of found) {
      const p100 = itemPer100(type, x, pmap);
      results.append(h('button', {
        class: 'row', type: 'button',
        onclick: () => { selected = x; grams.value = defaultGrams(); renderResults(); updateLive(); grams.focus(); grams.select(); },
      },
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, x.name), h('div', { class: 'row-sub' }, type === 'dish' ? `порция ${fmt(x.servingGrams || 0, 0)} г` : (x.category || ''))),
        h('div', { class: 'row-side' }, h('div', { class: 'kcal' }, fmtKcal(p100.kcal), h('small', {}, ' /100 г')))));
    }
  }

  function updateLive() {
    if (!selected) { live.textContent = 'Выберите продукт или блюдо'; return; }
    const n = roundNutrients(scale(per100(), parseNum(grams.value) ?? 0));
    clear(live).append(h('b', {}, `${fmtKcal(n.kcal)} ккал`), h('span', { class: 'muted' }, ` · ${macrosLine(n)}`));
  }
  grams.addEventListener('input', updateLive);

  if (selected) grams.value = defaultGrams();
  renderTabs();
  renderResults();
  updateLive();

  openSheet({
    title: 'Добавить в дневник',
    full: true,
    body: h('div', { class: 'form' },
      tabs, search.el, results, chosen,
      h('div', { class: 'grid-2' },
        field('Вес, г', grams, { mic: true }),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Приём пищи'), meal)),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Дата'), dateInput),
      field('Заметка', note),
      live),
    actions: [
      { label: 'Отмена', kind: 'ghost' },
      {
        label: 'Добавить', kind: 'primary',
        onClick: async () => {
          if (!selected) { toast('Выберите продукт или блюдо', { kind: 'error' }); return false; }
          const g = parseNum(grams.value);
          if (!(g > 0)) { toast('Укажите вес больше 0', { kind: 'error' }); return false; }
          const n = roundNutrients(scale(per100(), g));
          await saveEntry({
            date: dateInput.value || date,
            mealType: meal.value,
            itemType: type,
            itemId: selected.id,
            name: selected.name,
            grams: g,
            ...n,
            note: note.value.trim() || undefined,
          });
          toast(`Добавлено: ${selected.name}, ${fmtKcal(n.kcal)} ккал`);
        },
      },
    ],
  });
  if (!selected) setTimeout(() => search.input.focus(), 50);
}

async function openEditEntry(entry) {
  const pmap = await productsMap();
  const item = entry.itemType === 'dish' ? await getDish(entry.itemId) : await getProduct(entry.itemId);
  // если исходный продукт удалён — считаем по снимку
  const per100 = item
    ? itemPer100(entry.itemType, item, pmap)
    : scale({ kcal: entry.kcal, protein: entry.protein, fat: entry.fat, carbs: entry.carbs }, entry.grams > 0 ? 10000 / entry.grams : 0);

  const grams = numberInput({ value: String(entry.grams) });
  const meal = select(MEAL_TYPES.map((m) => [m, MEAL_LABELS[m]]), entry.mealType);
  const dateInput = h('input', { type: 'date', value: entry.date });
  const note = textInput({ value: entry.note || '', placeholder: 'необязательно' });
  const live = h('div', { class: 'live-kcal' });
  const update = () => {
    const n = roundNutrients(scale(per100, parseNum(grams.value) ?? 0));
    clear(live).append(h('b', {}, `${fmtKcal(n.kcal)} ккал`), h('span', { class: 'muted' }, ` · ${macrosLine(n)}`));
  };
  grams.addEventListener('input', update);
  update();

  openSheet({
    title: entry.name || 'Запись',
    body: h('div', { class: 'form' },
      !item ? h('div', { class: 'note' }, 'Исходный продукт или блюдо удалены — расчёт по сохранённым значениям.') : null,
      h('div', { class: 'grid-2' },
        field('Вес, г', grams, { mic: true }),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Приём пищи'), meal)),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Дата'), dateInput),
      field('Заметка', note),
      live),
    actions: [
      {
        label: 'Удалить', kind: 'danger ghost',
        onClick: async () => {
          await softDelete('diary', entry.id);
          toast('Запись удалена', {
            action: 'Отменить', duration: 6000,
            onAction: async () => { await restoreRecord('diary', entry.id); toast('Восстановлено'); },
          });
        },
      },
      { label: 'Отмена', kind: 'ghost' },
      {
        label: 'Сохранить', kind: 'primary',
        onClick: async () => {
          const g = parseNum(grams.value);
          if (!(g > 0)) { toast('Укажите вес больше 0', { kind: 'error' }); return false; }
          await saveEntry({
            ...entry,
            grams: g,
            mealType: meal.value,
            date: dateInput.value || entry.date,
            note: note.value.trim() || undefined,
            ...roundNutrients(scale(per100, g)),
          });
          toast('Запись обновлена');
        },
      },
    ],
  });
}
