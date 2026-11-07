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
npm run format     # prettier --write .  (format:check is the CI variant)
```

CI (`.github/workflows/ci.yml`) gates typecheck, lint, format:check, test and
build, plus `npm --prefix desktop ci` and the desktop typecheck (no Electron
or Playwright binaries; tsc comes from the root install). Run
`npm run format` before committing. Prettier covers `desktop/`
too; `docs/`, `scripts/` and `*.md` are ignored (`.prettierignore`).
`endOfLine` is `auto` because Windows checkouts here are CRLF (`core.autocrlf`)
and CI's are LF; do not change it to `lf`. The one-time format pass is listed
in `.git-blame-ignore-revs` (GitHub applies it; locally run
`git config blame.ignoreRevsFile .git-blame-ignore-revs`).

## Architecture

**Two entry points, one route module.** `lib/server-api.ts` exports
`registerApiRoutes(app)`, called by both `server.ts` (local dev, adds Vite
middleware) and `api/index.ts` (Vercel serverless). Add routes only in
`lib/server-api.ts` or the two environments drift apart. Both import with an
explicit `.js` extension, which Vercel's ESM resolution requires.

**No backend database access.** There is no Firebase Admin SDK. The Express
layer never touches Firestore and never verifies an ID token for data
access, so *all* Firestore authorisation lives in `firestore.rules`. Treat
that file as security-critical. (The session routes read the ID token Google
returns from its own token endpoint, only to name the account; see below.)

**Client data goes through `src/data/`.** `useSets` and `usePriceSources` talk
to a `DataBackend` (`createFirestoreBackend(uid)` on the website,
`createLocalBackend` on the desktop, memoised in `App`), and the signed-in
user comes from a `SessionProvider` (`firebaseSession`, `desktopSession`)
through `useSession` as an `AuthUser`, never Firebase's
`User`. `useSession`'s user is `undefined` until the session is restored, then
the user or `null`; `useSets` stays `loading` until then, which
`usePlannedList`'s ready gate depends on. Registries, the planned list and the
desktop hand-off still use Firestore directly through `getDb()`. Firebase
starts lazily (`getDb()` / `getFirebaseAuth()` in `src/lib/firebase.ts`), so
importing a module never throws when no project is configured. This is the
seam the local-storage plan builds on.

**The desktop app is local-first** (local-storage plan, Phases 2-3): it reads
and writes its copy in `<userData>/data/<googleSub>/` through `LocalBackend`
and the `store` IPC bridge (`lib/data/storeBridge.ts`, `desktop/src/store/`),
and `src/data/firestoreSync.ts` keeps that copy and Firestore in step (pull
live, push `planPush` with a few writes in flight, `ackPush` back). The
website uses `FirestoreBackend` or `DriveBackend` (see "The website reads
the desktop's copy" below). The reducer
`lib/data/store.ts` holds the rules: field-level dirty tracking (an unsynced
local edit wins per field), deletes win both ways, creates use Firestore-style
ids and wait for a server snapshot, history waits for its set, `userId` is
never stored (the pusher writes the uid); removals only from server-confirmed
snapshots, and a snapshot that would remove more than max(3, 10%) of the
synced sets, empty the copy, or come from another project, database or
account is held (asked about in StorageStatus) with nothing pushed meanwhile.
A cached snapshot never makes or lifts a hold, except that a new source's
cached one holds as unconfirmed: "start again" from a source waits until its
server has answered (a mistyped database never does). `LocalStore`
never writes a copy that shows no sets over one that does unless the user
emptied it (deleted the last sets, in the app or by a Drive batch, or
answered "delete"; deletes awaiting Firestore's confirmation count as gone),
keeps 7 daily backups, and
checks local changes against the rules' shapes (a create needs `name`).
`LocalBackend` holds the set list back until the copy is real, which
`usePlannedList`'s ready gate relies on. Firebase problems are classified in
`src/lib/dataHealth.ts` (offline is a pill, the rest a `DataStatusBanner`);
on the desktop an allowlist refusal is a health state, not a sign-out.
Firestore 12 reports a missing database only as a logged warning and then
looks offline, so `src/lib/firestoreLog.ts` (`onLog`) turns it into that
health state, and into a `useSets` error on the website. With the SDK's
memory cache a plain `getDocs` answers from the (empty) cache when it thinks
it is offline, so what the sync copies (history, backups) is read with
`getDocsFromServer`. Local
data is never served over HTTP, the IPC answers only the app's own page, and
nothing the page sends becomes a path (`isGoogleSub`, `isValidDocId`). The
one exception is read-only: `GET /api/planned-sets/:token` asks
`ApiOptions.localPlannedList` (the copy's own list, or the Firestore list by
its backed-up token) before Firestore.
`SET_UPDATABLE_FIELDS` (`lib/data/setFields.ts`) must match the sets update
rule; its test reads `firestore.rules`.

**The desktop has two storage modes** (Phase 4, `storage.mode` in
`app-config.json`): "On this PC only" (`local`) and "Firebase + a copy on
this PC" (`both`, also what a config without the choice means). `firebase`
is null without a project and `publicAppUrl` optional on this PC only;
`usesFirebase()` / `desktopMode` decide, so `firebaseConfig` is null in
local mode even with a project kept for switching back, and `main.ts` sets
`VITE_FIREBASE_*` only when it is used. 'both' without a project runs local
with the `not-configured` banner. Local mode: `desktopSession` signs in with
the same system-browser Google flow but no Firebase (the ID token's `sub` is
uid and folder); `createLocalBackend(..., { localOnly: true })` treats the
copy as the whole truth (capabilities off for registries, the public list
and refresh requests); `usePlannedList` keeps the list's token in the copy
and the desktop serves it on its own address; the 4AM run happens locally;
nothing touches Firestore (`firebaseUser` is null). Switching to `both`
asks before uploading: a copy with sets that was never in the signed-in
source (kept on this PC only, or from another project) is held, and
`uploadHeld` ("Upload N sets") makes every set unconfirmed so `planPush`
creates it, history after its set in `writeBatch` chunks. Dev runs can use
`BRICK_TRACKER_USER_DATA` / `BRICK_TRACKER_PORT` for a separate profile
beside the installed app (ignored when packaged).

**The Google Drive mailbox** (Phase 5, `storage.drive`): the phone and
website reach this PC's copy through the account's Drive app-data folder
(`drive.appdata`, one Cloud project holds the Desktop and Web clients and
they share the folder). Layout and single-writer rule in
`lib/drive/layout.ts`: only the desktop writes `snapshot.json.gz`,
`status.json`, `history-*.json.gz` and `reply-*.json`; websites only create
`ops-<ts>-<batchId>.json`. `desktop/src/drive/` (main process only):
`publisher.ts` publishes (snapshot at most every 10 s, heartbeat 2 min,
history files one at a time when changed; pauses while another PC's
heartbeat is fresh; republishes a wiped folder), `inbox.ts` polls every 15 s
and applies each batch through `validateOpBatch` / `applyOps`
(`lib/data/ops.ts`, the rules' shapes and caps, refusals reported per op in
the snapshot), names it in the snapshot, then deletes the file (idempotent
by `batchId`, kept in `<sub>/drive.json`). Refresh ops reach the page as a
`useDesktopWorker` channel sharing one run queue with the Firestore
requests; replies go back as files. The desktop's Google session
(`googleSession.ts`) exists only with Drive on: sign-in then asks for
offline access, the refresh token is kept with `safeStorage` in
`google-session.bin` (excluded from packaging and leak-checked), Drive
access tokens never leave main, and the page gets only ID tokens (it signs
in to Firebase from one when Firebase has no session). Signing out forgets
the token and **never revokes it**: Google ties consent to the project, so a
revoke would cut every client's access (the website's, other PCs').

**The website reads the desktop's copy through Drive** (Phase 6), with or
without Firebase. Its Google sign-in is a server-held session
(`lib/session.ts`, `registerSessionRoutes` in `lib/server-api.ts`): the GIS
code popup (`src/data/googleWebSession.ts`), the code exchanged by the server
(`redirect_uri: 'postmessage'`), the refresh token sealed (AES-256-GCM, HKDF
from `SESSION_SECRET`) in the `__Host-bt_session` cookie; the page only gets
short-lived access tokens from `/api/session/token`. 403 `drive-scope` when
Drive was not ticked, 409 `needs-consent` without a refresh token (the next
click asks with `prompt=consent`; a second popup without a click would be
blocked). `src/data/driveBackend.ts` polls while visible, overlays its own
pending batches on the snapshot (`driveOverlay.ts`, pure), keeps an outbox in
localStorage (`bt.drive.outbox.<sub>`), flushes 1 s after the last change or
when hidden, loads history lazily and reports refusals once per batch; it
never seeds price sources. `chooseDataSource` (`src/lib/dataSource.ts`)
picks `firestore`, `drive` or `local` from what is configured, the
per-device preference (`brickTrackerDataSource`: auto, firebase, desktop) and
Firestore's health: in Auto a classified Firestore failure switches to Drive
when a Drive session exists, else the banner's "Use my desktop's copy" is
the sign-in click; `probeFirestore` every 5 min offers "Switch back".

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
  holds the signed-in user's real sets. `firebaseSession.signOut`
  (`src/data/firebaseSession.ts`) and `googleWebSession.signOut` (which also
  drops the Drive outbox and snapshot caches through `onWebSignOut`) clear
  that key; keep it that way or the next person on the machine sees the
  previous user's collection pre-login.
- **`addedAt` is when a set joined the collection.** Written on create only
  (a create-only field, like `createdAt`, so no rules change); sort by
  `addedAt ?? createdAt` (`src/lib/sortSets.ts`). It exists because the
  rules pin `createdAt` to `request.time`, so a set uploaded from a local copy
  would otherwise lose its date added. Keep it on every create path
  (`FirestoreBackend.addSet`, the store reducer, Drive ops).
- **Website session settings:** `VITE_GOOGLE_CLIENT_ID` (one setting, read
  by the page and the server), and server-only `GOOGLE_CLIENT_SECRET` and
  `SESSION_SECRET` (32+ characters; changing it signs everyone out). Never
  give the last two a `VITE_` prefix. Each also has other accepted names
  (`ENV_NAMES` in `lib/envSettings.ts`, first set wins; the user's Vercel
  uses `NEW_GOOGLE_CLIENT_CONFIG`, `GOOGLE_CLIENT_CONFIG` and
  `SESSION_CONFIG_2`). Vite's `envPrefix` is `CLIENT_ENV_PREFIXES`, so
  anything starting `NEW_GOOGLE_CLIENT_CONFIG` reaches the page too; never
  give a secret such a name. `sessionConfig` wants all three or
  treats the session as not set up (503). The session routes keep
  `X-Requested-With: brick-tracker` plus own-`Origin` checks, no CORS
  headers and `no-store`; do not loosen them. The desktop passes
  `webSession: false`, and `googleClientId` is null in a desktop build.
- **Sign-in can be limited to listed accounts.** `isSignedIn()` in
  `firestore.rules` also requires `isAllowedUser()`: when the
  `access/allowlist` doc exists (console-only, `emails` in lower case), other
  Google accounts authenticate but reach no data. Every owner-only rule must
  keep going through `isSignedIn()`/`isOwner()`, never `request.auth` alone.
  `firebaseSession.hasAccess` (`src/data/firebaseSession.ts`) probes the user's own `userSettings`
  doc so the app can sign a refused account out with a message.
- **Registry docs are world-readable** (`allow get: if true`) because the share
  link is the feature. `GiftRegistryDialog` therefore writes an explicit field
  whitelist, not `{...set}`. Never spread a whole `LegoSet` into a registry doc:
  it leaks `userId` and the owner's purchase prices.
- **Planned lists (`plannedLists/{token}`) are world-readable too**, and are
  how `GET /api/planned-sets/:token` gets data without an Admin SDK: the
  client (`usePlannedList`) writes a snapshot via `buildPlannedListSets` (an
  explicit whitelist, same rule as registries), plus the purchases via
  `buildPlannedListPurchases` in a separate write (for BrickBudget to book as
  expenses; what was paid is deliberately public to the link holder), and the
  server reads it
  unauthenticated over the Firestore REST API. Sync is driven only by local
  payload changes, never by the list doc's own snapshot, or two devices with
  different price sources would rewrite each other in a loop. Keep the hook's
  `ready` gate: syncing before sets load publishes an empty list.
- **Price sources live in `userSettings/{uid}`** (one doc, `priceSources`
  list), via `usePriceSources`. localStorage `legoPriceSources` is only a
  first-render cache and the one-time migration source. Rules validate the list
  as a container, so adding a source never needs a rules change; keep the
  15-entry cap in step with `MAX_SOURCES`.
- **The desktop app is the website's scraper when it runs.** The desktop
  writes a heartbeat (`desktopStatus/{uid}`); the website hands "Update all"
  and card refreshes to it as `refreshRequests` docs, and the desktop claims
  and runs them with the normal refresh (`useDesktopWorker`,
  `src/lib/desktopWorker.ts`). Claim and cancel are transactions, so only one
  side acts on a request. The website falls back to Gemini when the desktop
  is offline, does not claim within 45 s, or fails. Through Drive the
  request is a `refresh` op (`DriveBackend.delegateRefresh`): replies polled
  every 5 s, the ops file removed if the desktop has not started in 60 s,
  and the Gemini run's writes held (`hold()`) and sent as one batch. `handleBatchRefresh`
  takes explicit `targets`, so keep it free of filter assumptions. The 4AM
  run is the same kind of request with a fixed per-day id
  (`scheduleDailyRun` / `dailyRunAction`), so several desktops signed in to
  one account run it once, not once each.
- **The website is an installable app (PWA):** `public/manifest.webmanifest`,
  `public/sw.js`, icons in `public/icons/` (generated by
  `scripts/generate-pwa-icons.mjs` from `desktop/icon.mjs`, the same brick as
  the desktop icon). The service worker is network-first for pages, caches
  only hashed `/assets/` and icons, never touches `/api/` or other origins,
  and is registered on the production website only (`src/lib/pwa.ts`), not
  in dev or the desktop app.
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
- **Recipes, teaching and the Gemini key are shared code.** The recipe
  format, matching rules, teaching loop and in-page helpers live in the
  `shop-teacher` package (github.com/zgyorkei/shop-teacher), also used by
  BrickBudget; `lib/scrapeRecipe.ts` and `lib/teachSource.ts` only re-export
  them under this app's names. Change them there, tag a release and bump the
  dependency in both `package.json` files (root and `desktop/`).
- **The desktop app's Gemini key** is the one shared with the user's other
  apps: shop-teacher keeps it in Windows Credential Manager, and
  `desktop/src/main.ts` puts it in `GEMINI_API_KEY` at start. A key in
  `desktop/.env` is moved there once. The web deployment still reads
  `GEMINI_API_KEY` from the environment.
- **The desktop installer belongs to nobody's Firebase project.** The web
  app inside it is built with `npm run build:desktop` (`--mode desktop`),
  which leaves out `VITE_FIREBASE_*` and `firebase-applet-config.json`; the
  setup window (`desktop/src/setup.ts`; first start, tray "Settings..." and
  the app's Settings buttons through `settings:open`) saves the storage
  choice, the user's project and website address as `app-config.json`
  (`lib/appConfig.ts`), and the preload hands it to the page synchronously.
  A first run defaults to "On this PC only".
  `package.mjs` refuses a web build that contains a Firebase API key, the
  builder's project or a Google client id (`*.apps.googleusercontent.com`).
  Never bake a project, client or domain into the desktop build.
  Releases go to GitHub Releases as `Brick-Tracker-Setup.exe` (a fixed
  asset name, so the intro page's `releases/latest/download/...` link keeps
  working); upload that one file from `desktop/release`, never
  `win-unpacked/`, `builder-debug.yml` or a bundle with secrets.
- **Desktop secrets and setup** (`desktop/.env`, `desktop/oauth-client.json`,
  `desktop/app-config.json`, and `google-session.bin` in the data folder) are
  gitignored or outside the tree and must never be committed or
  packaged. A packaged app reads them from `%APPDATA%\Brick Tracker`.
- **7-Zip: only the installed 26.03 or newer.** Older and bundled copies
  fail the build machine's security check. `npm run dist` builds a per-user
  NSIS installer with electron-builder 26 (`desktop/scripts/package.mjs`),
  which finds `C:\Program Files\7-Zip\7z.exe`, refuses anything below 26.03,
  and passes it as `ELECTRON_BUILDER_7ZIP_PATH` so electron-builder never
  downloads its own. Keep the `toolsets` (NSIS/rcedit as `.tar.gz`/`.zip`,
  no 7z-packed downloads) and the `electron-winstaller` stub in
  `desktop/package.json` (Squirrel vendors 7-Zip 16.04): a devDependency
  `file:./stubs/electron-winstaller` plus the override `"$electron-winstaller"`.
  Do not put the `file:` path in `overrides` itself: npm resolves it against
  the dependent package's folder, the lock gets a broken entry, and
  `npm ci` (CI's desktop typecheck) refuses to install. Never
  run a `7za`/`7z` from `node_modules` or electron-builder's cache. The
  installer's start-with-Windows entry (`desktop/installer/installer.nsh`)
  must keep Electron's value name `electron.app.Brick Tracker` and
  `--hidden`, or the tray's toggle stops seeing it. Its `preInit` pins the
  install folder to `Programs\Brick Tracker`: a one-click per-user NSIS
  installer would otherwise use the package name (`lego-tracker-desktop`)
  and leave older copies beside the new one.
- On desktop the set-details route reads LEGO.com first in the browser
  (`scrapeLegoInfoViaBrowser`: official HUF price, image, en-us name), with
  Brickset for gaps; image and minifigure routes retry failed requests through
  the browser (`fetchPageHtml`). None of them call Gemini. Keep the parsers
  HTML-in (`parseBricksetSetPage`, `parseLegoProductPage`, ...) so both fetch
  paths share them. `parseLegoProductPage().isProduct` guards against LEGO's
  not-found page, and Brickset's "{?}" title (or a bare "633412-1") means
  "no name yet".
- **Shop listings can name and picture a set** that LEGO.com and Brickset
  do not know (promotional items such as 633412). Desktop price quotes carry
  the listing's `title` and `image`; `identityFromQuotes`
  (`src/lib/setIdentity.ts`) fills only a placeholder name
  (`isPlaceholderName`) or a missing image, and `mergeLookupName` stops a
  details lookup from replacing a real name with a placeholder. Never let
  either overwrite a real name or image.
- **BrickLink price = cheapest New lot that is sealed or complete.** It reads
  per-lot listings (`catalogifs.ajax`), not the price guide's aggregate Min,
  and also drops lots whose description admits missing parts or minifigures
  (`isIncompleteLotDescription`), because sellers mislabel partial sets as
  Complete.
- **Links handed to other people go through `publicAppUrl`**
  (`src/lib/appUrl.ts`): registry links and the Planned Sets API URL. The
  desktop app (localhost) uses the website address from its setup; the
  website uses `VITE_PUBLIC_APP_URL`, else its own origin, so self-hosted
  copies link to themselves. Never hard-code a domain again. "On this PC
  only" has no public links: the planned list uses
  `localPlannedListApiUrl` (this PC's own address, said as such).
- **Demo Mode is curated data** (`src/demoData.ts`): Brickset image URLs
  (LEGO's old image CDN is gone), dates relative to today, generated price
  history (`demoPriceHistory`), and the built-in `/registry/demo`
  (`RegistryView` never touches Firestore for it). It must never show anybody's
  real data.
- **The intro and setup guide is GitHub Pages from `docs/`** (`index.html`,
  `shots/`, `.nojekyll`). Screenshots come from Demo Mode via
  `node scripts/capture-docs-shots.cjs` against `npm run dev`; re-run it after
  visible UI changes, and keep the setup guide in step with `.env.example`,
  `firestore.rules` and the desktop build.
- **Firebase config and rules deployment live in their own Firebase store**,
  not in this repo. The absence of `firebase.json` / `.firebaserc` here is
  deliberate, so do not add one or try to wire up `firebase deploy`. The
  in-repo `firestore.rules` is the readable source of record; edits to it have
  to be synced to the Firebase store to take effect. There are no rules tests
  yet; `security_spec.md` documents the intended invariants.
- **Client Firebase config** resolves in `src/lib/firebaseConfig.ts`: the
  desktop setup on desktop, else `VITE_FIREBASE_*` env vars, else a gitignored
  `firebase-applet-config.json` (see `firebase-applet-config.example.json`
  for the shape). A website without Firebase is valid when it has
  `VITE_GOOGLE_CLIENT_ID` (it then reads the desktop's copy through Drive);
  with neither, `main.tsx` shows a "not set up" screen, and a website build
  stops (`checkFirebaseConfig` in `vite.config.ts`); CI opts out with
  `ALLOW_MISSING_FIREBASE_CONFIG=1`, real deployments must not. Registries
  need Firebase: without it `/registry/:id` says why (`/registry/demo`
  still works).

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
  supplies `role="dialog"`, focus trap, focus restore, and Escape handling,
  and portals to `<body>`: rendered inside a transformed ancestor (SetCard is
  a motion `layout` element) a fixed overlay is positioned relative to that
  ancestor instead of the screen.
- Surface errors in the UI rather than `alert()`. `useSets` exposes an `error`
  field; component-level failures set local error state.
