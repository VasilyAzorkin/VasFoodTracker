// Голосовой ввод: распознавание (Web Speech API) и чистый парсер фраз.

// ---------------------------------------------------------------------------
// Парсер (чистые функции, без DOM)
// ---------------------------------------------------------------------------

const UNITS = {
  ноль: 0, нуль: 0, один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4,
  пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11,
  двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
};
const TENS = {
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
  семьдесят: 70, восемьдесят: 80, девяносто: 90,
};
const HUNDREDS = {
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500,
  шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};
const SPECIAL = { полтора: 1.5, полторы: 1.5 };

const KEY_PATTERNS = [
  ['kcal', /^(ккал|кал|калори[а-я]*|килокалори[а-я]*|калорийност[а-я]*|энерги[а-я]*)$/],
  ['protein', /^(бел(ок|к[а-я]*)|протеин[а-я]*)$/],
  ['fat', /^жир[а-я]*$/],
  ['carbs', /^углевод[а-я]*$/],
];

const UNIT_RE = /^(г|гр|грамм[а-я]*|грам[а-я]*)$/;
const PERCENT_RE = /^(%|процент[а-я]*)$/;
const DECIMAL_SEP = new Set(['точка', 'запятая', 'целых']);
const FILLERS = new Set(['и', 'а', 'по', 'на', 'в', 'во', 'с', 'со', 'это', 'ценность', 'содержание', 'всего']);
const TRAILING_STOP = new Set(['на', 'в', 'во', 'с', 'со', 'по', 'и', 'а']);

/** Нормализация текста: регистр, ё, десятичная запятая. */
export function normalizePhrase(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)[,.](\d)/g, '$1.$2');
}

/** Разбиение на токены: числа, слова, знак %. */
export function tokenize(text) {
  return normalizePhrase(text).match(/\d+(?:\.\d+)?|%|[a-zа-я]+/g) || [];
}

function isNumberWord(t) {
  return t in UNITS || t in TENS || t in HUNDREDS || t in SPECIAL;
}

/** Склеивает последовательность числительных: «сто шестьдесят пять» -> 165. */
function readNumberWords(tokens, start) {
  const t0 = tokens[start];
  if (t0 in SPECIAL) return { value: SPECIAL[t0], next: start + 1, raw: String(SPECIAL[t0]) };
  let value = 0;
  let i = start;
  let stage = 3; // 3 — можно сотни, 2 — десятки, 1 — единицы
  while (i < tokens.length) {
    const t = tokens[i];
    if (stage >= 3 && t in HUNDREDS) { value += HUNDREDS[t]; stage = 2; i++; continue; }
    if (stage >= 2 && t in TENS) { value += TENS[t]; stage = 1; i++; continue; }
    if (stage >= 1 && t in UNITS) {
      const u = UNITS[t];
      if (stage === 1 && u >= 10) break; // «двадцать двенадцать» — два числа
      value += u; stage = 0; i++;
      continue;
    }
    break;
  }
  if (i === start) return null;
  return { value, next: i, raw: String(value) };
}

function keyOf(token) {
  for (const [key, re] of KEY_PATTERNS) if (re.test(token)) return key;
  return null;
}

/** Токены -> элементы {type:'num'|'key'|'unit'|'pct'|'word'}. */
export function lexPhrase(text) {
  const tokens = tokenize(text);
  const items = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    let numItem = null;
    if (/^\d/.test(t)) {
      numItem = { type: 'num', value: parseFloat(t), raw: t };
      i++;
    } else if (isNumberWord(t)) {
      const r = readNumberWords(tokens, i);
      if (r) { numItem = { type: 'num', value: r.value, raw: r.raw }; i = r.next; }
    }
    if (numItem) {
      // «3 точка 6», «три запятая пять»
      if (DECIMAL_SEP.has(tokens[i]) && i + 1 < tokens.length) {
        let frac = null;
        let next = i + 1;
        if (/^\d+$/.test(tokens[next])) { frac = tokens[next]; next++; }
        else if (isNumberWord(tokens[next])) {
          const r = readNumberWords(tokens, next);
          if (r) { frac = r.raw; next = r.next; }
        }
        if (frac !== null && Number.isInteger(numItem.value)) {
          numItem = { type: 'num', value: parseFloat(`${numItem.value}.${frac}`), raw: `${numItem.value}.${frac}` };
          i = next;
        }
      }
      items.push(numItem);
      continue;
    }
    const key = keyOf(t);
    if (key) items.push({ type: 'key', key });
    else if (UNIT_RE.test(t)) items.push({ type: 'unit' });
    else if (PERCENT_RE.test(t)) items.push({ type: 'pct' });
    else items.push({ type: 'word', text: t });
    i++;
  }
  return items;
}

