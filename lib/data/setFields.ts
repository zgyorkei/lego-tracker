// Which fields of a set may change after it is created. This is the list in
// the sets update rule (affectedKeys().hasOnly([...]) in firestore.rules), so
// a write built from it never fails the rules; setFields.test.ts reads the
// rules file and fails if the two drift apart.

export const SET_UPDATABLE_FIELDS = [
  'status',
  'priority',
  'orderedDate',
  'orderedPriceHuf',
  'orderedOriginalPrice',
  'orderedCurrency',
  'name',
  'productImage',
  'legoPriceHuf',
  'legoUrl',
  'isTemporary',
  'releaseDate',
  'hasFetchedLegoInfo',
  'lastLegoPriceRefreshTime',
  'marketPrices',
  'lastPricesRefreshTime',
  'legoPriceError',
  'updatedAt',
  'quantity',
  'minifigures',
  'minifiguresStatus',
] as const;

export type SetUpdatableField = (typeof SET_UPDATABLE_FIELDS)[number];

/** Set only when the set is created (the rules pin them afterwards). */
export const SET_CREATE_ONLY_FIELDS = ['userId', 'createdAt', 'addedAt', 'setNumber'] as const;

const UPDATABLE = new Set<string>(SET_UPDATABLE_FIELDS);
export const isSetUpdatableField = (field: string): field is SetUpdatableField =>
  UPDATABLE.has(field);
