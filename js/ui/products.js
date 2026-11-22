// Экран «Продукты».
import { listProducts, getProduct, saveProduct, softDelete, restoreRecord } from '../db.js';
import { listSources } from '../remote.js';
import { inRange, kcalFromMacros, validateProduct, round } from '../calc.js';
import { isSpeechSupported, listen, parseFoodPhrase, stopListening } from '../voice.js';
import {
  h, clear, fmt, fmtKcal, parseNum, macrosLine, matches, toast, openSheet, confirmDialog,
  field, textInput, numberInput, select, emptyState, searchBox, CATEGORIES, micIcon,
} from './common.js';

const state = { q: '', category: '', source: '', kmin: '', kmax: '', showFilters: false };

export const title = 'Продукты';

export async function render(root, params, ctx) {
  const list = h('div', { class: 'list' });
  const counter = h('div', { class: 'muted small' });

  const search = searchBox({ placeholder: 'Поиск продуктов', value: state.q, onInput: (v) => { state.q = v; refresh(); } });

  const catSel = h('select', { onchange: (e) => { state.category = e.target.value; refresh(); } });
  const srcSel = h('select', { onchange: (e) => { state.source = e.target.value; refresh(); } });
  const kmin = numberInput({ placeholder: 'от', value: state.kmin, oninput: (e) => { state.kmin = e.target.value; refresh(); } });
  const kmax = numberInput({ placeholder: 'до', value: state.kmax, oninput: (e) => { state.kmax = e.target.value; refresh(); } });

  const filters = h('div', { class: 'filters', hidden: !state.showFilters },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Категория'), catSel),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Источник'), srcSel),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Ккал на 100 г'),
      h('div', { class: 'range' }, kmin, h('span', {}, '–'), kmax)),
    h('button', { class: 'btn ghost small', type: 'button', onclick: resetFilters }, 'Сбросить фильтры'),
  );

  const filterBtn = h('button', {
    class: 'btn ghost', type: 'button',
    onclick: () => { state.showFilters = !state.showFilters; filters.hidden = !state.showFilters; },
  }, 'Фильтры');

  function resetFilters() {
    Object.assign(state, { category: '', source: '', kmin: '', kmax: '' });
    catSel.value = ''; srcSel.value = ''; kmin.value = ''; kmax.value = '';
    refresh();
  }

  const actions = h('div', { class: 'toolbar' },
    h('button', { class: 'btn primary', type: 'button', onclick: () => openProductEditor() }, '+ Продукт'),
    isSpeechSupported()
      ? h('button', { class: 'btn', type: 'button', onclick: openVoiceQuickAdd }, micIcon(), ' Голосом')
      : null,
    h('span', { class: 'spacer' }),
    filterBtn,
  );

  root.append(h('div', { class: 'sticky-tools' }, search.el, actions, filters), counter, list);

  async function refresh() {
    const [products, sources] = await Promise.all([listProducts(), listSources()]);
    const srcName = new Map(sources.map((s) => [s.id, s.name]));

    const cats = [...new Set([...CATEGORIES, ...products.map((p) => p.category).filter(Boolean)])];
    fillSelect(catSel, [['', 'Все категории'], ...cats.map((c) => [c, c])], state.category);
    fillSelect(srcSel, [['', 'Все источники'], ['local', 'Мои продукты'], ...sources.map((s) => [s.id, s.name])], state.source);

    const filtered = products.filter((p) =>
      matches(state.q, p.name, p.brand, p.category) &&
      (!state.category || p.category === state.category) &&
      (!state.source || p.source === state.source) &&
      inRange(p.kcal, state.kmin, state.kmax));

    counter.textContent = `Найдено: ${filtered.length} из ${products.length}`;
    clear(list);
    if (!filtered.length) {
      list.append(emptyState(products.length ? 'Ничего не найдено' : 'Продуктов пока нет'));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const p of filtered.slice(0, 300)) frag.append(productRow(p, srcName.get(p.source)));
    list.append(frag);
    if (filtered.length > 300) list.append(h('p', { class: 'muted small center' }, 'Показаны первые 300 — уточните поиск'));
  }

  ctx.on('data-changed', refresh);
  await refresh();

  const editId = params.get('edit');
  if (editId) {
    history.replaceState(null, '', '#/products');
    const p = await getProduct(editId);
    if (p) openProductEditor(p);
  }
}

