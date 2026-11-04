import type { LegoSet, Priority } from '../types';
import { toMillis } from '../../lib/data/timestamps';

const PRIORITY: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

// When the set joined the collection: addedAt, else createdAt (sets from
// before addedAt). Reads the date in any form (see lib/data/timestamps.ts),
// so a Timestamp that slips past normalisation still sorts. A set with no
// usable date counts as the oldest.
const addedAt = (s: LegoSet): number => toMillis(s.addedAt) ?? toMillis(s.createdAt) ?? 0;

const byName = (a: LegoSet, b: LegoSet): number => {
  const nameA = (a.name || '').toLowerCase();
  const nameB = (b.name || '').toLowerCase();
  if (nameA < nameB) return -1;
  if (nameA > nameB) return 1;
  return 0;
};

const bySetNumber = (a: LegoSet, b: LegoSet): number =>
  (parseInt(a.setNumber) || 0) - (parseInt(b.setNumber) || 0);

const byPriority = (a: LegoSet, b: LegoSet): number =>
  PRIORITY[a.priority || 'medium'] - PRIORITY[b.priority || 'medium'];

/**
 * The set list's order for one of the sort menu's values. Purchased sets always
 * come last; priority sorts break ties newest first. Unknown values sort by
 * date, newest first (the default).
 */
export function compareSets(sortBy: string): (a: LegoSet, b: LegoSet) => number {
  return (a, b) => {
    if (a.status === 'ordered' && b.status !== 'ordered') return 1;
    if (a.status !== 'ordered' && b.status === 'ordered') return -1;

    switch (sortBy) {
      case 'priority-desc':
        return byPriority(b, a) || addedAt(b) - addedAt(a);
      case 'priority-asc':
        return byPriority(a, b) || addedAt(b) - addedAt(a);
      case 'name-asc':
        return byName(a, b);
      case 'name-desc':
        return byName(b, a);
      case 'set-asc':
        return bySetNumber(a, b);
      case 'set-desc':
        return bySetNumber(b, a);
      case 'date-asc':
        return addedAt(a) - addedAt(b);
      case 'date-desc':
      default:
        return addedAt(b) - addedAt(a);
    }
  };
}
