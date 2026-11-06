# Security Specification for Lego Brick Tracker

## Data Invariants
1. A Lego set document must have a `userId` that matches the authenticated user.
2. A price history entry must belong to a set owned by the user.
3. Status must be either 'planned' or 'ordered'.
4. Priority must be 'low', 'medium', or 'high'.
5. Once a set is marked as 'ordered', its `orderedDate` and `orderedPriceHuf` should be set and immutable if possible (or at least strictly validated).

6. A planned list (`plannedLists/{token}`) is publicly readable by id only. Only its owner may list, create, update or delete it, `userId` and `createdAt` are pinned on update, and only the keys `userId`, `title`, `sets`, `createdAt` and `updatedAt` are allowed. Per-set contents are a client-side whitelist that never includes `userId`. Purchases (sets marked as ordered: day, price paid, quantity, official price) are published deliberately in a separate `purchases` list for BrickBudget, also as an explicit whitelist (`buildPlannedListPurchases`), so anyone holding the link can see what the owner paid.

7. User settings (`userSettings/{uid}`) are readable and writable only by that user. Only `priceSources` (a list of at most 15) and `updatedAt` are allowed.

8. `desktopStatus/{uid}` (the desktop app's heartbeat) is readable and writable only by that user, with only `lastSeenAt` and an optional `appVersion`.
9. `refreshRequests/{id}` (refreshes the website hands to the desktop app) are readable, listable, writable and deletable only by their owner. They are created as `pending` only, `userId` is pinned on update, and the shape (`kind`, at most 500 `setIds`, `status`, timestamps, a short `error`) is validated. They carry set ids only, never set data.

10. When `access/allowlist` exists, only signed-in accounts with a verified email in its `emails` list (lower case) pass `isSignedIn()`, and so every owner-only rule; any other Google account can still authenticate but reads and writes nothing. Without the doc, any account may use the app for its own data. No client can read or write `access/*` (default deny); it is edited in the Firebase console only. The public reads (registries, reservations, planned lists) do not depend on it.

## Local Store (desktop)

11. The desktop keeps each Google account's data in its own folder, `%APPDATA%\Brick Tracker\data\<google sub>\` (`desktop/src/store/`). Only the main process reads and writes it; the page reaches it over IPC, and every handler checks that the sender frame is the app's own origin, as the setup window's handlers do. `userId` is never stored there: the Firestore pusher writes the signed-in uid.
12. Local data is never served over HTTP. The desktop's server listens on 127.0.0.1 only, and the one route answering from local data is `GET /api/planned-sets/:token`: read-only, by the list's random token, with the same whitelisted payload as the public snapshot (no `userId`).
13. The copy is a backup, so nothing from outside may empty it silently: remote removals are applied only from server snapshots (`fromCache === false`); a snapshot removing more than max(3, 10%) of the synced sets, or coming from another project or uid, is held until the user decides; an empty store is never written over a non-empty one; 7 daily backups are kept.
14. The desktop's Google Drive refresh token is kept only in `google-session.bin`, encrypted with Electron `safeStorage` (Windows DPAPI, this Windows user). Drive access tokens never leave the main process. Signing out forgets the token without revoking it, because Google's consent is per project: a revoke would also cut the website's access. `package.mjs` refuses a package containing that file.

## Google Drive Mailbox

15. The Drive folder is the account's `appDataFolder`: only OAuth clients of this Google Cloud project, signed in as that account with `drive.appdata`, can see it, and that scope reaches nothing else in the user's Drive.
16. Single writer: only the desktop writes `snapshot.json.gz`, `status.json`, `history-*.json.gz` and `reply-*.json`. Websites only create `ops-<ts>-<batchId>.json`. A website never reads another source of truth than the desktop's snapshot plus its own pending batches.
17. "On this PC only" there are no Firestore rules behind the data, so the desktop is the authority. Every batch is validated before it is applied (`validateOpBatch` in `lib/data/ops.ts`), mirroring the rules: a batch id of 8 to 64 safe characters, 1 to 200 ops and at most 512 KB; creates need an auto-id, a valid `setNumber` (`SET_NUMBER_RE`), a known status and priority and a name of at most 200 characters, under 200 KB; updates may touch only `SET_UPDATABLE_FIELDS` (never `updatedAt`, `userId` or `createdAt`); history rows need an auto-id, a date, numeric prices in both columns and at most 64 keys; price sources are a list of at most 15; refresh ops name 1 to 500 sets. `userId` is dropped from creates. Refused ops are reported back per op and never applied; the rest of the batch still applies.
18. Batches are idempotent: the snapshot names the batches applied, an ops file is deleted only after the snapshot naming it is published, and a batch id already applied is never applied again.
19. With Firebase, ops applied from Drive become ordinary local edits and are pushed to Firestore, where the rules check them again.

## Website Session (without Firebase)

20. The website's Google sign-in is a server-held session (`lib/session.ts`, routes in `lib/server-api.ts`). The page receives a one-time code from the Google Identity Services popup; the server exchanges it (`redirect_uri: 'postmessage'`), checks the ID token (issuer, `aud` equal to the client id, `exp` with 5 minutes of skew, a numeric `sub`, `email_verified`) and requires the `drive.appdata` grant and a refresh token.
21. The refresh token never reaches the page. It is sealed with AES-256-GCM (random 12-byte IV, 16-byte tag) under a key derived by HKDF-SHA256 from `SESSION_SECRET` (at least 32 characters, server-only), with a key id in the sealed value, so a cookie from another secret reads as signed out. The cookie is `__Host-bt_session`: `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain`, 180 days. The page only ever gets short-lived Drive access tokens from `POST /api/session/token`.
22. CSRF: every session route requires `X-Requested-With: brick-tracker`, and anything but GET also the site's own `Origin`; they send no CORS headers, answer with `Cache-Control: no-store` and are rate-limited (30 a minute). `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` are never `VITE_*` variables, so no build contains them. Sign-out clears the cookie without revoking the grant (see 14); a refused refresh (`invalid_grant`) clears it too.
23. The desktop build never carries a Google client id (`googleClientId` is null in a `--mode desktop` build) and the desktop's server registers no session routes (`webSession: false`).

## The "Dirty Dozen" Payloads (Rejected Cases)
1. Creating a set for another user (`userId` mismatch).
2. Updating a set's `userId` to steal it.
3. Injecting a massive string into `setNumber`.
4. Setting an invalid status like `stolen`.
5. Creating a price history entry for a set not owned by the user.
6. Updating `createdAt` timestamp after creation.
7. Deleting another user's set.
8. Listing all sets without a `userId` filter.
9. Writing a set with a 1MB string in `name`.
10. Spoofing `orderedDate` as a future date from the client (should use server timestamp or be after createdAt).
11. Setting priority to an invalid value.
12. Attempting to bypass rules by not providing `userId`.
13. With an allowlist in place, an account not on it (or with an unverified email) reading or writing its own sets, settings or requests.
14. Any client reading or writing `access/allowlist`, including an account on the list.
15. A Drive ops batch changing a set's `userId`, `createdAt` or `updatedAt`, or carrying an unknown status, an over-long name, more than 200 ops or more than 512 KB (refused per op, or whole).
16. A Drive ops batch replayed after it was applied (ignored by its batch id).
17. A cross-site page calling `/api/session/*` with the visitor's cookie (no `X-Requested-With`, or a foreign `Origin`: 403).
18. A session cookie sealed under another `SESSION_SECRET`, or tampered with (fails the GCM tag: signed out).

## Tests
(To be implemented in `firestore.rules.test.ts` if needed, but here I'll focus on the rules first).
