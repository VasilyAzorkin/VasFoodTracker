// Экран «Настройки»: цель, удалённые источники, облачная синхронизация, данные.
import { getSetting, setSetting, exportAll, importAll, clearAll, allEntries } from '../db.js';
import { listSources, addSource, removeSource, fetchSource, setSourceEnabled, fetchStaleSources } from '../remote.js';
import * as sync from '../sync.js';
import { isSpeechSupported } from '../voice.js';
import { MEAL_TYPES } from '../calc.js';
import {
  h, clear, fmtDateTime, parseNum, toast, confirmDialog, field, textInput, numberInput, download, MEAL_LABELS,
} from './common.js';

export const title = 'Настройки';

export async function render(root, _params, ctx) {
  const goalCard = h('section', { class: 'card' });
  const sourcesCard = h('section', { class: 'card' });
  const syncCard = h('section', { class: 'card' });
  const dataCard = h('section', { class: 'card' });
  const aboutCard = h('section', { class: 'card' });
  root.append(goalCard, sourcesCard, syncCard, dataCard, aboutCard);

  await renderGoal(goalCard);
  await renderSources(sourcesCard);
  await renderSync(syncCard);
  renderData(dataCard);
  renderAbout(aboutCard);

  ctx.on('data-changed', (e) => { if (e.detail?.table === 'sources') renderSources(sourcesCard); });
  ctx.on('sync-status', () => updateSyncStatus(syncCard));
}

// ---------- Цель ----------

async function renderGoal(card) {
  const goal = await getSetting('dailyGoalKcal');
  const input = numberInput({ value: String(goal) });
  const save = async () => {
    const v = parseNum(input.value);
    if (!(v >= 500 && v <= 10000)) { toast('Цель должна быть от 500 до 10 000 ккал', { kind: 'error' }); return; }
    await setSetting('dailyGoalKcal', Math.round(v));
    toast('Цель сохранена');
  };
  input.addEventListener('change', save);
  clear(card).append(
    h('h3', {}, 'Дневная цель'),
    h('div', { class: 'inline-form' }, field('Ккал в день', input, { mic: false }),
      h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Сохранить')));
}

// ---------- Удалённые источники ----------

async function renderSources(card) {
  const sources = await listSources();
  const name = textInput({ placeholder: 'Название' });
  const url = h('input', { type: 'url', placeholder: 'https://example.com/products.json', autocomplete: 'off' });

  const list = h('div', { class: 'list' });
  if (!sources.length) list.append(h('p', { class: 'muted small' }, 'Источников нет. Добавьте URL, который возвращает JSON-массив продуктов.'));
  for (const s of sources) {
    const toggle = h('input', { type: 'checkbox', checked: s.enabled, 'aria-label': 'Включён' });
    toggle.addEventListener('change', async () => {
      const r = await setSourceEnabled(s.id, toggle.checked);
      if (r && !r.ok) toast(`${s.name}: ${r.error}`, { kind: 'error' });
    });
    list.append(h('div', { class: 'source' },
      h('div', { class: 'source-head' },
        h('label', { class: 'switch' }, toggle, h('span', {})),
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, s.name),
          h('div', { class: 'row-sub break' }, s.url))),
      h('div', { class: 'row-sub' },
        s.enabled ? `Продуктов: ${s.count || 0} · обновлено: ${fmtDateTime(s.lastFetchedAt)}` : 'Выключен'),
      s.lastError ? h('div', { class: 'error-text small' }, `Ошибка: ${s.lastError}`) : null,
      h('div', { class: 'toolbar' },
        h('button', {
          class: 'btn small', type: 'button', disabled: !s.enabled,
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            const r = await fetchSource(s);
            toast(r.ok ? `${s.name}: загружено ${r.count}` : `${s.name}: ${r.error}`, { kind: r.ok ? '' : 'error' });
          },
        }, 'Загрузить сейчас'),
        h('button', {
          class: 'btn small danger ghost', type: 'button',
          onclick: async () => {
            if (await confirmDialog(`Удалить источник «${s.name}» и его продукты?`)) {
              await removeSource(s.id);
              toast('Источник удалён');
            }
          },
        }, 'Удалить'))));
  }

  clear(card).append(
    h('div', { class: 'section-head' }, h('h3', {}, 'Удалённые источники'),
      sources.length ? h('button', {
        class: 'btn small ghost', type: 'button',
        onclick: async () => {
          const res = await fetchStaleSources(true);
          const bad = res.filter((r) => !r.ok).length;
          toast(bad ? `Ошибок: ${bad} из ${res.length}` : 'Все источники обновлены', { kind: bad ? 'error' : '' });
        },
      }, 'Обновить все') : null),
    list,
    h('div', { class: 'form add-source' },
      field('Название', name, { mic: true }),
      field('URL', url, { mic: false }),
      h('button', {
        class: 'btn primary', type: 'button',
        onclick: async () => {
          try {
            const src = await addSource(name.value, url.value);
            toast('Источник добавлен, загружаю…');
            const r = await fetchSource(src);
            toast(r.ok ? `Загружено продуктов: ${r.count}` : `Ошибка: ${r.error}`, { kind: r.ok ? '' : 'error' });
          } catch (e) {
            toast(e.message, { kind: 'error' });
          }
        },
      }, 'Добавить источник')),
  );
}

