import { LegoSet, MarketPrices, PriceHistory, PriceQuote, Registry, RegistryReservation } from './types';

// ---------------------------------------------------------------------------
// Demo Mode's data: made-up prices on real sets, so a visitor sees every
// feature without signing in. Nothing here is anybody's collection.
//
// Images are Brickset's, which stay put (LEGO's old image server the demo used
// to point at no longer exists). Dates are relative to today, so the demo never
// looks stale; prices are plausible but invented.
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const RATE = 385; // HUF per EUR used for the invented quotes
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const isoDay = (daysAgo: number) => iso(daysAgo).slice(0, 10);
const brickset = (id: string) => `https://images.brickset.com/sets/images/${id}.jpg`;

function eur(price: number, store: string, url: string): PriceQuote {
  return { price, priceEur: price, priceHuf: Math.round(price * RATE), store, url };
}
function huf(price: number, store: string, url: string): PriceQuote {
  return { price, priceEur: Math.round((price / RATE) * 100) / 100, priceHuf: price, store, url };
}
const amazon = (n: string, price: number) => eur(price, 'Amazon EU', `https://www.amazon.de/s?k=lego+${n}`);
const bricklink = (n: string, price: number, condition: 'sealed' | 'complete') =>
  eur(price, `New (${condition})`, `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${n}-1`);
const arukereso = (n: string, price: number) => huf(price, 'Arukereso', `https://www.arukereso.hu/CategorySearch.php?st=${n}`);

function prices(quotes: Record<string, PriceQuote>): MarketPrices {
  return { ...quotes, exchangeRate: RATE };
}

const base = (n: string, daysAgo: number) => ({
  userId: 'demo-user',
  setNumber: n,
  createdAt: iso(daysAgo),
  updatedAt: iso(1),
  hasFetchedLegoInfo: true,
  lastLegoPriceRefreshTime: Date.now() - 6 * 60 * 60 * 1000,
  lastPricesRefreshTime: Date.now() - 3 * 60 * 60 * 1000,
  quantity: 1,
});

export const DEMO_SETS: LegoSet[] = [
  {
    ...base('10305', 120),
    id: 'demo-10305',
    name: "Lion Knights' Castle",
    legoPriceHuf: 154990,
    productImage: brickset('10305-1'),
    legoUrl: 'https://www.lego.com/hu-hu/product/lion-knights-castle-10305',
    status: 'ordered',
    priority: 'high',
    isTemporary: false,
    releaseDate: null,
    // Bought below the official price: the dashboard shows the saving.
    orderedDate: isoDay(70),
    orderedPriceHuf: 129990,
    orderedOriginalPrice: 129990,
    orderedCurrency: 'HUF',
    marketPrices: prices({ amazon: amazon('10305', 349.99), bricklink: bricklink('10305', 389, 'sealed'), arukereso: arukereso('10305', 139990) }),
  },
  {
    ...base('21348', 95),
    id: 'demo-21348',
    name: "Dungeons & Dragons: Red Dragon's Tale",
    legoPriceHuf: 144990,
    productImage: brickset('21348-1'),
    legoUrl: 'https://www.lego.com/hu-hu/product/dungeons-dragons-red-dragon-s-tale-21348',
    status: 'planned',
    priority: 'high',
    isTemporary: false,
    releaseDate: null,
    marketPrices: prices({ amazon: amazon('21348', 289.99), bricklink: bricklink('21348', 315, 'sealed'), arukereso: arukereso('21348', 129990) }),
  },
  {
    ...base('10333', 80),
    id: 'demo-10333',
    name: 'The Lord of the Rings: Barad-dûr',
    legoPriceHuf: 194990,
    productImage: brickset('10333-1'),
    legoUrl: 'https://www.lego.com/hu-hu/product/the-lord-of-the-rings-barad-dur-10333',
    status: 'planned',
    priority: 'low',
    isTemporary: false,
    releaseDate: null,
    // Over 30% below the official price: shown as a great deal.
    marketPrices: prices({ amazon: amazon('10333', 349), bricklink: bricklink('10333', 399, 'sealed'), arukereso: arukereso('10333', 159990) }),
  },
  {
    ...base('31393', 40),
    id: 'demo-31393',
    name: 'Forest Animals: Gray Wolf',
    legoPriceHuf: 18990,
    productImage: brickset('31393-1'),
    legoUrl: 'https://www.lego.com/hu-hu/product/forest-animals-gray-wolf-31393',
    status: 'planned',
    priority: 'medium',
    isTemporary: false,
    releaseDate: null,
    marketPrices: prices({ amazon: amazon('31393', 41.99), bricklink: bricklink('31393', 38, 'complete'), arukereso: arukereso('31393', 14998) }),
  },
  {
    ...base('71047', 60),
    id: 'demo-71047',
    name: 'Dungeons & Dragons Minifigures',
    legoPriceHuf: 1690,
    productImage: brickset('71047-0'),
    legoUrl: 'https://www.lego.com/hu-hu/product/dungeons-dragons-71047',
    status: 'planned',
    priority: 'medium',
    isTemporary: false,
    releaseDate: null,
    minifigures: [
      { id: '71047-1', name: 'Dwarf Barbarian', image: brickset('71047-1') },
      { id: '71047-2', name: 'Gith Warlock', image: brickset('71047-2') },
      { id: '71047-3', name: 'Tiefling Sorcerer', image: brickset('71047-3') },
      { id: '71047-4', name: 'Dragonborn Paladin', image: brickset('71047-4') },
      { id: '71047-5', name: 'Halfling Druid', image: brickset('71047-5') },
      { id: '71047-6', name: 'Aarakocra Ranger', image: brickset('71047-6') },
    ],
    minifiguresStatus: { '71047-1': 'got', '71047-2': 'wanted', '71047-3': 'got', '71047-4': 'wanted', '71047-6': 'wanted' },
    marketPrices: prices({ amazon: amazon('71047', 4.29), arukereso: arukereso('71047', 1490) }),
  },
  {
    ...base('11390', 30),
    id: 'demo-11390',
    name: 'Dragon Ball: Shenron & Goku',
    legoPriceHuf: 53990,
    productImage: brickset('11390-1'),
    legoUrl: 'https://www.lego.com/hu-hu/product/dragon-ball-shenron-goku-11390',
    status: 'planned',
    priority: 'medium',
    isTemporary: false,
    releaseDate: null,
    marketPrices: prices({ amazon: amazon('11390', 129.99), arukereso: arukereso('11390', 47990) }),
  },
  {
    ...base('76340', 10),
    id: 'demo-76340',
    name: 'LEGO Marvel Advent Calendar 2026',
    legoPriceHuf: 13490,
    productImage: brickset('76340-1'),
    legoUrl: 'https://www.lego.com/hu-hu/product/76340',
    status: 'planned',
    priority: 'low',
    // Not out yet: details from a fan site, shown as provisional.
    isTemporary: true,
    releaseDate: 'September 2026',
    marketPrices: prices({ arukereso: arukereso('76340', 12990) }),
  },
];