/**
 * Разбор фразы вида
 * «куриная грудка 165 калорий белки 31 жиры 3.6 углеводы 0».
 * Число может стоять как до, так и после ключевого слова.
 * @returns {{name:string, kcal:number|null, protein:number|null, fat:number|null, carbs:number|null, complete:boolean}}
 */
export function parseFoodPhrase(text) {
  const items = lexPhrase(text);
  const result = { name: '', kcal: null, protein: null, fat: null, carbs: null };
  const nameParts = [];
  let nameOpen = true;   // имя — это слова до первого числа/ключа
  let pendingNum = null; // число, ждущее ключевое слово после себя
  let pendingKey = null; // ключ, ждущий число после себя

  const assign = (key, value) => {
    if (result[key] === null) result[key] = value;
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const next = items[i + 1];
    const prev = items[i - 1];

    if (it.type === 'num') {
      // «молоко 2.5 %» — часть названия
      if (nameOpen && next?.type === 'pct') {
        nameParts.push(`${it.raw.replace('.', ',')}%`);
        i++;
        continue;
      }
      // «на 100 грамм» — служебная фраза
      if (it.value === 100 && next?.type === 'unit' &&
          ((prev?.type === 'word' && (prev.text === 'на' || prev.text === 'в')) || (pendingKey === null && pendingNum === null))) {
        i++;
        continue;
      }
      nameOpen = false;
      if (pendingKey) {
        assign(pendingKey, it.value);
        pendingKey = null;
      } else {
        pendingNum = it.value;
      }
      continue;
    }

    if (it.type === 'key') {
      nameOpen = false;
      if (pendingNum !== null) {
        assign(it.key, pendingNum);
        pendingNum = null;
        pendingKey = null;
      } else {
        pendingKey = it.key;
      }
      continue;
    }

    if (it.type === 'unit' || it.type === 'pct') continue;

    if (it.type === 'word') {
      if (nameOpen) nameParts.push(it.text);
      else if (!FILLERS.has(it.text)) {
        // неизвестное слово после чисел — игнорируем
      }
    }
  }

  while (nameParts.length && TRAILING_STOP.has(nameParts[nameParts.length - 1])) nameParts.pop();
  const name = nameParts.join(' ').trim();
  result.name = name ? name[0].toUpperCase() + name.slice(1) : '';
  result.complete = Boolean(result.name) && ['kcal', 'protein', 'fat', 'carbs'].every((k) => result[k] !== null);
  return result;
}

// ---------------------------------------------------------------------------
// Распознавание речи (браузерное API)
// ---------------------------------------------------------------------------

function getRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSpeechSupported() {
  return Boolean(getRecognitionCtor());
}

let active = null;

const ERRORS = {
  'not-allowed': 'Нет доступа к микрофону',
  'service-not-allowed': 'Распознавание речи запрещено',
  'no-speech': 'Речь не обнаружена',
  'audio-capture': 'Микрофон не найден',
  network: 'Нет сети для распознавания речи',
  aborted: 'Отменено',
};

/**
 * Слушает одну фразу и возвращает распознанный текст.
 * @param {{lang?:string, onInterim?:(text:string)=>void}} opts
 */
export function listen({ lang = 'ru-RU', onInterim } = {}) {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return Promise.reject(new Error('Голосовой ввод не поддерживается'));
  stopListening();
  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    active = rec;
    rec.lang = lang;
    rec.interimResults = Boolean(onInterim);
    rec.maxAlternatives = 1;
    rec.continuous = false;
    let finalText = '';
    let failed = false;
    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (onInterim) onInterim((finalText + interim).trim());
    };
    rec.onerror = (event) => {
      failed = true;
      reject(new Error(ERRORS[event.error] || `Ошибка распознавания: ${event.error}`));
    };
    rec.onend = () => {
      if (active === rec) active = null;
      if (failed) return;
      if (finalText.trim()) resolve(finalText.trim());
      else reject(new Error('Ничего не распознано'));
    };
    try {
      rec.start();
    } catch (e) {
      failed = true;
      reject(e);
    }
  });
}

export function stopListening() {
  if (active) {
    try { active.stop(); } catch { /* ignore */ }
    active = null;
  }
}
