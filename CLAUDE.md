# CLAUDE.md

Guidance for agents working in this repo. Prefer the facts here over re-deriving
them: several are non-obvious and easy to get wrong.

## Writing style

- Do **not** use em-dash characters (U+2014) anywhere in code, comments, or docs. Use a regular hyphen.

## Commands

```bash
npm run dev        # Express + Vite middleware, port 3000
npm run build      # client build -> dist/
npm run typecheck  # tsc --noEmit, strict mode
npm run lint       # eslint
npm test           # vitest run
```

CI (`.github/workflows/ci.yml`) gates typecheck, lint, test and build.
`format:check` is deliberately **not** gated pending a one-time format pass.

## Architecture

**Two entry points, one route module.** `lib/server-api.ts` exports
`registerApiRoutes(app)`, called by both `server.ts` (local dev, adds Vite
middleware) and `api/index.ts` (Vercel serverless). Add routes only in
`lib/server-api.ts` or the two environments drift apart. Both import with an
explicit `.js` extension, which Vercel's ESM resolution requires.

**No backend database access.** There is no Firebase Admin SDK. The Express
layer never touches Firestore and never verifies an ID token, so *all* data
authorisation lives in `firestore.rules`. Treat that file as security-critical.

**Routing is hand-rolled** in `src/main.tsx` by matching `window.location.pathname`.
There is no router library. `App` and `RegistryView` are lazy-loaded and mutually
exclusive.

## Gotchas

- **Tailwind v4, CSS-first.** Theme tokens live in `src/index.css` under
  `@theme`, with per-theme overrides keyed off `html[data-theme="..."]`. There is
  no `tailwind.config.js` and adding one is not the right fix for anything.
- **`GEMINI_API_KEY` is server-only.** Never reference it from `src/`. An
  `x-gemini-api-key` request header used to be honoured; it was removed on
  purpose, since it let a caller make the server use an arbitrary credential.
- **The API is unauthenticated** (single-user app) and several routes spend
  Gemini quota. Protection is the per-IP `rateLimit` middleware in
  `lib/server-api.ts`. On Vercel each instance has its own memory, so the limit
  is per-instance and best-effort by design.
- **Outbound fetches of user-supplied URLs must go through
  `assertSafeOutboundUrl`** and pass `maxRedirects: 0`. Price sources are
  user-configurable, so a host allowlist is not viable there; the image proxy
  does use an allowlist (`isAllowedImageUrl`).
- **Caller-supplied arrays are capped** (`MAX_SET_NUMBERS`, `MAX_SOURCES`) and
  fanned out through `mapWithConcurrency`. Do not reintroduce a bare
  `Promise.all` over a request-body array.
- **Price history stores two columns per source:** `<id>Price` in the source's
  own currency and `<id>PriceHuf` normalised to HUF. Only the HUF column is
  comparable across sources, so the chart reads that one. If you add a writer,
  write both.
- **`marketPrices` is a mixed map.** It holds per-source `PriceQuote` objects
  alongside `exchangeRate` (number) and `error` (boolean). Narrow with
  `isPriceQuote` from `src/types.ts` rather than indexing and casting.
- **`getMockSets()` seeds Demo Mode from `localStorage.cachedSets`**, which also
  holds the signed-in user's real sets. `signOut` in `src/lib/firebase.ts`
  clears that key; keep it that way or the next person on the machine sees the
  previous user's collection pre-login.
- **Registry docs are world-readable** (`allow get: if true`) because the share
  link is the feature. `GiftRegistryDialog` therefore writes an explicit field
  whitelist, not `{...set}`. Never spread a whole `LegoSet` into a registry doc:
  it leaks `userId` and the owner's purchase prices.
- **Planned lists (`plannedLists/{token}`) are world-readable too**, and are
  how `GET /api/planned-sets/:token` gets data without an Admin SDK: the
  client (`usePlannedList`) writes a snapshot via `buildPlannedListSets` (an
  explicit whitelist, same rule as registries), and the server reads it
  unauthenticated over the Firestore REST API. Sync is driven only by local
  payload changes, never by the list doc's own snapshot, or two devices with
  different price sources would rewrite each other in a loop. Keep the hook's
  `ready` gate: syncing before sets load publishes an empty list.
