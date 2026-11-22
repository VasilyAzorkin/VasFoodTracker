// Точка входа: маршрутизация по hash, запуск фоновых задач, Service Worker.
import { db } from './db.js';
import { seedIfNeeded } from './seed.js';
import { fetchStaleSources } from './remote.js';
import * as sync from './sync.js';
import { h, toast, clear } from './ui/common.js';
import * as diary from './ui/diary.js';
import * as products from './ui/products.js';
import * as dishes from './ui/dishes.js';
import * as search from './ui/search.js';
import * as settings from './ui/settings.js';

const routes = { diary, products, dishes, search, settings };
const view = document.getElementById('view');
const titleEl = document.getElementById('title');

let cleanups = [];
let renderToken = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  // Хэш вида #access_token=... — ответ Supabase после входа по ссылке.
  if (raw.includes('access_token=') || raw.includes('error_description=')) return { name: 'settings', params: new URLSearchParams() };
  const [path, qs] = raw.split('?');
  return { name: routes[path] ? path : 'diary', params: new URLSearchParams(qs || '') };
}

async function renderRoute() {
  const token = ++renderToken;
  for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
  cleanups = [];
  const { name, params } = parseHash();
  const screen = routes[name];

  const ctx = {
    on(event, fn) {
      const handler = (e) => { if (token === renderToken) fn(e); };
      window.addEventListener(event, handler);
      cleanups.push(() => window.removeEventListener(event, handler));
    },
    onCleanup(fn) { cleanups.push(fn); },
  };

  titleEl.textContent = screen.title;
  document.title = `${screen.title} · КБЖУ`;
  for (const a of document.querySelectorAll('.bottomnav a')) {
    a.classList.toggle('active', a.dataset.route === name);
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  clear(view);
  view.dataset.screen = name;
  window.scrollTo(0, 0);
  try {
    await screen.render(view, params, ctx);
  } catch (e) {
    console.error(e);
    view.append(h('div', { class: 'card error-text' }, `Ошибка экрана: ${e.message}`));
  }
}

// ---------- Индикатор синхронизации ----------

async function updateSyncIndicator() {
  const el = document.getElementById('sync-indicator');
  if (!(await sync.isConfigured())) { el.hidden = true; return; }
  el.hidden = false;
  const st = await sync.getStatus();
  el.className = 'sync-indicator ' + (sync.isRunning() ? 'running' : st?.ok ? 'ok' : st ? 'error' : '');
  el.title = sync.isRunning() ? 'Синхронизация…' : st ? st.message : 'Синхронизация не выполнялась';
}

// ---------- Service Worker ----------

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const offer = (worker) => {
      toast('Доступна новая версия', {
        action: 'Обновить',
        duration: 15000,
        onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch((e) => console.warn('SW registration failed', e));

  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

// ---------- Запуск ----------

async function start() {
  registerSW();
  try {
    await db.open();
    await seedIfNeeded();
  } catch (e) {
    view.append(h('div', { class: 'card error-text' }, `Не удалось открыть базу данных: ${e.message}`));
    return;
  }

  const authRedirect = /access_token=|error_description=/.test(location.hash);
  if (authRedirect) {
    // Дадим клиенту Supabase разобрать токен из адреса до смены маршрута.
    await sync.getClient().catch(() => null);
    await sync.getUser().catch(() => null);
    history.replaceState(null, '', location.pathname + '#/settings');
  }

  window.addEventListener('hashchange', renderRoute);
  window.addEventListener('sync-status', updateSyncIndicator);
  document.getElementById('sync-indicator').addEventListener('click', () => { location.hash = '#/settings'; });
  await renderRoute();
  updateSyncIndicator();

  // Фоновые задачи — никогда не блокируют интерфейс.
  fetchStaleSources().catch((e) => console.warn('remote sources', e));
  sync.startAutoSync().catch((e) => console.warn('sync', e));

  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}

start();
