// Экран «Блюда» и редактор блюда с живым расчётом.
import { listDishes, getDish, saveDish, softDelete, restoreRecord, productsMap } from '../db.js';
import { dishSummary, dishTotals, per100FromTotals, perServing, servingsCount, inRange, round } from '../calc.js';
import {
  h, clear, fmt, fmtKcal, parseNum, macrosLine, matches, toast, openSheet, confirmDialog,
  field, textInput, numberInput, emptyState, searchBox,
} from './common.js';

const state = { q: '', kmin: '', kmax: '' };

export const title = 'Блюда';

export async function render(root, params, ctx) {
  const list = h('div', { class: 'list' });
  const search = searchBox({ placeholder: 'Поиск блюд', value: state.q, onInput: (v) => { state.q = v; refresh(); } });
  const kmin = numberInput({ placeholder: 'от', value: state.kmin, oninput: (e) => { state.kmin = e.target.value; refresh(); } });
  const kmax = numberInput({ placeholder: 'до', value: state.kmax, oninput: (e) => { state.kmax = e.target.value; refresh(); } });

  root.append(
    h('div', { class: 'sticky-tools' },
      search.el,
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => openDishEditor() }, '+ Блюдо'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'muted small' }, 'ккал/порц.'),
        h('div', { class: 'range compact' }, kmin, h('span', {}, '–'), kmax)),
    ),
    list,
  );

  async function refresh() {
    const [dishes, products] = await Promise.all([listDishes(), productsMap()]);
    const rows = dishes
      .map((d) => ({ d, s: dishSummary(d, products) }))
      .filter(({ d, s }) => matches(state.q, d.name, d.description) && inRange(s.perServing.kcal, state.kmin, state.kmax));
    clear(list);
    if (!rows.length) {
      list.append(emptyState(dishes.length ? 'Ничего не найдено' : 'Блюд пока нет'));
      return;
    }
    for (const { d, s } of rows) {
      list.append(h('button', { class: 'row', type: 'button', onclick: () => openDishEditor(d) },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, d.name),
          h('div', { class: 'row-sub' },
            `Порция ${fmt(s.servingGrams, 0)} г · ${d.ingredients?.length || 0} ингр.`,
            s.totals.missing.length ? h('span', { class: 'badge warn' }, 'нет продукта') : null),
          d.description ? h('div', { class: 'row-desc' }, d.description) : null,
        ),
        h('div', { class: 'row-side' },
          h('div', { class: 'kcal' }, fmtKcal(s.perServing.kcal), h('small', {}, ' ккал')),
          h('div', { class: 'row-sub' }, macrosLine(s.perServing)),
        ),
      ));
    }
  }

  ctx.on('data-changed', refresh);
  await refresh();

  const editId = params.get('edit');
  if (editId) {
    history.replaceState(null, '', '#/dishes');
    const d = await getDish(editId);
    if (d) openDishEditor(d);
  }
}

