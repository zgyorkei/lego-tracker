import type { LegoSet } from '../types';
import { withIsoDates } from '../../lib/data/timestamps';

// The set fields Firestore fills with serverTimestamp(). Everything else on a
// set that holds a date (orderedDate, releaseDate) is written as a string.
export const SET_DATE_FIELDS = ['createdAt', 'updatedAt'] as const;

/** A set with createdAt/updatedAt as ISO strings, whatever form they were read in. */
export const withSetDates = (set: LegoSet): LegoSet => withIsoDates(set, SET_DATE_FIELDS);
