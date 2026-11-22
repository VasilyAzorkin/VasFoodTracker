// Общие UI-помощники: создание DOM, форматирование, тосты, листы-диалоги, микрофон.
import { isSpeechSupported, listen, stopListening } from '../voice.js';

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'multiple', 'indeterminate']);

/** h('div', {class:'x', onclick: fn}, 'текст', child) */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---------- Форматирование ----------

export function fmt(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

export const fmtKcal = (n) => fmt(n, 0);

export function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(',', '.').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function macrosLine(n) {
  return `Б ${fmt(n.protein)} · Ж ${fmt(n.fat)} · У ${fmt(n.carbs)}`;
}

export function fmtDateTime(ts) {
  if (!ts) return 'никогда';
  return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const MEAL_LABELS = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };

export const CATEGORIES = [
  'Мясо и птица', 'Рыба и морепродукты', 'Молочные продукты', 'Яйца', 'Крупы и злаки',
  'Хлеб и выпечка', 'Овощи', 'Фрукты и ягоды', 'Орехи и семена', 'Масла и жиры',
  'Напитки', 'Сладости', 'Готовые блюда', 'Другое',
];

/** Нормализованный текстовый поиск: все слова запроса должны встретиться. */
export function matches(query, ...fields) {
  const q = norm(query);
  if (!q) return true;
  const hay = norm(fields.filter(Boolean).join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Тосты ----------

export function toast(message, { action, onAction, duration = 4000, kind = '' } = {}) {
  // Модальный <dialog> находится в top layer — тосты внутри него, иначе их не видно.
  const dialogs = document.querySelectorAll('dialog[open]');
  const top = dialogs[dialogs.length - 1];
  let host = document.getElementById('toasts');
  if (top) {
    host = top.querySelector(':scope > .toasts') || top.appendChild(h('div', { class: 'toasts in-dialog' }));
  }
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, h('span', {}, message));
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    el.classList.add('hide');
    setTimeout(() => el.remove(), 250);
  };
  if (action) {
    el.append(h('button', {
      class: 'toast-action',
      onclick: () => { close(); onAction?.(); },
    }, action));
  }
  host.append(el);
  setTimeout(close, duration);
  return close;
}

// ---------- Листы (модальные окна) и кнопка «назад» ----------

const sheetStack = [];
let pendingBack = null;

window.addEventListener('popstate', () => {
  if (pendingBack) {
    const r = pendingBack;
    pendingBack = null;
    r();
    return;
  }
  const top = sheetStack[sheetStack.length - 1];
  if (top) top.close(true);
});

/** Навигация с учётом незавершённого history.back() после закрытия листа. */
export async function navigate(hash) {
  if (pendingBack) await new Promise((r) => setTimeout(r, 60));
  location.hash = hash;
}

/**
 * Открывает лист снизу.
 * @param {{title:string, body:Node|Node[], actions?:Array<{label, kind?, onClick?}>, full?:boolean, onClose?:Function}} opts
 * onClick может вернуть false (или Promise<false>), чтобы лист не закрывался.
 */
export function openSheet({ title, body, actions = [], full = false, onClose }) {
  const dialog = h('dialog', { class: `sheet ${full ? 'full' : ''}` });
  const footer = h('div', { class: 'sheet-actions' });
  let closed = false;

  const api = {
    dialog,
    close(fromPop = false) {
      if (closed) return;
      closed = true;
      stopListening();
      const i = sheetStack.indexOf(api);
      if (i >= 0) sheetStack.splice(i, 1);
      // Перенести тосты, показанные внутри листа, в нижележащий слой.
      const inner = dialog.querySelector(':scope > .toasts');
      if (inner) {
        const below = [...document.querySelectorAll('dialog[open]')].filter((d) => d !== dialog).pop();
        const target = below
          ? below.querySelector(':scope > .toasts') || below.appendChild(h('div', { class: 'toasts in-dialog' }))
          : document.getElementById('toasts');
        target.append(...inner.children);
      }
      dialog.close();
      dialog.remove();
      if (!fromPop) {
        pendingBack = () => {};
        history.back();
        setTimeout(() => { pendingBack = null; }, 400);
      }
      onClose?.();
    },
    setActions(list) {
      clear(footer);
      for (const a of list) {
        footer.append(h('button', {
          class: `btn ${a.kind || ''}`,
          type: 'button',
          onclick: async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            try {
              const r = await a.onClick?.(api);
              if (r !== false) api.close();
            } catch (e) {
              toast(e.message || String(e), { kind: 'error' });
            } finally {
              btn.disabled = false;
            }
          },
        }, a.label));
      }
      footer.hidden = list.length === 0;
    },
  };

  dialog.append(
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Закрыть', onclick: () => api.close() }, '✕')),
    h('div', { class: 'sheet-body' }, body),
    footer,
  );
  api.setActions(actions);

  dialog.addEventListener('cancel', (e) => { e.preventDefault(); api.close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) api.close(); });

  document.body.append(dialog);
  dialog.showModal();
  history.pushState({ sheet: true }, '');
  sheetStack.push(api);
  return api;
}

