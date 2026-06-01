/**
 * Allergen label translation.
 *
 * Allergens are stored on the recipe as free-text data (the demo seed
 * uses Hebrew values).  For display we map the known values to the
 * current UI language; unknown / custom values are shown as typed.
 *
 * Keyed by a normalised lower-case form so either the Hebrew or the
 * English spelling resolves to the same entry.
 */

type Pair = { en: string; he: string };

const ENTRIES: Pair[] = [
  { en: 'Gluten', he: 'גלוטן' },
  { en: 'Milk',   he: 'חלב' },
  { en: 'Eggs',   he: 'ביצים' },
  { en: 'Nuts',   he: 'אגוזים' },
  { en: 'Sesame', he: 'שומשום' },
  { en: 'Soy',    he: 'סויה' },
  { en: 'Fish',   he: 'דגים' },
];

// Lookup by both the EN and HE spelling (lower-cased, trimmed).
const BY_KEY = new Map<string, Pair>();
for (const p of ENTRIES) {
  BY_KEY.set(p.en.toLowerCase(), p);
  BY_KEY.set(p.he.toLowerCase(), p);
}

/** Translate a single allergen value to the given language. */
export function translateAllergen(value: string, lang: 'en' | 'he'): string {
  const hit = BY_KEY.get(String(value).trim().toLowerCase());
  if (hit) return lang === 'he' ? hit.he : hit.en;
  return value; // custom / unknown — show as entered
}

/** Translate + join a list of allergens with the standard separator. */
export function formatAllergens(values: string[], lang: 'en' | 'he'): string {
  return values.map((v) => translateAllergen(v, lang)).join(' · ');
}