/** Deterministic noise in [-1, 1) from a string, so the demo chart is the same on every visit. */
function noise(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 2000) / 1000 - 1;
}

/**
 * Twelve weekly price readings for a demo set, ending today: each source a
 * few percent dearer at first, drifting down to its current quote, with some
 * week-to-week wobble. Shaped like what useSets.getPriceHistory returns.
 */
export function demoPriceHistory(set: Pick<LegoSet, 'setNumber' | 'marketPrices'>): PriceHistory[] {
  const quotes = Object.entries(set.marketPrices ?? {}).filter(
    (e): e is [string, PriceQuote] => typeof e[1] === 'object' && e[1] !== null && typeof (e[1] as PriceQuote).priceHuf === 'number'
  );
  if (quotes.length === 0) return [];
  const weeks = 12;
  return Array.from({ length: weeks }, (_, i) => {
    const weeksAgo = weeks - 1 - i;
    const entry: PriceHistory = { id: `demo-${set.setNumber}-${i}`, date: isoDay(weeksAgo * 7), exchangeRate: RATE };
    for (const [id, q] of quotes) {
      const factor = 1 + 0.09 * (weeksAgo / (weeks - 1)) + (weeksAgo === 0 ? 0 : 0.025 * noise(`${set.setNumber}${id}${i}`));
      entry[`${id}Price`] = Math.round(q.price * factor * 100) / 100;
      entry[`${id}PriceHuf`] = Math.round(q.priceHuf * factor);
    }
    return entry;
  });
}

/** The registry behind /registry/demo: the planned demo sets, nothing stored. */
export const DEMO_REGISTRY: Registry = {
  id: 'demo',
  userId: 'demo-user',
  title: "Anna's LEGO wishlist (demo)",
  sets: DEMO_SETS.filter((s) => s.status === 'planned'),
  createdAt: iso(14),
};

/** One gift already taken, so the demo shows what a reserved set looks like. */
export const DEMO_RESERVATIONS: Record<string, RegistryReservation> = {
  'demo-31393': { id: 'demo-31393', setId: 'demo-31393', reservedBy: 'Grandma', createdAt: iso(3) },
};
