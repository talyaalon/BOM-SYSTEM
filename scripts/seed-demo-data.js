/**
 * scripts/seed-demo-data.js
 * ─────────────────────────────────────────────────────────────────────
 * Populates the database with realistic DEMO data so the BOM & Recipe
 * system can run as a STANDALONE SHOWCASE — no live Odoo connection.
 *
 * What it creates:
 *   • ~12 product categories
 *   • ~300 raw-material items (name he/en, SKU, weight, cost, image)
 *   • a handful of "base" (WIP) recipes + ~30 "final" sellable recipes,
 *     each with a real BOM (ingredient lines) and computed costs/prices
 *   • a couple of demo users (admin + customers)
 *   • a cost_history row per raw material (so the dashboard looks alive)
 *
 * SAFE-TO-RERUN: it TRUNCATEs the catalogue tables first, then reseeds.
 *   ⚠ This WIPES items / boms / bom_lines / categories / cost_history /
 *     bom_snapshots and the demo users.  It does NOT touch pricing_formulas.
 *   It is meant for a DEMO database — do not point it at real data.
 *
 * Usage:
 *   npm run seed:demo           (after `npm run db:migrate`)
 *   The DB connection comes from .env (DB_HOST / DB_PORT / DB_NAME /
 *   DB_USER / DB_PASSWORD) — exactly like the app.
 * ─────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const pool = require('../src/config/db');
const { hashPassword } = require('../src/utils/password');

// ─── tiny helpers ────────────────────────────────────────────────────
const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick    = (arr) => arr[randInt(0, arr.length - 1)];
const round   = (n, d = 2) => { const f = 10 ** d; return Math.round(n * f) / f; };
const sample  = (arr, k) => {
  const copy = [...arr], out = [];
  while (out.length < k && copy.length) out.push(copy.splice(randInt(0, copy.length - 1), 1)[0]);
  return out;
};
// Deterministic, real-looking food photos from loremflickr.  It only
// returns 200 for a SINGLE clean tag that actually has photos, so we use
// a VERIFIED whitelist of tags; anything unknown falls back to a safe
// category tag (or 'food').  ?lock makes each image stable & distinct —
// even two items sharing a tag get different photos.  Swap img() to
// change the source (your own CDN, picsum.photos, or base64 data URIs).
const SAFE_TAGS = new Set([
  'dairy', 'milk', 'meat', 'chicken', 'beef', 'fish', 'salmon', 'tomato',
  'onion', 'potato', 'fruit', 'apple', 'flour', 'bread', 'oil', 'cheese',
  'nuts', 'almond', 'chocolate', 'cake', 'cookie', 'dessert', 'pastry',
  'beverage', 'coffee', 'soup', 'salad', 'rice', 'pasta', 'hummus',
  'vegetables', 'box', 'package', 'kitchen', 'sugar', 'sauce', 'wine', 'food',
]);
// Reduce any string to its last clean word, keep it only if it's a
// verified tag; otherwise use the provided fallback.
const safeTag = (raw, fallback) => {
  const t = String(raw).split(',')[0].trim().split(/\s+/).pop()
    .toLowerCase().replace(/[^a-z]/g, '');
  return SAFE_TAGS.has(t) ? t : (fallback || 'food');
};
const img = (tag, seed) => `https://loremflickr.com/400/400/${tag}?lock=${seed}`;

// ─── categories (Hebrew name + English keyword for images) ───────────
// fb = verified fallback tag used when an item's own name has no
// known-good loremflickr tag (guarantees every image loads).
const CATEGORIES = [
  { name: 'מוצרי חלב',            fb: 'dairy' },
  { name: 'בשר ועוף',             fb: 'meat' },
  { name: 'דגים',                 fb: 'fish' },
  { name: 'ירקות',                fb: 'vegetables' },
  { name: 'פירות',                fb: 'fruit' },
  { name: 'תבלינים ועשבי תיבול',  fb: 'kitchen' },
  { name: 'קמחים ודגנים',         fb: 'flour' },
  { name: 'שמנים ורטבים',         fb: 'oil' },
  { name: 'אגוזים ופירות יבשים',  fb: 'nuts' },
  { name: 'ממתיקים ושוקולד',      fb: 'chocolate' },
  { name: 'משקאות',               fb: 'beverage' },
  { name: 'אריזות וחומרי עזר',    fb: 'box' },
];

// ─── base raw-materials per category ─────────────────────────────────
// Each: [he, en, cost_per_kg(₪), [package sizes in kg]]
const RAW = {
  'מוצרי חלב': [
    ['חלב טרי 3%', 'Fresh Milk 3%', 6, [1, 2]],
    ['שמנת מתוקה 38%', 'Heavy Cream 38%', 22, [0.25, 0.5, 1]],
    ['חמאה', 'Butter', 45, [0.2, 0.5, 1]],
    ['גבינה צהובה', 'Yellow Cheese', 48, [0.2, 0.5, 1]],
    ['גבינת שמנת', 'Cream Cheese', 36, [0.25, 0.5]],
    ['גבינת מוצרלה', 'Mozzarella', 42, [0.5, 1, 2.5]],
    ['גבינת פטה', 'Feta Cheese', 40, [0.2, 0.5]],
    ['יוגורט טבעי', 'Natural Yogurt', 12, [0.5, 1]],
    ['גבינת מסקרפונה', 'Mascarpone', 52, [0.25, 0.5]],
    ['חלב קוקוס', 'Coconut Milk', 14, [0.4, 1]],
    ['שמנת חמוצה', 'Sour Cream', 24, [0.2, 0.5]],
    ['גבינת ריקוטה', 'Ricotta', 38, [0.25, 0.5]],
  ],
  'בשר ועוף': [
    ['חזה עוף', 'Chicken Breast', 38, [1, 2.5, 5]],
    ['שוקיים עוף', 'Chicken Drumsticks', 28, [1, 2.5]],
    ['בשר בקר טחון', 'Ground Beef', 52, [0.5, 1, 2.5]],
    ['אנטריקוט', 'Entrecote', 130, [0.5, 1]],
    ['כתף כבש', 'Lamb Shoulder', 95, [1, 2]],
    ['כבד עוף', 'Chicken Liver', 22, [0.5, 1]],
    ['פסטרמה הודו', 'Turkey Pastrami', 60, [0.25, 0.5, 1]],
    ['נקניקיות', 'Beef Sausages', 44, [0.5, 1]],
    ['שניצל הודו', 'Turkey Schnitzel', 40, [1, 2.5]],
    ['אסאדו', 'Asado Ribs', 78, [1, 2]],
  ],
  'דגים': [
    ['פילה סלמון', 'Salmon Fillet', 95, [0.5, 1]],
    ['פילה דניס', 'Sea Bream Fillet', 70, [0.5, 1]],
    ['טונה בשמן', 'Tuna in Oil', 30, [0.16, 0.4]],
    ['פילה אמנון', 'Tilapia Fillet', 48, [0.5, 1]],
    ['דג מושט', 'Carp', 40, [1, 2]],
    ['סרדינים', 'Sardines', 26, [0.12, 0.25]],
  ],
  'ירקות': [
    ['עגבניה', 'Tomato', 7, [1, 5]],
    ['מלפפון', 'Cucumber', 6, [1, 5]],
    ['בצל יבש', 'Onion', 4, [1, 5, 10]],
    ['שום', 'Garlic', 18, [0.25, 0.5, 1]],
    ['גזר', 'Carrot', 5, [1, 5]],
    ['פלפל אדום', 'Red Pepper', 12, [1, 3]],
    ['תפוח אדמה', 'Potato', 4, [1, 5, 10]],
    ['בטטה', 'Sweet Potato', 8, [1, 5]],
    ['חציל', 'Eggplant', 7, [1, 3]],
    ['קישוא', 'Zucchini', 6, [1, 3]],
    ['פטריות שמפיניון', 'Mushrooms', 18, [0.25, 0.5, 1]],
    ['תרד טרי', 'Fresh Spinach', 14, [0.25, 0.5]],
    ['כרוב', 'Cabbage', 5, [1, 3]],
    ['סלק', 'Beetroot', 6, [1, 3]],
  ],
  'פירות': [
    ['תפוח עץ', 'Apple', 8, [1, 3]],
    ['בננה', 'Banana', 7, [1, 3]],
    ['לימון', 'Lemon', 9, [0.5, 1]],
    ['תות שדה', 'Strawberry', 22, [0.25, 0.5]],
    ['אבוקדו', 'Avocado', 16, [0.5, 1]],
    ['תמרים מג׳הול', 'Medjool Dates', 40, [0.4, 1]],
    ['ענבים', 'Grapes', 12, [0.5, 1]],
    ['מנגו', 'Mango', 14, [0.5, 1]],
  ],
  'תבלינים ועשבי תיבול': [
    ['מלח ים', 'Sea Salt', 5, [0.5, 1]],
    ['פלפל שחור גרוס', 'Black Pepper', 70, [0.1, 0.25, 0.5]],
    ['פפריקה מתוקה', 'Sweet Paprika', 30, [0.1, 0.25, 0.5]],
    ['כמון', 'Cumin', 38, [0.1, 0.25]],
    ['כורכום', 'Turmeric', 28, [0.1, 0.25]],
    ['קינמון', 'Cinnamon', 45, [0.1, 0.25]],
    ['אורגנו', 'Oregano', 40, [0.05, 0.1]],
    ['בזיליקום טרי', 'Fresh Basil', 60, [0.05, 0.1]],
    ['פטרוזיליה', 'Parsley', 18, [0.1, 0.25]],
    ['כוסברה', 'Coriander', 18, [0.1, 0.25]],
    ['זעתר', 'Zaatar', 34, [0.1, 0.25, 0.5]],
    ['הל טחון', 'Ground Cardamom', 120, [0.05, 0.1]],
  ],
  'קמחים ודגנים': [
    ['קמח חיטה לבן', 'White Wheat Flour', 4, [1, 5, 25]],
    ['קמח מלא', 'Whole Wheat Flour', 6, [1, 5]],
    ['קמח כוסמין', 'Spelt Flour', 12, [1, 5]],
    ['אורז בסמטי', 'Basmati Rice', 12, [1, 5]],
    ['אורז עגול', 'Round Rice', 8, [1, 5]],
    ['בורגול', 'Bulgur', 9, [0.5, 1]],
    ['קוסקוס', 'Couscous', 10, [0.5, 1]],
    ['פתיתים', 'Ptitim', 9, [0.5, 1]],
    ['שיבולת שועל', 'Oats', 8, [0.5, 1]],
    ['קמח תירס', 'Cornflour', 7, [0.5, 1]],
    ['פירורי לחם', 'Breadcrumbs', 10, [0.5, 1]],
  ],
  'שמנים ורטבים': [
    ['שמן זית כתית', 'Extra Virgin Olive Oil', 35, [0.75, 1, 3]],
    ['שמן קנולה', 'Canola Oil', 10, [1, 3, 5]],
    ['שמן חמניות', 'Sunflower Oil', 9, [1, 3]],
    ['רוטב סויה', 'Soy Sauce', 18, [0.5, 1]],
    ['חומץ בלסמי', 'Balsamic Vinegar', 30, [0.5, 1]],
    ['רסק עגבניות', 'Tomato Paste', 12, [0.2, 0.5, 1]],
    ['מיונז', 'Mayonnaise', 16, [0.5, 1]],
    ['חרדל דיז׳ון', 'Dijon Mustard', 24, [0.25, 0.5]],
    ['טחינה גולמית', 'Raw Tahini', 22, [0.5, 1]],
    ['סילאן', 'Date Syrup', 20, [0.5, 1]],
  ],
  'אגוזים ופירות יבשים': [
    ['אגוזי מלך', 'Walnuts', 55, [0.25, 0.5, 1]],
    ['שקדים', 'Almonds', 60, [0.25, 0.5, 1]],
    ['פיסטוק', 'Pistachio', 90, [0.25, 0.5]],
    ['צנוברים', 'Pine Nuts', 180, [0.1, 0.25]],
    ['קשיו', 'Cashew', 70, [0.25, 0.5]],
    ['צימוקים', 'Raisins', 22, [0.25, 0.5, 1]],
    ['חמוציות מיובשות', 'Dried Cranberries', 32, [0.25, 0.5]],
    ['שומשום', 'Sesame Seeds', 18, [0.25, 0.5]],
    ['זרעי חמניה', 'Sunflower Seeds', 14, [0.25, 0.5]],
  ],
  'ממתיקים ושוקולד': [
    ['סוכר לבן', 'White Sugar', 5, [1, 5, 25]],
    ['סוכר חום', 'Brown Sugar', 8, [0.5, 1]],
    ['אבקת סוכר', 'Powdered Sugar', 9, [0.5, 1]],
    ['שוקולד מריר 70%', 'Dark Chocolate 70%', 55, [0.2, 0.5, 1]],
    ['שוקולד חלב', 'Milk Chocolate', 48, [0.2, 0.5, 1]],
    ['קקאו', 'Cocoa Powder', 40, [0.2, 0.5]],
    ['דבש', 'Honey', 35, [0.5, 1]],
    ['וניל טבעי', 'Vanilla Extract', 220, [0.05, 0.1]],
    ['ממרח אגוזי לוז', 'Hazelnut Spread', 30, [0.4, 0.75]],
  ],
  'משקאות': [
    ['מים מינרליים', 'Mineral Water', 3, [1.5, 6]],
    ['מיץ תפוזים', 'Orange Juice', 9, [1, 1.5]],
    ['קפה טחון', 'Ground Coffee', 60, [0.25, 0.5, 1]],
    ['תה שחור', 'Black Tea', 50, [0.1, 0.25]],
    ['יין אדום לבישול', 'Cooking Red Wine', 28, [0.75, 1]],
    ['סודה', 'Soda Water', 4, [1.5]],
  ],
  'אריזות וחומרי עזר': [
    ['קופסת קרטון 1 ק״ג', 'Cardboard Box 1kg', 2.5, [1]],
    ['מגש אלומיניום', 'Aluminum Tray', 3.5, [1]],
    ['שקית ואקום', 'Vacuum Bag', 1.2, [1]],
    ['מדבקת מוצר', 'Product Label', 0.4, [1]],
    ['נייר אפיה', 'Baking Paper', 6, [1]],
    ['כפית פלסטיק', 'Plastic Spoon', 0.3, [1]],
  ],
};

// ─── recipe definitions ──────────────────────────────────────────────
// type: 'base' = WIP sub-assembly (no retail price), 'final' = sellable.
// Final recipes may reference a base recipe (nested BOM).
const BASE_RECIPES = [
  { he: 'רוטב עגבניות בסיס', en: 'Base Tomato Sauce', kw: 'tomato,sauce', yield: 5, lines: 5 },
  { he: 'בצק פריך בסיס',     en: 'Base Shortcrust Dough', kw: 'dough,pastry', yield: 4, lines: 4 },
  { he: 'קרם פטיסייר',       en: 'Pastry Cream', kw: 'custard,cream', yield: 3, lines: 4 },
  { he: 'תערובת תבלינים לבשר','en': 'Meat Spice Mix', kw: 'spice,mix', yield: 1, lines: 5 },
];

const FINAL_RECIPES = [
  { he: 'חומוס ביתי',          en: 'Homemade Hummus', kw: 'hummus' },
  { he: 'סלט טחינה',           en: 'Tahini Salad', kw: 'tahini' },
  { he: 'שקשוקה',             en: 'Shakshuka', kw: 'shakshuka,eggs' },
  { he: 'מרק עוף ביתי',        en: 'Chicken Soup', kw: 'soup,chicken' },
  { he: 'קציצות בקר ברוטב',    en: 'Beef Meatballs', kw: 'meatballs' },
  { he: 'פשטידת ירקות',        en: 'Vegetable Quiche', kw: 'quiche' },
  { he: 'עוגת שוקולד',         en: 'Chocolate Cake', kw: 'chocolate,cake' },
  { he: 'עוגיות חמאה',         en: 'Butter Cookies', kw: 'cookies' },
  { he: 'לחם כפרי',            en: 'Country Bread', kw: 'bread' },
  { he: 'פוקצ׳ה',              en: 'Focaccia', kw: 'focaccia,bread' },
  { he: 'בורקס תפוחי אדמה',    en: 'Potato Bourekas', kw: 'bourekas,pastry' },
  { he: 'מאפה גבינה',          en: 'Cheese Pastry', kw: 'cheese,pastry' },
  { he: 'סלט קצוץ',            en: 'Chopped Salad', kw: 'salad' },
  { he: 'מג׳דרה',              en: 'Mujadara', kw: 'rice,lentils' },
  { he: 'פסטה ברוטב עגבניות',  en: 'Pasta in Tomato Sauce', kw: 'pasta' },
  { he: 'שניצל הודו פריך',     en: 'Crispy Schnitzel', kw: 'schnitzel' },
  { he: 'אורז עם שקדים',       en: 'Rice with Almonds', kw: 'rice' },
  { he: 'סלט קינואה',          en: 'Quinoa Salad', kw: 'quinoa,salad' },
  { he: 'מוסקה חצילים',        en: 'Eggplant Moussaka', kw: 'eggplant' },
  { he: 'כדורי שוקולד',        en: 'Chocolate Balls', kw: 'chocolate,dessert' },
  { he: 'עוגת גבינה אפויה',    en: 'Baked Cheesecake', kw: 'cheesecake' },
  { he: 'מרק עדשים',           en: 'Lentil Soup', kw: 'soup,lentils' },
  { he: 'דג סלמון בתנור',      en: 'Baked Salmon', kw: 'salmon' },
  { he: 'תבשיל עוף ושקדים',    en: 'Chicken & Almond Stew', kw: 'chicken,stew' },
  { he: 'סלט חסה וגבינה',      en: 'Lettuce & Cheese Salad', kw: 'salad,cheese' },
  { he: 'פאי תפוחים',          en: 'Apple Pie', kw: 'apple,pie' },
  { he: 'בראוניז',             en: 'Brownies', kw: 'brownies' },
  { he: 'ממולאים בשר',         en: 'Stuffed Vegetables', kw: 'stuffed,vegetables' },
  { he: 'פלפלים ממולאים אורז', en: 'Rice Stuffed Peppers', kw: 'peppers,rice' },
  { he: 'טירמיסו',             en: 'Tiramisu', kw: 'tiramisu' },
];

const ALLERGENS = ['גלוטן', 'חלב', 'ביצים', 'אגוזים', 'שומשום', 'סויה', 'דגים'];
const DESCRIPTIONS = [
  'מתכון הבית, מוכן טרי מדי יום מחומרי גלם איכותיים.',
  'מנה קלאסית בגרסה של המטבח שלנו, ללא חומרים משמרים.',
  'אהובה על כל המשפחה — טעם ביתי אמיתי.',
  'מתכון מסורתי שעובר אצלנו מדור לדור.',
  'נמכר בכמויות גדולות לאירועים ולקייטרינג.',
];

// ─── seeding logic (bulk inserts — pooler-friendly) ──────────────────
let imgSeed = 1000;

// Build a recipe "plan" in pure JS (no DB).  ingredientPool is a list of
// {id, cost} (raw materials and/or already-inserted sub-recipes).
function planRecipe(def, recipeType, ingredientPool, extraSub) {
  imgSeed++;
  const isFinal = recipeType === 'final';
  const yieldKg = def.yield ?? round(rand(1, 6), 1);
  const nLines  = def.lines ?? randInt(4, 8);

  const chosen = sample(ingredientPool, Math.min(nLines, ingredientPool.length));
  const lines = chosen.map((ing) => ({
    id: ing.id, cost: ing.cost,
    qty: round(rand(0.05, 1.5), 3),
    waste: pick([0, 0, 0, 2, 5, 8]),
    isRecipe: false,
  }));
  if (extraSub) {
    lines.push({ id: extraSub.id, cost: extraSub.cost,
                 qty: round(rand(0.3, 1.2), 3), waste: 0, isRecipe: true });
  }

  let materialCost = 0;
  for (const l of lines) {
    l.lineCost = round((l.qty / (1 - l.waste / 100)) * l.cost, 4);
    materialCost += l.lineCost;
  }
  const labor     = isFinal ? round(rand(5, 25), 2) : round(rand(2, 10), 2);
  const overhead  = round(rand(2, 12), 2);
  const packaging = isFinal ? round(rand(1, 6), 2) : 0;
  const totalCost = round(materialCost + labor + overhead + packaging, 4);
  const costPerKg = round(totalCost / yieldKg, 4);

  return {
    nameHe: def.he, nameEn: def.en,
    imageUrl: img(safeTag(def.kw, 'food'), imgSeed),
    yieldKg, recipeType,
    description: pick(DESCRIPTIONS),
    allergens: sample(ALLERGENS, randInt(0, 3)),
    isSpicy: Math.random() < 0.2,
    servings: randInt(2, 12),
    labor, overhead, packaging, totalCost, costPerKg,
    wholesale: isFinal ? round(costPerKg * 2.5, 4) : null,
    retail:    isFinal ? round(costPerKg * 5.0, 4) : null,
    lines,
  };
}

// Bulk-insert a batch of recipe plans (items -> boms -> bom_lines).
// Returns [{id, cost, nameEn}] so later recipes can nest these.
async function insertRecipes(client, plans) {
  if (plans.length === 0) return [];

  // 1. items (the recipe rows)
  const { rows: itemRows } = await client.query(
    `INSERT INTO items (name, name_en, name_he, uom, item_type, is_active, image_url, cost_per_kg)
     SELECT n, en, he, 'kg', 'recipe', TRUE, img, cpk
     FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::numeric[])
          AS t(n, en, he, img, cpk)
     RETURNING id, name_en`,
    [plans.map(p => p.nameHe), plans.map(p => p.nameEn), plans.map(p => p.nameHe),
     plans.map(p => p.imageUrl), plans.map(p => p.costPerKg)]
  );
  const idByEn = new Map(itemRows.map(r => [r.name_en, r.id]));
  for (const p of plans) p.itemId = idByEn.get(p.nameEn);

  // 2. boms (one per recipe item)
  const { rows: bomRows } = await client.query(
    `INSERT INTO boms
       (item_id, yield_kg, recipe_type, full_name, description, allergens,
        is_spicy, servings_count, total_weight, labor_cost, overhead_cost,
        packaging_cost, cost_per_kg, total_cost, wholesale_price, retail_price,
        reference_code, is_active)
     SELECT item_id, yield_kg, rtype, fname, descr,
            CASE WHEN alg = '' THEN '{}'::text[] ELSE string_to_array(alg, '|') END,
            spicy, serv, yield_kg, labor, oh, pack, cpk, tcost, whp, rtp,
            'REC-' || lpad(item_id::text, 4, '0'), TRUE
     FROM unnest($1::int[],$2::numeric[],$3::text[],$4::text[],$5::text[],$6::text[],
                 $7::bool[],$8::int[],$9::numeric[],$10::numeric[],$11::numeric[],
                 $12::numeric[],$13::numeric[],$14::numeric[],$15::numeric[])
          AS t(item_id, yield_kg, rtype, fname, descr, alg, spicy, serv,
               labor, oh, pack, cpk, tcost, whp, rtp)
     RETURNING id, item_id`,
    [plans.map(p => p.itemId), plans.map(p => p.yieldKg), plans.map(p => p.recipeType),
     plans.map(p => p.nameHe), plans.map(p => p.description),
     plans.map(p => p.allergens.join('|')), plans.map(p => p.isSpicy),
     plans.map(p => p.servings), plans.map(p => p.labor), plans.map(p => p.overhead),
     plans.map(p => p.packaging), plans.map(p => p.costPerKg), plans.map(p => p.totalCost),
     plans.map(p => p.wholesale), plans.map(p => p.retail)]
  );
  const bomByItem = new Map(bomRows.map(r => [r.item_id, r.id]));

  // 3. bom_lines (flatten every plan's ingredient lines)
  const L = { bom: [], ing: [], qty: [], waste: [], itype: [], snap: [], lcost: [] };
  for (const p of plans) {
    const bomId = bomByItem.get(p.itemId);
    for (const l of p.lines) {
      L.bom.push(bomId); L.ing.push(l.id); L.qty.push(l.qty); L.waste.push(l.waste);
      L.itype.push(l.isRecipe ? 'recipe' : 'raw_material'); L.snap.push(l.cost);
      L.lcost.push(l.lineCost);
    }
  }
  await client.query(
    `INSERT INTO bom_lines
       (bom_id, ingredient_item_id, quantity_kg, line_uom, waste_pct,
        ingredient_type, price_per_kg_snapshot, line_cost)
     SELECT bom, ing, qty, 'kg', waste, itype, snap, lcost
     FROM unnest($1::int[],$2::int[],$3::numeric[],$4::numeric[],$5::text[],
                 $6::numeric[],$7::numeric[])
          AS t(bom, ing, qty, waste, itype, snap, lcost)`,
    [L.bom, L.ing, L.qty, L.waste, L.itype, L.snap, L.lcost]
  );

  return plans.map(p => ({ id: p.itemId, cost: p.costPerKg, nameEn: p.nameEn }));
}

async function seed() {
  const client = await pool.connect();
  try {
    // Supabase enforces a short statement_timeout by default; lift it for
    // this bulk load, and fail fast (not hang) if a lock is contended.
    await client.query('SET statement_timeout = 0');
    await client.query('SET lock_timeout = \'30s\'');
    await client.query('SET idle_in_transaction_session_timeout = 0');
    await client.query('BEGIN');

    console.log('[seed] Clearing existing catalogue data…');
    await client.query(`
      TRUNCATE TABLE bom_snapshots, cost_history, bom_lines, boms, items, categories
      RESTART IDENTITY CASCADE
    `);

    // ── Categories (single bulk insert) ──
    console.log('[seed] Inserting categories…');
    const { rows: catRows } = await client.query(
      `INSERT INTO categories (name, odoo_id)
       SELECT n, oid FROM unnest($1::text[], $2::int[]) AS t(n, oid)
       RETURNING id, name`,
      [CATEGORIES.map(c => c.name), CATEGORIES.map((_, i) => 800000 + i)]
    );
    const catId = new Map(catRows.map(r => [r.name, r.id]));

    // ── Raw materials (build in JS, one bulk insert) ──
    console.log('[seed] Building & inserting raw materials…');
    const RM = { oid: [], name: [], en: [], he: [], cat: [], cpk: [], rcost: [], vol: [], ref: [], img: [] };
    let rmIdx = 0;
    for (const [catName, items] of Object.entries(RAW)) {
      const cat = CATEGORIES.find(c => c.name === catName);
      for (const [he, en, baseCost, sizes] of items) {
        for (const kg of sizes) {
          rmIdx++;
          const sizeLabel = kg >= 1 ? `${kg} ק״ג` : `${kg * 1000} גרם`;
          const nameHe    = `${he} ${sizeLabel}`;
          const nameEn    = `${en} ${kg >= 1 ? kg + 'kg' : kg * 1000 + 'g'}`;
          const costPerKg = round(baseCost * rand(0.9, 1.12), 2);
          RM.oid.push(900000 + rmIdx); RM.name.push(nameHe); RM.en.push(nameEn);
          RM.he.push(nameHe); RM.cat.push(catId.get(catName)); RM.cpk.push(costPerKg);
          RM.rcost.push(round(costPerKg * kg, 2)); RM.vol.push(kg);
          RM.ref.push(`RM-${String(rmIdx).padStart(5, '0')}`);
          RM.img.push(img(safeTag(en, cat.fb), imgSeed++));
        }
      }
    }
    const { rows: rawRows } = await client.query(
      `INSERT INTO items
         (odoo_id, name, name_en, name_he, category_id, uom, cost_per_kg, raw_cost,
          volume_weight, weight_source, reference, image_url, item_type, is_active, last_synced_at)
       SELECT oid, name, en, he, cat, 'kg', cpk, rcost, vol, 'odoo', ref, img,
              'raw_material', TRUE, NOW()
       FROM unnest($1::int[],$2::text[],$3::text[],$4::text[],$5::int[],$6::numeric[],
                   $7::numeric[],$8::numeric[],$9::text[],$10::text[])
            AS t(oid, name, en, he, cat, cpk, rcost, vol, ref, img)
       RETURNING id, cost_per_kg`,
      [RM.oid, RM.name, RM.en, RM.he, RM.cat, RM.cpk, RM.rcost, RM.vol, RM.ref, RM.img]
    );
    const allRaw = rawRows.map(r => ({ id: r.id, cost: parseFloat(r.cost_per_kg) }));
    console.log(`[seed]   -> ${allRaw.length} raw materials inserted`);

    // ── cost_history (one ledger row per raw material) ──
    await client.query(
      `INSERT INTO cost_history (item_id, cost_per_kg, source)
       SELECT id, cost_per_kg, 'odoo_sync'
       FROM   items WHERE item_type = 'raw_material' AND cost_per_kg IS NOT NULL`
    );

    // ── Base (WIP) recipes — raw materials only ──
    console.log('[seed] Inserting base recipes…');
    const basePlans = BASE_RECIPES.map(def => planRecipe(def, 'base', allRaw, null));
    const baseRecipes = await insertRecipes(client, basePlans);

    // ── Final (sellable) recipes — raw + sometimes a base recipe ──
    console.log('[seed] Inserting final recipes…');
    const finalPlans = FINAL_RECIPES.map(def =>
      planRecipe(def, 'final', allRaw, Math.random() < 0.4 ? pick(baseRecipes) : null));
    await insertRecipes(client, finalPlans);

    // ── Demo users with LOCAL passwords (scrypt-hashed) ──
    // Login is now local (no Odoo): each user signs in with their
    // username + the password below.  Admins can create more users and
    // reset passwords; any user can change their own in the app.
    console.log('[seed] Inserting demo users…');
    const DEMO_USERS = [
      ['admin', 'מנהל מערכת (דמו)', 'admin@kosher-place.com', 'admin',    'admin123'],
      ['talya', 'טליה',             'talya@kosher-place.com', 'admin',    'talya123'],
      ['shop',  'משתמש חנות',       'shop@kosher-place.com',  'customer', 'shop123'],
      ['chef',  'שף',               'chef@kosher-place.com',  'customer', 'chef123'],
    ];
    await client.query(
      `INSERT INTO users (username, name, email, role, password_hash, is_active)
       SELECT u, n, e, r, ph, TRUE
       FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[])
            AS t(u, n, e, r, ph)
       ON CONFLICT (username) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         role          = EXCLUDED.role,
         is_active     = TRUE,
         updated_at    = NOW()`,
      [
        DEMO_USERS.map(x => x[0]), DEMO_USERS.map(x => x[1]),
        DEMO_USERS.map(x => x[2]), DEMO_USERS.map(x => x[3]),
        DEMO_USERS.map(x => hashPassword(x[4])),
      ]
    );

    await client.query('COMMIT');

    const { rows: counts } = await pool.query(`
      SELECT (SELECT COUNT(*) FROM categories)                            AS categories,
             (SELECT COUNT(*) FROM items WHERE item_type='raw_material')  AS raw_materials,
             (SELECT COUNT(*) FROM items WHERE item_type='recipe')        AS recipes,
             (SELECT COUNT(*) FROM bom_lines)                             AS bom_lines,
             (SELECT COUNT(*) FROM users)                                 AS users
    `);
    console.log('\n[seed] ✅ Done. Database now contains:');
    console.table(counts[0]);
    console.log('\nDemo logins (username / code):');
    console.log('   admin / admin123   (admin)');
    console.log('   talya / talya123   (admin)');
    console.log('   shop  / shop123    (customer)');
    console.log('   chef  / chef123    (customer)\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n[seed] ❌ Failed — rolled back. Error:', err.message);
    if (err.code) console.error('       code:', err.code);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();