/** Редактор блюда. */
export async function openDishEditor(dish = null) {
  const products = await productsMap();
  const draft = {
    name: '', description: '', servingGrams: '', ingredients: [],
    ...(dish ? structuredClone(dish) : {}),
  };

  const name = textInput({ value: draft.name, placeholder: 'Например, Плов' });
  const description = h('textarea', { rows: 2, placeholder: 'Описание, способ приготовления' });
  description.value = draft.description || '';
  const serving = numberInput({ value: draft.servingGrams ? String(draft.servingGrams) : '', placeholder: 'всё блюдо' });
  const ingList = h('div', { class: 'ing-list' });
  const calcBox = h('div', { class: 'calc-box' });
  const errors = h('div', { class: 'errors' });

  const descField = field('Описание', description);

  function recalc() {
    draft.servingGrams = parseNum(serving.value) ?? 0;
    const totals = dishTotals(draft.ingredients, products);
    const per100 = per100FromTotals(totals);
    const portion = perServing(totals, draft.servingGrams);
    const sg = draft.servingGrams > 0 ? draft.servingGrams : totals.totalGrams;
    const servings = servingsCount(totals, draft.servingGrams);

    // обновить ккал по строкам ингредиентов
    totals.lines.forEach((line, i) => {
      const el = ingList.children[i]?.querySelector('.ing-kcal');
      if (el) el.textContent = line.missing ? '—' : `${fmtKcal(line.kcal)} ккал`;
    });

    clear(calcBox).append(
      calcRow('Всё блюдо', `${fmt(totals.totalGrams, 0)} г`, totals),
      calcRow('На порцию', `${fmt(sg, 0)} г`, portion),
      calcRow('На 100 г', '', per100),
      h('div', { class: 'muted small' }, `Порций: ${fmt(servings, 1)}`),
      totals.missing.length ? h('div', { class: 'warn-text small' }, 'Некоторые продукты не найдены и не учитываются') : null,
    );
  }

  function calcRow(label, weight, n) {
    return h('div', { class: 'calc-row' },
      h('div', {}, h('b', {}, label), weight ? h('span', { class: 'muted' }, ` · ${weight}`) : null),
      h('div', { class: 'calc-val' }, h('b', {}, `${fmtKcal(n.kcal)} ккал`), h('div', { class: 'muted small' }, macrosLine(n))),
    );
  }

  function renderIngredients() {
    clear(ingList);
    if (!draft.ingredients.length) ingList.append(h('p', { class: 'muted small' }, 'Добавьте ингредиенты'));
    draft.ingredients.forEach((ing, i) => {
      const p = products.get(ing.productId);
      const grams = numberInput({ value: String(ing.grams ?? ''), class: 'grams' });
      grams.addEventListener('input', () => { ing.grams = parseNum(grams.value) ?? 0; recalc(); });
      ingList.append(h('div', { class: 'ing-row' },
        h('div', { class: 'ing-name' }, p ? p.name : h('span', { class: 'warn-text' }, 'Продукт удалён'),
          h('div', { class: 'ing-kcal muted small' })),
        h('div', { class: 'ing-grams' }, grams, h('span', { class: 'muted' }, 'г')),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Убрать',
          onclick: () => { draft.ingredients.splice(i, 1); renderIngredients(); },
        }, '✕'),
      ));
    });
    recalc();
  }

  for (const el of [serving]) el.addEventListener('input', recalc);

  const body = h('div', { class: 'form' },
    field('Название', name),
    descField,
    field('Размер порции, г', serving, { mic: false, hint: 'Пусто — порция равна всему блюду' }),
    h('div', { class: 'section-head' },
      h('h3', {}, 'Ингредиенты'),
      h('button', {
        class: 'btn small', type: 'button',
        onclick: () => openIngredientPicker(products, (productId, grams) => {
          draft.ingredients.push({ productId, grams });
          renderIngredients();
        }),
      }, '+ Ингредиент')),
    ingList,
    calcBox,
    errors,
  );

  renderIngredients();

  const actions = [];
  if (dish?.id) {
    actions.push({
      label: 'Удалить', kind: 'danger ghost',
      onClick: async () => {
        if (!(await confirmDialog(`Удалить блюдо «${dish.name}»?`))) return false;
        await softDelete('dishes', dish.id);
        toast(`«${dish.name}» удалено`, {
          action: 'Отменить', duration: 6000,
          onAction: async () => { await restoreRecord('dishes', dish.id); toast('Восстановлено'); },
        });
      },
    });
  }
  actions.push({ label: 'Отмена', kind: 'ghost' });
  actions.push({
    label: 'Сохранить', kind: 'primary',
    onClick: async () => {
      clear(errors);
      const errs = [];
      if (!name.value.trim()) errs.push('Укажите название');
      if (!draft.ingredients.length) errs.push('Добавьте хотя бы один ингредиент');
      if (draft.ingredients.some((i) => !(Number(i.grams) > 0))) errs.push('Вес каждого ингредиента должен быть больше 0');
      if (errs.length) { errors.append(...errs.map((e) => h('div', {}, e))); return false; }
      await saveDish({
        ...(dish || {}),
        name: name.value.trim(),
        description: description.value.trim(),
        servingGrams: round(parseNum(serving.value) ?? 0, 1),
        ingredients: draft.ingredients.map((i) => ({ productId: i.productId, grams: round(i.grams, 1) })),
      });
      toast(dish?.id ? 'Блюдо сохранено' : 'Блюдо добавлено');
    },
  });

  return openSheet({ title: dish?.id ? 'Редактировать блюдо' : 'Новое блюдо', body, actions, full: true });
}

/** Выбор продукта для ингредиента: поиск + граммы. */
function openIngredientPicker(products, onPick) {
  const grams = numberInput({ value: '100', class: 'grams' });
  const results = h('div', { class: 'list compact' });
  const all = [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  let sheet;

  const renderResults = (q) => {
    clear(results);
    const found = all.filter((p) => matches(q, p.name, p.brand, p.category)).slice(0, 60);
    if (!found.length) { results.append(emptyState('Ничего не найдено')); return; }
    for (const p of found) {
      const g = () => parseNum(grams.value) ?? 100;
      results.append(h('button', {
        class: 'row', type: 'button',
        onclick: () => {
          if (!(g() > 0)) { toast('Укажите вес', { kind: 'error' }); return; }
          onPick(p.id, g());
          sheet.close();
        },
      },
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, p.name), h('div', { class: 'row-sub' }, p.category || '')),
        h('div', { class: 'row-side' }, h('div', { class: 'kcal' }, fmtKcal(p.kcal), h('small', {}, ' /100 г'))),
      ));
    }
  };

  const search = searchBox({ placeholder: 'Найти продукт', onInput: renderResults });
  sheet = openSheet({
    title: 'Добавить ингредиент',
    full: true,
    body: h('div', { class: 'form' },
      h('div', { class: 'picker-top' }, search.el, h('div', { class: 'ing-grams' }, grams, h('span', { class: 'muted' }, 'г'))),
      h('small', { class: 'muted' }, 'Укажите вес и нажмите на продукт'),
      results),
    actions: [],
  });
  renderResults('');
  setTimeout(() => search.input.focus(), 50);
}

