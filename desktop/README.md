# Brick Tracker desktop app

An Electron shell around the same web app. It behaves the same as the
website except for two things:

- **Prices are read with a local browser (Playwright), not Gemini.** No AI
  tokens are spent on refreshes.
- **Prices refresh automatically every day at 04:00.** If the PC is off or
  asleep then, the refresh runs the next time the app starts. The web app no
  longer refreshes on its own.

The app starts with Windows (packaged builds only), lives in the tray, and
keeps running when its window is closed. Use the tray menu to quit.

## Setup

1. Build the web app from the repo root: `npm run build:desktop`. A desktop
   build carries **no Firebase project**; the app gets one from its setup.
2. `cd desktop && npm install`. Playwright 1.64.1 is pinned exactly; it uses
   the Chromium build Playwright installs (`npx playwright install chromium`).
3. `npm start` builds `desktop/dist/` and launches the app. The first start
   opens the setup window (`src/setup.ts`), which asks for:
   - where the sets are kept: **On this PC only** (the first-run default, no
     Firebase at all) or **Firebase + a copy on this PC**. Gift registries and
     the public Planned Sets link need Firebase; on this PC only the planned
     list is served to programs on this PC at `http://localhost:47321/...`;
   - for Firebase only: the Firebase web config (the console's
     `firebaseConfig` snippet, or the JSON of `firebase-applet-config.json`)
     and the database ID;
   - the website's address, for gift-registry and Planned Sets links (the app
     itself is on localhost, which nobody else can open); optional on this PC
     only;
   - "Let my phone and website reach this PC's copy (Google Drive)": saved
     only, until the Drive mailbox arrives (local-storage plan, Phase 5);
   - the Google OAuth client for the desktop app: the JSON downloaded from
     Google Cloud console, Credentials, OAuth client of type "Desktop app", in
     the Firebase project;
   - optionally a Gemini key, for teaching sources. It is shared with your
     other apps (the `shop-teacher` package keeps it in Windows Credential
     Manager), so if BrickBudget already has one there is nothing to enter.
     A `GEMINI_API_KEY` in `desktop/.env` also works and is moved to the
     shared store at the next start.

   Dev runs save these in `desktop/app-config.json` and
   `desktop/oauth-client.json` (both gitignored). The tray's **Settings...**
   (and the Settings buttons in the app) reopen the window; saving restarts
   the app. Switching from Firebase to this PC only stops syncing and leaves
   Firestore as it is; switching back asks before the sets on this PC are
   uploaded to the project.

`npm start` works from VS Code terminals too: VS Code exports
`ELECTRON_RUN_AS_NODE=1`, which `run.mjs` removes before starting Electron.

A dev run beside the installed app (for a test on a fresh profile): set
`BRICK_TRACKER_USER_DATA` to an empty folder (it is used instead of
`%APPDATA%\Brick Tracker`, settings included) and `BRICK_TRACKER_PORT` to a
free port. Both are ignored by the packaged app.

## How it fits together

- `src/main.ts` serves `../dist` and the shared `registerApiRoutes` on
  `http://localhost:47321`, bound to loopback only. The port is fixed because
  the page origin keys the Firebase session; a random port would sign you out
  on every launch.
- `registerApiRoutes(app, { scraper })` is the same function the web server
  and Vercel use. Supplying a scraper switches the price routes from Gemini to
  Playwright; nothing else differs.
- `src/preload.ts` exposes `window.legoTrackerDesktop`, which
  `src/lib/platform.ts` uses to detect the desktop build. It also carries the
  saved setup (`lib/appConfig.ts`), read synchronously so
  `src/lib/firebaseConfig.ts` can start Firebase on the user's own project as
  the page loads.
- Sign-in (`src/oauth.ts`): Google blocks sign-in pages inside Electron, so
  the app opens Google in your normal browser and receives the result on a
  one-off loopback port (PKCE). With Firebase, the Google ID token is
  exchanged for a Firebase session with `signInWithCredential`; on this PC
  only, the token just says which Google account's copy to open.

## Scraping

`src/scraper/engine.ts` reads shop pages one at a time with person-paced
pauses. Each setting below came from live trials and is load-bearing:

| Setting | Why |
| --- | --- |
| Playwright's bundled Chromium | Amazon served its 503 page to every launch of the installed Chrome on the dev machine |
| Headed, window parked off-screen | Cloudflare (Arukereso) never clears in headless mode; nothing is visible on screen |
| `locale: 'en-US'` | Amazon.de blocks or blanks the page for a Hungarian or German browser |
| `viewport: null`, no `--enable-automation` | Avoids the usual automation tells (as in the budget-tracker app) |
| Persistent profile | Consent and Cloudflare clearance survive between runs |

What to read on each page is described by a **recipe** (`lib/scrapeRecipe.ts`,
from the shared `shop-teacher` package): CSS selectors plus number format,
never code. The built-in ones for Amazon.de
and Arukereso are in `lib/builtinRecipes.ts`; a taught recipe on a source
takes precedence over a built-in one.

## Teaching a new source

In the desktop app, open Price Sources, add the shop with its search URL
(`{setNumber}` where the set number goes) and press **Teach**:

1. The local browser opens that search page for up to three of your planned
   sets and keeps a compact HTML excerpt of each.
2. Gemini (the key shared with your other apps) writes a recipe from the
   excerpts (`lib/teachSource.ts`, from the `shop-teacher` package).
3. The recipe is run on the same live pages. If it finds nothing, Gemini gets
   one retry with what the test saw.
