// Экран «Поиск»: единый поиск по продуктам и блюдам.
import { listProducts, listDishes, productsMap } from '../db.js';
import { dishSummary } from '../calc.js';
import { h, clear, fmt, fmtKcal, macrosLine, matches, emptyState, searchBox, navigate } from './common.js';
import { openAddEntry } from './diary.js';

const state = { q: '' };

export const title = 'Поиск';

export async function render(root, _params, ctx) {
  const results = h('div', { class: 'search-results' });
  const search = searchBox({ placeholder: 'Продукты и блюда', value: state.q, onInput: (v) => { state.q = v; refresh(); } });
  root.append(h('div', { class: 'sticky-tools' }, search.el), results);

  async function refresh() {
    const q = state.q.trim();
    clear(results);
    if (!q) {
      results.append(emptyState('Введите название продукта или блюда'));
      return;
    }
    const [products, dishes, pmap] = await Promise.all([listProducts(), listDishes(), productsMap()]);
    const foundP = products.filter((p) => matches(q, p.name, p.brand, p.category)).slice(0, 50);
    const foundD = dishes.filter((d) => matches(q, d.name, d.description)).slice(0, 50);
    if (!foundP.length && !foundD.length) {
      results.append(emptyState(`По запросу «${q}» ничего не найдено`));
      return;
    }
    if (foundP.length) {
      results.append(h('h3', { class: 'group-title' }, `Продукты · ${foundP.length}`),
        h('div', { class: 'list' }, foundP.map((p) => resultRow(
          p.name, `${p.category || ''}${p.source !== 'local' ? ' · удалённый' : ''}`, p.kcal, 'на 100 г', macrosLine(p),
          () => navigate(`#/products?edit=${encodeURIComponent(p.id)}`),
          () => openAddEntry({ itemType: 'product', itemId: p.id }),
        ))));
    }
    if (foundD.length) {
      results.append(h('h3', { class: 'group-title' }, `Блюда · ${foundD.length}`),
        h('div', { class: 'list' }, foundD.map((d) => {
          const s = dishSummary(d, pmap);
          return resultRow(
            d.name, `порция ${fmt(s.servingGrams, 0)} г`, s.perServing.kcal, 'на порцию', macrosLine(s.perServing),
            () => navigate(`#/dishes?edit=${encodeURIComponent(d.id)}`),
            () => openAddEntry({ itemType: 'dish', itemId: d.id }),
          );
        })));
    }
  }

  ctx.on('data-changed', refresh);
  await refresh();
  setTimeout(() => search.input.focus(), 50);
}

function resultRow(name, sub, kcal, kcalNote, macros, onOpen, onAdd) {
  return h('div', { class: 'row with-action' },
    h('button', { class: 'row-main as-button', type: 'button', onclick: onOpen },
      h('div', { class: 'row-title' }, name),
      h('div', { class: 'row-sub' }, sub),
      h('div', { class: 'row-sub' }, `${fmtKcal(kcal)} ккал ${kcalNote} · ${macros}`)),
    h('button', { class: 'icon-btn add', type: 'button', 'aria-label': `В дневник: ${name}`, title: 'Добавить в дневник', onclick: onAdd }, '+'));
}