function fillSelect(sel, options, value) {
  clear(sel);
  for (const [v, label] of options) sel.append(h('option', { value: v }, label));
  sel.value = options.some(([v]) => v === value) ? value : '';
}

function productRow(p, sourceName) {
  const remote = p.source !== 'local';
  return h('button', { class: 'row', type: 'button', onclick: () => openProductEditor(p) },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, p.name, p.brand ? h('span', { class: 'muted' }, ` · ${p.brand}`) : null),
      h('div', { class: 'row-sub' },
        p.category || 'Без категории',
        remote ? h('span', { class: 'badge' }, sourceName || 'удалённый') : null),
    ),
    h('div', { class: 'row-side' },
      h('div', { class: 'kcal' }, fmtKcal(p.kcal), h('small', {}, ' ккал')),
      h('div', { class: 'row-sub' }, macrosLine(p)),
    ),
  );
}

/** Редактор продукта. Для удалённых продуктов — просмотр и копирование. */
export function openProductEditor(product = null, { prefill = null, note = null } = {}) {
  const remote = product && product.source !== 'local';
  const data = { name: '', brand: '', category: 'Другое', kcal: '', protein: '', fat: '', carbs: '', ...(product || {}), ...(prefill || {}) };
  const show = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

  const name = textInput({ value: data.name, placeholder: 'Например, Творог 5%', disabled: remote });
  const brand = textInput({ value: data.brand || '', placeholder: 'необязательно', disabled: remote });
  const cats = CATEGORIES.includes(data.category) ? CATEGORIES : [data.category, ...CATEGORIES];
  const category = select(cats.map((c) => [c, c]), data.category, { disabled: remote });
  const kcal = numberInput({ value: show(data.kcal), disabled: remote });
  const protein = numberInput({ value: show(data.protein), disabled: remote });
  const fat = numberInput({ value: show(data.fat), disabled: remote });
  const carbs = numberInput({ value: show(data.carbs), disabled: remote });
  const hint = h('small', { class: 'hint' });
  const errors = h('div', { class: 'errors' });

  const updateHint = () => {
    const est = kcalFromMacros(parseNum(protein.value), parseNum(fat.value), parseNum(carbs.value));
    hint.textContent = est > 0 ? `По БЖУ ≈ ${fmtKcal(est)} ккал` : '';
  };
  for (const i of [protein, fat, carbs]) i.addEventListener('input', updateHint);
  updateHint();

  const body = h('div', { class: 'form' },
    note ? h('div', { class: 'note' }, note) : null,
    remote ? h('div', { class: 'note' }, 'Продукт из удалённого источника — только чтение. Скопируйте его, чтобы изменить.') : null,
    field('Название', name, { mic: !remote }),
    field('Бренд', brand, { mic: !remote }),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Категория'), category),
    h('div', { class: 'grid-4' },
      field('Ккал', kcal, { mic: false }),
      field('Белки', protein, { mic: false }),
      field('Жиры', fat, { mic: false }),
      field('Углев.', carbs, { mic: false })),
    h('small', { class: 'muted' }, 'Все значения — на 100 г'),
    hint,
    errors,
  );

  const collect = () => ({
    name: name.value.trim(),
    brand: brand.value.trim(),
    category: category.value,
    kcal: kcal.value, protein: protein.value, fat: fat.value, carbs: carbs.value,
  });

  const actions = [];
  if (remote) {
    actions.push({ label: 'Закрыть', kind: 'ghost' });
    actions.push({
      label: 'Копировать в мои продукты', kind: 'primary',
      onClick: async () => {
        const { id, remoteId, source, updatedAt, deleted, dirty, ...rest } = product;
        const copy = await saveProduct({ ...rest, source: 'local', copiedFrom: id });
        toast('Скопировано в «Мои продукты»');
        setTimeout(() => openProductEditor(copy), 350);
      },
    });
  } else {
    if (product?.id) {
      actions.push({
        label: 'Удалить', kind: 'danger ghost',
        onClick: async () => {
          if (!(await confirmDialog(`Удалить продукт «${product.name}»?`))) return false;
          await deleteWithUndo(product);
        },
      });
    }
    actions.push({ label: 'Отмена', kind: 'ghost' });
    actions.push({
      label: 'Сохранить', kind: 'primary',
      onClick: async () => {
        const raw = collect();
        const errs = validateProduct(raw);
        clear(errors);
        if (errs.length) {
          errors.append(...errs.map((e) => h('div', {}, e)));
          return false;
        }
        const rec = {
          ...(product || {}),
          ...raw,
          source: 'local',
          kcal: round(parseNum(raw.kcal), 1),
          protein: round(parseNum(raw.protein) ?? 0, 1),
          fat: round(parseNum(raw.fat) ?? 0, 1),
          carbs: round(parseNum(raw.carbs) ?? 0, 1),
        };
        await saveProduct(rec);
        toast(product?.id ? 'Продукт сохранён' : 'Продукт добавлен');
      },
    });
  }

  return openSheet({ title: remote ? 'Продукт' : product?.id ? 'Редактировать продукт' : 'Новый продукт', body, actions });
}