- **Price sources live in `userSettings/{uid}`** (one doc, `priceSources`
  list), via `usePriceSources`. localStorage `legoPriceSources` is only a
  first-render cache and the one-time migration source. Rules validate the list
  as a container, so adding a source never needs a rules change; keep the
  15-entry cap in step with `MAX_SOURCES`.
- **Automatic refresh is desktop-only**, daily at 04:00 local. The scheduler
  in `App.tsx` is gated on `isDesktopApp` (`src/lib/platform.ts`, set by the
  Electron preload). The web app refreshes only when asked, so it does not
  spend Gemini quota per open tab.
- **The desktop app (`desktop/`) is its own npm package**, so Electron and
  Playwright never reach the Vercel install. It reuses `registerApiRoutes`,
  passing `{ scraper }` to swap Gemini for Playwright in the price routes; do
  not fork the routes. Scraper launch settings (bundled Chromium, headed
  off-screen, `locale: 'en-US'`) each fix a real block; see
  `desktop/README.md` before changing them. Recipes are declarative data
  (`lib/scrapeRecipe.ts`), never code; `/api/teach-source` has Gemini write
  one and test-runs it, and it 404s on the web (no browser there).
- **Desktop secrets** (`desktop/.env` with `GEMINI_API_KEY`,
  `desktop/oauth-client.json`) are gitignored and must never be committed or
  packaged. A packaged app reads them from `%APPDATA%\Brick Tracker`.
- **Never use 7-Zip.** It is blocked on the build machine. That rules out
  electron-builder's NSIS/7z/portable targets and Squirrel; packaging is
  `@electron/packager` + `Compress-Archive` + `install.cmd` (`npm run dist`).
- On desktop the set-details, image and minifigure routes retry failed
  scrapes through the browser (`fetchPageHtml`) and never call Gemini. Keep
  the parsers HTML-in (`parseBricksetSetPage`, `parseLegoProductPage`, ...)
  so both fetch paths share them.
- **BrickLink price = cheapest New lot that is sealed or complete.** It reads
  per-lot listings (`catalogifs.ajax`), not the price guide's aggregate Min,
  and also drops lots whose description admits missing parts or minifigures
  (`isIncompleteLotDescription`), because sellers mislabel partial sets as
  Complete.
- **Firebase config and rules deployment live in their own Firebase store**,
  not in this repo. The absence of `firebase.json` / `.firebaserc` here is
  deliberate, so do not add one or try to wire up `firebase deploy`. The
  in-repo `firestore.rules` is the readable source of record; edits to it have
  to be synced to the Firebase store to take effect. There are no rules tests
  yet; `security_spec.md` documents the intended invariants.
- **Client Firebase config** resolves from `VITE_FIREBASE_*` env vars, falling
  back to a gitignored `firebase-applet-config.json` (see
  `firebase-applet-config.example.json` for the shape).

## Conventions

- `tsconfig.json` runs `strict` plus `noUnusedLocals` / `noUnusedParameters`.
  Unused imports are build errors, not warnings.
- Route all price formatting through `src/lib/currency.ts` and all
  "cheapest prices" logic through `src/lib/prices.ts`. Both exist because the
  logic was previously duplicated across components and had already drifted
  (two different locales for the same amount).
- `SetCard` is wrapped in `React.memo`. Callbacks passed to it must be stable:
  the `useSets` CRUD functions are `useCallback`'d and `onDelete` is hoisted.
  An inline arrow prop silently defeats the memo.
- Use the `Modal` component (`src/components/Modal.tsx`) for dialogs. It
  supplies `role="dialog"`, focus trap, focus restore, and Escape handling.
- Surface errors in the UI rather than `alert()`. `useSets` exposes an `error`
  field; component-level failures set local error state.