export function confirmDialog(message, { okLabel = 'Удалить', danger = true, title = 'Подтверждение' } = {}) {
  return new Promise((resolve) => {
    let result = false;
    openSheet({
      title,
      body: h('p', {}, message),
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { result = true; } },
      ],
      onClose: () => resolve(result),
    });
  });
}

// ---------- Поля форм ----------

/** Кнопка микрофона, заполняющая поле. null, если API недоступно. */
export function micButton(input, { onResult } = {}) {
  if (!isSpeechSupported()) return null;
  const btn = h('button', { type: 'button', class: 'mic-btn', 'aria-label': 'Голосовой ввод', title: 'Голосовой ввод' }, micIcon());
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('listening')) { stopListening(); return; }
    btn.classList.add('listening');
    try {
      const text = await listen({ onInterim: (t) => { input.placeholder = t || 'Говорите…'; } });
      if (input.type === 'number' || input.inputMode === 'decimal') {
        const m = text.replace(',', '.').match(/\d+(\.\d+)?/);
        input.value = m ? m[0] : '';
      } else {
        input.value = text;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      onResult?.(text);
    } catch (e) {
      if (e.message !== 'Отменено') toast(e.message, { kind: 'error' });
    } finally {
      btn.classList.remove('listening');
      input.placeholder = input.dataset.placeholder || '';
    }
  });
  return btn;
}

export function micIcon() {
  const span = h('span', { class: 'ico', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>';
  return span;
}

/** Поле ввода с меткой и (для текстовых) кнопкой микрофона. */
export function field(label, input, { mic = true, hint } = {}) {
  if (input.placeholder) input.dataset.placeholder = input.placeholder;
  const row = h('div', { class: 'input-row' }, input, mic ? micButton(input) : null);
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), row, hint ? h('small', { class: 'hint' }, hint) : null);
}

export function textInput(attrs = {}) {
  return h('input', { type: 'text', autocomplete: 'off', ...attrs });
}

export function numberInput(attrs = {}) {
  return h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', ...attrs });
}

export function select(options, value, attrs = {}) {
  const el = h('select', attrs, options.map(([v, label]) => h('option', { value: v }, label)));
  el.value = value ?? options[0]?.[0] ?? '';
  return el;
}

export function emptyState(text, ...extra) {
  return h('div', { class: 'empty' }, h('p', {}, text), ...extra);
}

/** Строка поиска с микрофоном. */
export function searchBox({ placeholder = 'Поиск', value = '', onInput }) {
  const input = h('input', { type: 'search', placeholder, value, autocomplete: 'off', enterkeyhint: 'search' });
  input.dataset.placeholder = placeholder;
  input.addEventListener('input', debounce(() => onInput(input.value), 150));
  return { input, el: h('div', { class: 'search-box input-row' }, input, micButton(input)) };
}

export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