async function deleteWithUndo(product) {
  await softDelete('products', product.id);
  toast(`«${product.name}» удалён`, {
    action: 'Отменить',
    duration: 6000,
    onAction: async () => { await restoreRecord('products', product.id); toast('Восстановлено'); },
  });
}

/** Быстрое добавление голосом: одна фраза -> разобранная форма для подтверждения. */
function openVoiceQuickAdd() {
  const status = h('p', { class: 'muted center' }, 'Нажмите на микрофон и скажите, например:');
  const example = h('p', { class: 'example' }, '«куриная грудка 165 калорий белки 31 жиры 3,6 углеводы 0»');
  const transcript = h('textarea', { rows: 2, placeholder: 'Распознанный текст появится здесь (можно исправить)' });
  const bigMic = h('button', { class: 'big-mic', type: 'button', 'aria-label': 'Говорить' }, micIcon());

  const sheet = openSheet({
    title: 'Добавить голосом',
    body: h('div', { class: 'form center-col' }, status, example, bigMic, transcript),
    actions: [
      { label: 'Отмена', kind: 'ghost' },
      { label: 'Разобрать', kind: 'primary', onClick: () => proceed(transcript.value) },
    ],
  });

  function proceed(text) {
    if (!text.trim()) { toast('Скажите или введите фразу', { kind: 'error' }); return false; }
    const parsed = parseFoodPhrase(text);
    const missing = ['kcal', 'protein', 'fat', 'carbs'].filter((k) => parsed[k] === null);
    const labels = { kcal: 'ккал', protein: 'белки', fat: 'жиры', carbs: 'углеводы' };
    const note = `Распознано: «${text.trim()}».` +
      (missing.length ? ` Не найдено: ${missing.map((k) => labels[k]).join(', ')} — проверьте поля.` : ' Проверьте и сохраните.');
    const prefill = { name: parsed.name };
    for (const k of ['kcal', 'protein', 'fat', 'carbs']) prefill[k] = parsed[k] ?? '';
    setTimeout(() => openProductEditor(null, { prefill, note }), 350);
  }

  bigMic.addEventListener('click', async () => {
    if (bigMic.classList.contains('listening')) { stopListening(); return; }
    bigMic.classList.add('listening');
    status.textContent = 'Слушаю…';
    try {
      const text = await listen({ onInterim: (t) => { transcript.value = t; } });
      transcript.value = text;
      sheet.close();
      proceed(text);
    } catch (e) {
      status.textContent = e.message;
    } finally {
      bigMic.classList.remove('listening');
    }
  });
}
