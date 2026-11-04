import type { LegoSet } from '../types';
import { withIsoDates } from '../../lib/data/timestamps';

// The set fields that hold a timestamp: createdAt/updatedAt are filled by
// serverTimestamp(), addedAt is written as an ISO string. Other date fields
// (orderedDate, releaseDate) are free-form strings and stay as they are.
export const SET_DATE_FIELDS = ['createdAt', 'updatedAt', 'addedAt'] as const;

/** A set with its timestamps as ISO strings, whatever form they were read in. */
export const withSetDates = (set: LegoSet): LegoSet => withIsoDates(set, SET_DATE_FIELDS);
