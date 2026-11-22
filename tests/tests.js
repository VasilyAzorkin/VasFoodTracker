// Простейший тест-раннер без фреймворков.
import * as calc from '../js/calc.js';
import { parseFoodPhrase, tokenize } from '../js/voice.js';

const out = document.getElementById('out');
const results = { pass: 0, fail: 0 };
let group = null;

function describe(name, fn) {
  group = document.createElement('section');
  group.innerHTML = `<h2>${name}</h2>`;
  out.append(group);
  fn();
}

function test(name, fn) {
  const div = document.createElement('div');
  div.className = 't';
  div.textContent = name;
  try {
    fn();
    div.classList.add('ok');
    results.pass++;
  } catch (e) {
    div.classList.add('fail');
    const pre = document.createElement('pre');
    pre.textContent = e.message;
    div.append(pre);
    results.fail++;
    console.error(name, e);
  }
  group.append(div);
}

function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${msg} ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
}
function approx(actual, expected, eps = 0.05, msg = '') {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > eps) {
    throw new Error(`${msg} ожидалось ≈${expected}, получено ${actual}`);
  }
}
function deepEq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n ожидалось ${b}\n получено   ${a}`);
}
function ok(v, msg = 'ожидалось истинное значение') { if (!v) throw new Error(msg); }

// ---------------------------------------------------------------------------

const chicken = { id: 'c', kcal: 113, protein: 23.6, fat: 1.9, carbs: 0.4 };
const rice = { id: 'r', kcal: 344, protein: 6.7, fat: 0.7, carbs: 78.9 };
const water = { id: 'w', kcal: 0, protein: 0, fat: 0, carbs: 0 };
const products = new Map([[chicken.id, chicken], [rice.id, rice], [water.id, water]]);

describe('calc: базовые функции', () => {
  test('num приводит строки с запятой', () => { eq(calc.num('3,6'), 3.6); eq(calc.num('abc'), 0); eq(calc.num(null), 0); });
  test('round', () => { eq(calc.round(1.25, 1), 1.3); eq(calc.round(2.5, 0), 3); eq(calc.round(0.1 + 0.2, 2), 0.3); });
  test('scale: 150 г курицы', () => {
    const n = calc.scale(chicken, 150);
    approx(n.kcal, 169.5); approx(n.protein, 35.4); approx(n.fat, 2.85); approx(n.carbs, 0.6);
  });
  test('scale: отрицательный и пустой вес = 0', () => { eq(calc.scale(chicken, -10).kcal, 0); eq(calc.scale(chicken, '').kcal, 0); });
  test('sum', () => deepEq(calc.sum([{ kcal: 1, protein: 2, fat: 3, carbs: 4 }, { kcal: 1 }]), { kcal: 2, protein: 2, fat: 3, carbs: 4 }));
  test('roundNutrients', () => deepEq(calc.roundNutrients({ kcal: 169.5, protein: 35.44, fat: 2.85, carbs: 0.6 }), { kcal: 170, protein: 35.4, fat: 2.9, carbs: 0.6 }));
  test('kcalFromMacros', () => approx(calc.kcalFromMacros(31, 3.6, 0), 156.4));
});

describe('calc: блюда', () => {
  const dish = { ingredients: [{ productId: 'c', grams: 200 }, { productId: 'r', grams: 100 }, { productId: 'w', grams: 200 }], servingGrams: 250 };
  test('dishTotals суммирует ингредиенты', () => {
    const t = calc.dishTotals(dish.ingredients, products);
    approx(t.kcal, 226 + 344); approx(t.protein, 47.2 + 6.7); eq(t.totalGrams, 500); eq(t.missing.length, 0);
  });
  test('dishTotals принимает обычный объект', () => {
    const t = calc.dishTotals([{ productId: 'c', grams: 100 }], { c: chicken });
    approx(t.kcal, 113);
  });
  test('per100FromTotals', () => {
    const t = calc.dishTotals(dish.ingredients, products);
    approx(calc.per100FromTotals(t).kcal, 114);
  });
  test('perServing и количество порций', () => {
    const t = calc.dishTotals(dish.ingredients, products);
    approx(calc.perServing(t, 250).kcal, 285);
    approx(calc.servingsCount(t, 250), 2);
  });
  test('порция не задана — порция = всё блюдо', () => {
    const t = calc.dishTotals(dish.ingredients, products);
    approx(calc.perServing(t, 0).kcal, 570);
    eq(calc.servingsCount(t, 0), 1);
  });
  test('отсутствующий продукт учитывается в весе, но не в калориях', () => {
    const t = calc.dishTotals([{ productId: 'c', grams: 100 }, { productId: 'x', grams: 100 }], products);
    approx(t.kcal, 113); eq(t.totalGrams, 200); deepEq(t.missing, ['x']);
  });
  test('пустое блюдо', () => {
    const s = calc.dishSummary({ ingredients: [] }, products);
    eq(s.totals.kcal, 0); eq(s.per100.kcal, 0); eq(s.perServing.kcal, 0);
  });
  test('itemPer100 для продукта и блюда', () => {
    approx(calc.itemPer100('product', chicken, products).kcal, 113);
    approx(calc.itemPer100('dish', dish, products).kcal, 114);
    eq(calc.itemPer100('dish', null, products).kcal, 0);
  });
});

describe('calc: дневник и цель', () => {
  const entries = [
    { date: '2026-11-20', mealType: 'breakfast', kcal: 300, protein: 10, fat: 5, carbs: 50 },
    { date: '2026-11-20', mealType: 'lunch', kcal: 700, protein: 40, fat: 20, carbs: 80 },
    { date: '2026-11-21', mealType: 'weird', kcal: 100, protein: 1, fat: 1, carbs: 1 },
  ];
  test('dayTotals', () => deepEq(calc.dayTotals(entries.slice(0, 2)), { kcal: 1000, protein: 50, fat: 25, carbs: 130 }));
  test('groupByMeal: неизвестный тип -> перекус', () => {
    const g = calc.groupByMeal(entries);
    eq(g.breakfast.length, 1); eq(g.lunch.length, 1); eq(g.dinner.length, 0); eq(g.snack.length, 1);
  });
  test('goalProgress в пределах цели', () => {
    const p = calc.goalProgress(1500, 2000);
    eq(p.percent, 75); eq(p.remaining, 500); eq(p.over, false);
  });
  test('goalProgress сверх цели', () => {
    const p = calc.goalProgress(2500, 2000);
    eq(p.clamped, 100); eq(p.over, true); eq(p.remaining, -500);
  });
  test('goalProgress при нулевой цели', () => eq(calc.goalProgress(100, 0).percent, 0));
  test('lastNDays и addDays через границу месяца/года', () => {
    deepEq(calc.lastNDays('2026-03-02', 3), ['2026-02-28', '2026-03-01', '2026-03-02']);
    eq(calc.addDays('2026-12-31', 1), '2027-01-01');
    eq(calc.addDays('2024-03-01', -1), '2024-02-29');
  });
  test('toDateKey / fromDateKey', () => {
    eq(calc.toDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    eq(calc.toDateKey(calc.fromDateKey('2026-07-09')), '2026-07-09');
  });
  test('dailyKcalSeries', () => {
    deepEq(calc.dailyKcalSeries(entries, ['2026-11-19', '2026-11-20', '2026-11-21']),
      [{ date: '2026-11-19', kcal: 0 }, { date: '2026-11-20', kcal: 1000 }, { date: '2026-11-21', kcal: 100 }]);
  });
  test('inRange', () => {
    ok(calc.inRange(100, '', '')); ok(calc.inRange(100, 50, 150)); ok(!calc.inRange(100, 101, null));
    ok(!calc.inRange(100, null, '99,5')); ok(calc.inRange(100, '100', '100'));
  });
  test('validateProduct', () => {
    eq(calc.validateProduct({ name: 'Хлеб', kcal: '250', protein: '8', fat: '1', carbs: '50' }).length, 0);
    ok(calc.validateProduct({ name: '', kcal: '250' }).length > 0);
    ok(calc.validateProduct({ name: 'X', kcal: '' }).length > 0);
    ok(calc.validateProduct({ name: 'X', kcal: '-1' }).length > 0);
    ok(calc.validateProduct({ name: 'X', kcal: '100', protein: 60, fat: 30, carbs: 30 }).length > 0);
  });
});

describe('Голосовой парсер', () => {
  const P = (name, kcal, protein, fat, carbs) => ({ name, kcal, protein, fat, carbs });
  const pick = (r) => ({ name: r.name, kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs });

  test('пример из ТЗ', () => {
    const r = parseFoodPhrase('куриная грудка 165 калорий белки 31 жиры 3.6 углеводы 0');
    deepEq(pick(r), P('Куриная грудка', 165, 31, 3.6, 0)); eq(r.complete, true);
  });
  test('десятичная запятая', () => deepEq(pick(parseFoodPhrase('куриная грудка 165 калорий белки 31 жиры 3,6 углеводы 0')), P('Куриная грудка', 165, 31, 3.6, 0)));
  test('ключевое слово перед числом', () => deepEq(pick(parseFoodPhrase('гречка калорийность 313 белок 12.6 жир 3.3 углеводы 62.1')), P('Гречка', 313, 12.6, 3.3, 62.1)));
  test('число перед каждым ключевым словом', () => deepEq(pick(parseFoodPhrase('творог 121 ккал 17 белка 5 жиров 1.8 углеводов')), P('Творог', 121, 17, 5, 1.8)));
  test('числа словами', () => deepEq(pick(parseFoodPhrase('яблоко сорок семь калорий белки ноль точка четыре жиры ноль точка четыре углеводы девять точка восемь')), P('Яблоко', 47, 0.4, 0.4, 9.8)));
  test('«сто шестьдесят пять»', () => eq(parseFoodPhrase('курица сто шестьдесят пять калорий').kcal, 165));
  test('«3 точка 6»', () => eq(parseFoodPhrase('сыр жиры 3 точка 6').fat, 3.6));
  test('«на 100 грамм» игнорируется', () => deepEq(pick(parseFoodPhrase('рис на 100 грамм 344 калории белки 6.7 жиры 0.7 углеводы 78.9')), P('Рис', 344, 6.7, 0.7, 78.9)));
  test('процент в названии', () => {
    const r = parseFoodPhrase('молоко 2,5% 52 калории белки 2.8 жиры 2.5 углеводы 4.7');
    deepEq(pick(r), P('Молоко 2,5%', 52, 2.8, 2.5, 4.7));
  });
  test('«процента» словом', () => eq(parseFoodPhrase('кефир 1 процент 40 ккал').name, 'Кефир 1%'));
  test('единицы «грамм» после БЖУ', () => deepEq(pick(parseFoodPhrase('банан 95 ккал белки 1.5 грамма жиры 0.2 грамма углеводы 21.8 грамма')), P('Банан', 95, 1.5, 0.2, 21.8)));
  test('порядок ключей произвольный', () => deepEq(pick(parseFoodPhrase('омлет жиры 12 белки 10 углеводы 2 калории 150')), P('Омлет', 150, 10, 12, 2)));
  test('регистр и буква ё', () => eq(parseFoodPhrase('СВЁКЛА 42 КАЛОРИИ').name, 'Свекла'));
  test('неполная фраза: отсутствующие значения = null', () => {
    const r = parseFoodPhrase('огурец 15 калорий');
    deepEq(pick(r), P('Огурец', 15, null, null, null)); eq(r.complete, false);
  });
  test('пустая строка', () => {
    const r = parseFoodPhrase('');
    deepEq(pick(r), P('', null, null, null, null)); eq(r.complete, false);
  });
  test('только название', () => eq(parseFoodPhrase('борщ').name, 'Борщ'));
  test('tokenize: запятая между числами через пробел не склеивается', () => deepEq(tokenize('калорий 165, 31 белка'), ['калорий', '165', '31', 'белка']));
});

const summary = document.getElementById('summary');
summary.textContent = `Пройдено: ${results.pass}, провалено: ${results.fail}`;
summary.className = results.fail ? 'failed' : 'passed';
document.title = `${results.fail ? '✕' : '✓'} Тесты КБЖУ`;
