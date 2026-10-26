import { isPriceQuote, LegoSet, MarketPrices, PriceSource } from '../types';

// ---------------------------------------------------------------------------
// A set's name and image normally come from LEGO.com or Brickset. Some items,
// promotional ones such as 633412, are on neither, yet a shop lists them with
// a title and a picture. These helpers let a price refresh fill in what the
// official sources could not, without ever overwriting a real name or image.
// ---------------------------------------------------------------------------

/**
 * True for names that only stand in for a real one: empty, the default
 * "Lego Set <n>" given on creation, Brickset's "{?}" for unnamed sets, and a
 * bare item number such as "633412-1".
 */
export function isPlaceholderName(name: string | null | undefined, setNumber: string): boolean {
  const n = (name ?? '').trim();
  if (!n || n === '{?}') return true;
  if (/^\d+(-\d+)?$/.test(n)) return true;
  return n.toLowerCase() === `lego set ${setNumber}`.toLowerCase();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turns a shop's listing title into a set name: brand and trademark signs and
 * the set number removed, and of a long keyword-stuffed title (Amazon's
 * "Name - for adults - gift idea - ...") only the first part kept.
 *
 *   "LEGO® 633412 - LEGO® Gaming kontroller állvány (633412)" -> "Gaming kontroller állvány"
 *   "LEGO Creator Forest Animals: Wolf Toy - Animal Figure ... - 31393" -> "Creator Forest Animals: Wolf Toy"
 */
export function nameFromListing(title: string, setNumber: string): string | null {
  const withoutNumber = title
    .replace(/[®™©]/g, ' ')
    .replace(new RegExp(`\\(?\\s*${escapeRe(setNumber)}(-\\d+)?\\s*\\)?`, 'g'), ' ');
  const segments = withoutNumber
    .split(/\s+[-–|]\s+/)
    .map((s) =>
      s
        .replace(/^\s*lego\b/i, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s,:;-]+|[\s,:;-]+$/g, '')
    )
    .filter((s) => /\p{L}{2,}/u.test(s));
  if (segments.length === 0) return null;
  // Three or more parts is a keyword list; two is usually "theme - name".
  const name = segments.length >= 3 ? segments[0] : segments.join(' - ');
  return name.slice(0, 120);
}

/**
 * Name and image to take from a price refresh's listings, for whatever the set
 * still lacks. Sources are tried in the user's order. Returns only the fields
 * to change, so a set with a real name and image gets an empty object.
 */
export function identityFromQuotes(
  set: Pick<LegoSet, 'name' | 'setNumber' | 'productImage'>,
  prices: MarketPrices | undefined,
  sources: PriceSource[]
): Partial<Pick<LegoSet, 'name' | 'productImage'>> {
  const quotes = sources.map((s) => prices?.[s.id]).filter(isPriceQuote);
  const out: Partial<Pick<LegoSet, 'name' | 'productImage'>> = {};

  if (isPlaceholderName(set.name, set.setNumber)) {
    for (const q of quotes) {
      const name = q.title ? nameFromListing(q.title, set.setNumber) : null;
      if (name) {
        out.name = name;
        break;
      }
    }
  }
  if (!set.productImage) {
    const image = quotes.find((q) => q.image && /^https?:\/\//.test(q.image))?.image;
    if (image) out.productImage = image;
  }
  return out;
}

/**
 * The name to store after a set-details lookup: the lookup's, unless it is a
 * placeholder and the set already has a real name (which may have come from
 * a shop listing on an earlier refresh).
 */
export function mergeLookupName(lookupName: string | null | undefined, set: Pick<LegoSet, 'name' | 'setNumber'>): string {
  if (!lookupName || (isPlaceholderName(lookupName, set.setNumber) && !isPlaceholderName(set.name, set.setNumber))) {
    return set.name;
  }
  return lookupName;
}