// ---------- Синхронизация ----------

async function renderSync(card) {
  const cfg = await sync.getConfig();
  const url = h('input', { type: 'url', value: cfg.url, placeholder: 'https://xxxx.supabase.co', autocomplete: 'off' });
  const key = h('input', { type: 'password', value: cfg.anonKey, placeholder: 'anon public key', autocomplete: 'off' });
  const authBox = h('div', { class: 'auth-box' });
  const status = h('div', { class: 'sync-status' });

  clear(card).append(
    h('h3', {}, 'Облачная синхронизация'),
    h('p', { class: 'muted small' }, 'Необязательно. Приложение полностью работает без облака. Нужен проект Supabase — см. README.'),
    h('div', { class: 'form' },
      field('Supabase URL', url, { mic: false }),
      field('Anon key', key, { mic: false }),
      h('div', { class: 'toolbar' },
        h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            await sync.setConfig({ url: url.value, anonKey: key.value });
            toast('Настройки синхронизации сохранены');
            renderAuth(authBox);
          },
        }, 'Сохранить'),
        cfg.url ? h('button', {
          class: 'btn ghost danger', type: 'button',
          onclick: async () => {
            if (!(await confirmDialog('Отключить синхронизацию на этом устройстве? Данные останутся локально.', { okLabel: 'Отключить' }))) return;
            await sync.signOut().catch(() => {});
            await sync.setConfig({ url: '', anonKey: '' });
            renderSync(card);
          },
        }, 'Отключить') : null)),
    authBox,
    status,
  );
  await renderAuth(authBox);
  await updateSyncStatus(card);
}

async function renderAuth(box) {
  clear(box);
  if (!(await sync.isConfigured())) return;
  let user = null;
  try {
    user = await sync.getUser();
  } catch (e) {
    box.append(h('div', { class: 'error-text small' }, e.message));
    return;
  }
  if (user) {
    box.append(
      h('div', { class: 'signed-in' }, 'Вы вошли как ', h('b', {}, user.email || user.id)),
      h('div', { class: 'toolbar' },
        h('button', {
          class: 'btn primary', type: 'button',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            const r = await sync.syncNow();
            toast(r.ok ? `Готово: получено ${r.pulled}, отправлено ${r.pushed}` : r.message, { kind: r.ok ? '' : 'error' });
          },
        }, 'Синхронизировать сейчас'),
        h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await sync.signOut(); renderAuth(box); } }, 'Выйти')));
    return;
  }

  const email = h('input', { type: 'email', placeholder: 'email@example.com', autocomplete: 'email' });
  const password = h('input', { type: 'password', placeholder: 'пароль (от 6 символов)', autocomplete: 'current-password' });
  const code = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'код из письма', autocomplete: 'one-time-code' });
  const run = (fn) => async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      if (!email.value.trim()) throw new Error('Укажите email');
      await fn(email.value.trim());
    } catch (err) {
      toast(err.message || String(err), { kind: 'error' });
    } finally {
      btn.disabled = false;
    }
  };

  box.append(
    h('div', { class: 'form' },
      field('Email', email, { mic: false }),
      field('Пароль', password, { mic: false }),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn primary', type: 'button', onclick: run(async (em) => { await sync.signIn(em, password.value); toast('Вход выполнен'); renderAuth(box); }) }, 'Войти'),
        h('button', {
          class: 'btn', type: 'button',
          onclick: run(async (em) => {
            const r = await sync.signUp(em, password.value);
            toast(r.needsConfirmation ? 'Проверьте почту и подтвердите регистрацию' : 'Регистрация выполнена');
            renderAuth(box);
          }),
        }, 'Регистрация')),
      h('details', {},
        h('summary', {}, 'Вход без пароля (ссылка или код из письма)'),
        h('div', { class: 'form' },
          h('button', { class: 'btn', type: 'button', onclick: run(async (em) => { await sync.sendMagicLink(em); toast('Письмо отправлено. Откройте ссылку на этом устройстве или введите код.'); }) }, 'Отправить письмо'),
          h('div', { class: 'inline-form' }, field('Код', code, { mic: false }),
            h('button', { class: 'btn', type: 'button', onclick: run(async (em) => { await sync.verifyCode(em, code.value.trim()); toast('Вход выполнен'); renderAuth(box); }) }, 'Подтвердить'))))),
  );
}

