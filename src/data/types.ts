import type { LegoSet, PriceHistory, PriceSource } from '../types';

// The seam between the app and where its data lives. Today the only backend is
// Firestore (firestoreBackend.ts); the local-storage plan adds one for the
// desktop app's own copy and one for the website reading it through Drive.
// Hooks talk to these interfaces, so App and SetCard do not change per backend.

/** Who is signed in, independent of how. */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  /** The Google account id (OAuth `sub`), which keys local data. Null if not a Google sign-in. */
  googleSub: string | null;
}

/**
 * The signed-in user as a hook sees it: undefined while a remembered session
 * is still being restored, null once it is known that nobody is signed in.
 * Keeping the two apart is what keeps the set list "loading" until then.
 */
export type SessionUser = AuthUser | null | undefined;

export interface SessionProvider {
  /** Calls back with the current user (null when signed out), now and on every change. */
  subscribe(listener: (user: AuthUser | null) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /**
   * False when this copy is limited to certain accounts and this one is not
   * among them. Anything but a definite refusal counts as allowed.
   */
  hasAccess(user: AuthUser): Promise<boolean>;
}

/** What a backend supports beyond the user's own sets and settings. */
export interface DataCapabilities {
  /** Gift registries: world-readable share links. */
  registries: boolean;
  /** The public Planned Sets API link. */
  publicPlannedList: boolean;
  /** The website handing refreshes to the desktop app (refreshRequests, desktopStatus). */
  firestoreWorker: boolean;
}

/** A failure already turned into a message fit for the UI. */
export class DataError extends Error {
  /** The backend's own error code (Firestore's 'permission-denied', say), when it has one. */
  readonly code: string | undefined;

  constructor(message: string, code?: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DataError';
    this.code = code;
  }
}

/** One user's data. Every method that fails rejects (or calls onError) with a DataError. */
export interface DataBackend {
  readonly capabilities: DataCapabilities;

  /** The live set list, newest first, dates as ISO strings. Returns the unsubscribe. */
  subscribeSets(onSets: (sets: LegoSet[]) => void, onError: (error: DataError) => void): () => void;
  addSet(data: Partial<LegoSet>): Promise<void>;
  updateSet(id: string, updates: Partial<LegoSet>): Promise<void>;
  deleteSet(id: string): Promise<void>;
  addPriceHistory(setId: string, row: PriceHistory): Promise<void>;
  /** Oldest first. */
  getPriceHistory(setId: string): Promise<PriceHistory[]>;

  /**
   * The stored price-source list: null when none is stored. `fromCache` says
   * the answer may not reflect the server yet (an empty cache-only answer says
   * nothing about whether a list exists). Returns the unsubscribe.
   */
  subscribePriceSources(
    onSources: (stored: PriceSource[] | null, fromCache: boolean) => void,
    onError: (error: unknown) => void
  ): () => void;
  savePriceSources(sources: PriceSource[]): Promise<void>;
}
