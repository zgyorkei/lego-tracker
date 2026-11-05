/**
 * A LEGO set number as accepted from outside: letters, digits and hyphens, up
 * to 20 characters (the sets rule's cap), starting with a letter or digit.
 * Shared by the API routes and the Drive change batches (lib/data/ops.ts).
 */
export const SET_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/;