4. The prices found are shown; **Save** stores the recipe on the source in
   Firestore (`userSettings`), so every device has it.

Changing a source's URL to another host drops its recipe. Teaching takes one
to two minutes and a couple of Gemini calls; daily refreshes use none.

The Gemini key is read by the main process only (from Windows Credential
Manager, see Setup); the page never sees it, and no build contains it.

Matching rules (`rankCards`):

- the title must contain the set number where shops put a set's own code (at
  the end or in the first four words), plus "LEGO";
- accessories (light kits, display cases, "compatible with") are excluded;
- if the set's own listing shows no price (Amazon "See options", sold only by
  third parties including used), the result is **no price**, never the next
  product down the list.

Try a recipe outside Electron:

```bash
npx tsx desktop/scripts/try-scrape.ts <profileDir> amazon 31393 11383
```

Set `SCRAPER_DEBUG=1` to print the cards the engine read.

## Refreshing for the website

While the desktop app runs (signed in, even just in the tray), it is also the
website's scraper. It writes a heartbeat to Firestore every 2 minutes; when
you press "Update all" or a card's refresh on the website, the website hands
the job to the desktop app instead of asking Gemini, and the desktop runs it
with its normal refresh. The results reach the website through the live set
updates, from any device, including your phone.

The website uses Gemini as before when the desktop app has not been seen for
5 minutes, does not pick the request up within 45 seconds, or reports a
failure. Requests are claimed and cancelled in Firestore transactions, so a
request is never run by both.

The desktop app can run on more than one Windows machine signed in to the
same Google account. Every one of them sees each request, but only the first
to claim it runs it; the 4AM refresh is a request with a fixed id per day, so
it also runs once, on whichever machine claims it. Logic: `src/hooks/useDesktopWorker.ts` and
`src/lib/desktopWorker.ts`; rules: `desktopStatus` and `refreshRequests` in
`firestore.rules`.

## Set details without AI

Looking up a set on desktop reads LEGO.com in the local browser first: the
hu-hu page gives the official HUF price and the product image, the en-us page
LEGO's English name. Brickset fills only the gaps, and covers sets LEGO.com
does not list (leaked, unannounced, retired; LEGO's not-found page is
recognised and ignored, as is Brickset's "{?}" placeholder title). Images and
minifigures retry failed requests through the browser the same way. None of
this asks Gemini. Try it with
`npx tsx desktop/scripts/try-details.ts <profileDir> 11390`.

## Packaging

```bash
cd desktop
npm run dist
```

This builds the desktop bundle and the web app (`build:desktop`, so without
a Firebase project), stages Playwright's Chromium
(copied from the local Playwright cache, or downloaded), and builds an NSIS
installer with electron-builder into `release/<version>-<date>/`:

- `Brick-Tracker-Setup.exe`: the installer (about 240 MB);
- `win-unpacked/`: the app it installs, with Chromium in
  `resources/ms-playwright` and the web app in `resources/web`.

The installer is one click and per user (no admin rights). It installs to
`%LOCALAPPDATA%\Programs\Brick Tracker`, adds a Start menu shortcut and an
entry in Windows' list of apps, and starts the app. A fresh install also adds
the start-with-Windows entry (`installer/installer.nsh`); the tray menu's
"Start with Windows" toggle turns it off or on again, and an upgrade leaves
that choice alone. To update, run the newer `Brick-Tracker-Setup.exe`: it
offers to close the running app and replaces it in place. Uninstalling keeps
`%APPDATA%\Brick Tracker`.

**7-Zip.** electron-builder compresses the installer with 7-Zip, and only
the installed 7-Zip **26.03 or newer** passes this machine's security check.
`package.mjs` therefore finds `C:\Program Files\7-Zip\7z.exe` (or
`SEVENZIP_PATH`), refuses anything older than 26.03, and passes it as
`ELECTRON_BUILDER_7ZIP_PATH`, so electron-builder never downloads its own.
The newer NSIS and rcedit toolsets (`toolsets` in `package.mjs`) are
`.tar.gz`/`.zip`, so no 7z-packed download is involved, and
`electron-winstaller` (Squirrel, which vendors 7-Zip 16.04) is replaced by an
empty stub: `package.json` lists `stubs/electron-winstaller` as a
devDependency and `overrides` points at it with `"$electron-winstaller"`. Compression is level 7
(`ELECTRON_BUILDER_COMPRESSION_LEVEL`): the default 9 runs out of memory with
one 64 MB dictionary per core.

Builds made before the installer (a zip with `install.cmd`) installed to the
same folder and wrote the same start-with-Windows entry, so the setup simply
replaces them.

**The installer is not tied to anybody's project, and secrets are never
packaged.** `package.mjs` fails the build if the web build contains a
Firebase API key or the builder's project, or if a secret file or key value
appears in `app.asar`. So one installer can be given to anybody: each install
runs the setup window on first start and keeps the result in its data folder:

```
%APPDATA%\Brick Tracker\app-config.json     (Firebase project, website address)
%APPDATA%\Brick Tracker\oauth-client.json   (sign-in)
%APPDATA%\Brick Tracker\.env                (optional: GEMINI_API_KEY, moved to the shared store at start)
```

Moving to another PC: install there and run the setup again, or copy those
files into the same folder first.

The Gemini key itself is in Windows Credential Manager (service
`shop-teacher`), shared with BrickBudget and BLOK.AI.

The exe is not code-signed, so Windows SmartScreen may warn on first start.

## Not done yet

- Auto-update (run a newer `Brick-Tracker-Setup.exe` for now).
