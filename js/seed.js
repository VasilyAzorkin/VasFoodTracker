// Начальные данные при первом запуске.
// updatedAt = 1: любая версия из облака или импорта новее «заводской».
import { db, getMeta } from './db.js';

const P = (id, name, category, kcal, protein, fat, carbs) => ({
  id: `seed-${id}`, name, brand: '', category, kcal, protein, fat, carbs,
});

export const SEED_PRODUCTS = [
  P('chicken-breast', 'Куриная грудка', 'Мясо и птица', 113, 23.6, 1.9, 0.4),
  P('beef', 'Говядина', 'Мясо и птица', 187, 18.9, 12.4, 0),
  P('pork-loin', 'Свиная вырезка', 'Мясо и птица', 142, 19.4, 7.1, 0),
  P('pollock', 'Минтай', 'Рыба и морепродукты', 72, 15.9, 0.9, 0),
  P('egg', 'Яйцо куриное', 'Яйца', 157, 12.7, 11.5, 0.7),
  P('milk', 'Молоко 2,5%', 'Молочные продукты', 52, 2.8, 2.5, 4.7),
  P('kefir', 'Кефир 1%', 'Молочные продукты', 40, 2.8, 1, 4),
  P('cottage', 'Творог 5%', 'Молочные продукты', 121, 17.2, 5, 1.8),
  P('sour-cream', 'Сметана 15%', 'Молочные продукты', 158, 2.6, 15, 3),
  P('cheese', 'Сыр Российский', 'Молочные продукты', 364, 23.2, 29.5, 0),
  P('butter', 'Масло сливочное 82,5%', 'Масла и жиры', 748, 0.5, 82.5, 0.8),
  P('sunflower-oil', 'Масло подсолнечное', 'Масла и жиры', 899, 0, 99.9, 0),
  P('buckwheat', 'Гречневая крупа', 'Крупы и злаки', 313, 12.6, 3.3, 62.1),
  P('rice', 'Рис белый', 'Крупы и злаки', 344, 6.7, 0.7, 78.9),
  P('oats', 'Овсяные хлопья', 'Крупы и злаки', 352, 12.3, 6.2, 61.8),
  P('pasta', 'Макароны', 'Крупы и злаки', 337, 10.4, 1.1, 71.5),
  P('flour', 'Мука пшеничная', 'Хлеб и выпечка', 334, 10.3, 1.1, 69.9),
  P('rye-bread', 'Хлеб ржаной', 'Хлеб и выпечка', 174, 6.6, 1.2, 33.4),
  P('potato', 'Картофель', 'Овощи', 77, 2, 0.4, 16.3),
  P('carrot', 'Морковь', 'Овощи', 35, 1.3, 0.1, 6.9),
  P('beet', 'Свёкла', 'Овощи', 42, 1.5, 0.1, 8.8),
  P('cabbage', 'Капуста белокочанная', 'Овощи', 27, 1.8, 0.1, 4.7),
  P('onion', 'Лук репчатый', 'Овощи', 41, 1.4, 0.2, 8.2),
  P('tomato', 'Помидор', 'Овощи', 20, 1.1, 0.2, 3.7),
  P('cucumber', 'Огурец', 'Овощи', 15, 0.8, 0.1, 2.8),
  P('apple', 'Яблоко', 'Фрукты и ягоды', 47, 0.4, 0.4, 9.8),
  P('banana', 'Банан', 'Фрукты и ягоды', 95, 1.5, 0.2, 21.8),
  P('sugar', 'Сахар', 'Сладости', 399, 0, 0, 99.8),
  P('water', 'Вода', 'Напитки', 0, 0, 0, 0),
];

const I = (id, grams) => ({ productId: `seed-${id}`, grams });

export const SEED_DISHES = [
  {
    id: 'seed-dish-borsch',
    name: 'Борщ с говядиной',
    description: 'Классический борщ на говяжьем бульоне. Подавать со сметаной.',
    servingGrams: 300,
    ingredients: [
      I('beef', 300), I('beet', 300), I('cabbage', 300), I('potato', 300),
      I('carrot', 100), I('onion', 100), I('sunflower-oil', 20), I('water', 1500),
    ],
  },
  {
    id: 'seed-dish-buckwheat-chicken',
    name: 'Гречка с курицей',
    description: 'Отварная гречка с куриной грудкой и сливочным маслом.',
    servingGrams: 350,
    ingredients: [I('buckwheat', 80), I('chicken-breast', 150), I('butter', 10), I('water', 160)],
  },
  {
    id: 'seed-dish-oatmeal',
    name: 'Овсяная каша на молоке',
    description: 'Овсянка на молоке с маслом и сахаром.',
    servingGrams: 260,
    ingredients: [I('oats', 50), I('milk', 200), I('butter', 5), I('sugar', 5)],
  },
  {
    id: 'seed-dish-salad',
    name: 'Салат из огурцов и помидоров',
    description: 'Летний салат со сметаной.',
    servingGrams: 190,
    ingredients: [I('cucumber', 150), I('tomato', 150), I('onion', 30), I('sour-cream', 50)],
  },
  {
    id: 'seed-dish-syrniki',
    name: 'Сырники',
    description: 'Творожные сырники, обжаренные на масле.',
    servingGrams: 150,
    ingredients: [I('cottage', 400), I('egg', 100), I('flour', 60), I('sugar', 30), I('sunflower-oil', 30)],
  },
];

export async function seedIfNeeded() {
  if (await getMeta('seeded')) return false;
  const base = { updatedAt: 1, deleted: false, dirty: 1 };
  await db.transaction('rw', db.products, db.dishes, db.meta, async () => {
    await db.products.bulkPut(SEED_PRODUCTS.map((p) => ({ ...p, source: 'local', ...base })));
    await db.dishes.bulkPut(SEED_DISHES.map((d) => ({ ...d, ...base })));
    await db.meta.put({ key: 'seeded', value: true });
  });
  return true;
}