async function updateSyncStatus(card) {
  const box = card.querySelector('.sync-status');
  if (!box) return;
  const st = await sync.getStatus();
  clear(box);
  if (sync.isRunning()) { box.append(h('span', { class: 'muted' }, 'Синхронизация…')); return; }
  if (!st) { box.append(h('span', { class: 'muted small' }, 'Синхронизация ещё не выполнялась')); return; }
  box.append(h('span', { class: st.ok ? 'ok-text small' : 'error-text small' },
    `${st.ok ? '✓' : '✕'} ${fmtDateTime(st.at)}: ${st.message}` + (st.ok ? ` (получено ${st.pulled}, отправлено ${st.pushed})` : '')));
}

// ---------- Данные ----------

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv() {
  const entries = (await allEntries()).sort((a, b) => a.date.localeCompare(b.date) || MEAL_TYPES.indexOf(a.mealType) - MEAL_TYPES.indexOf(b.mealType));
  const dec = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
  const rows = [['Дата', 'Приём пищи', 'Тип', 'Название', 'Граммы', 'Ккал', 'Белки', 'Жиры', 'Углеводы', 'Заметка']];
  for (const e of entries) {
    rows.push([e.date, MEAL_LABELS[e.mealType] || e.mealType, e.itemType === 'dish' ? 'блюдо' : 'продукт', e.name,
      dec(e.grams), dec(e.kcal), dec(e.protein), dec(e.fat), dec(e.carbs), e.note || '']);
  }
  // BOM + «;» — чтобы Excel с русской локалью корректно открыл файл
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
  download(`diary-${stamp()}.csv`, csv, 'text/csv;charset=utf-8');
}

function renderData(card) {
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const s = await importAll(data);
      toast(`Импорт: добавлено ${s.added}, обновлено ${s.updated}, пропущено ${s.skipped}`);
    } catch (e) {
      toast(`Ошибка импорта: ${e.message}`, { kind: 'error' });
    }
  });

  clear(card).append(
    h('h3', {}, 'Данные'),
    h('div', { class: 'stack' },
      h('button', { class: 'btn', type: 'button', onclick: async () => download(`kbzhu-backup-${stamp()}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json') }, 'Экспорт всех данных (JSON)'),
      h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'Импорт из JSON'),
      h('button', { class: 'btn', type: 'button', onclick: exportCsv }, 'Экспорт дневника (CSV)'),
      file,
      h('button', {
        class: 'btn danger', type: 'button',
        onclick: async () => {
          if (!(await confirmDialog('Удалить ВСЕ локальные данные: продукты, блюда, дневник, источники и настройки? Данные в облаке не затрагиваются. Действие необратимо.', { okLabel: 'Удалить всё' }))) return;
          await clearAll();
          try {
            for (const k of Object.keys(localStorage)) if (k.startsWith('kbzhu')) localStorage.removeItem(k);
          } catch { /* ignore */ }
          location.hash = '';
          location.reload();
        },
      }, 'Очистить все локальные данные')),
  );
}

function renderAbout(card) {
  clear(card).append(
    h('h3', {}, 'О приложении'),
    h('p', { class: 'muted small' }, 'КБЖУ — дневник калорий. Работает офлайн, данные хранятся на устройстве.'),
    h('p', { class: 'muted small' }, `Голосовой ввод: ${isSpeechSupported() ? 'доступен' : 'недоступен в этом браузере'}`),
    h('p', { class: 'muted small' }, h('a', { href: 'tests/tests.html' }, 'Запустить тесты')),
  );
}
