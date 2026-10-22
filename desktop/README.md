# Brick Tracker desktop app

An Electron shell around the same web app. It behaves the same as
https://lego.gykovacszoltan.hu except for two things:

- **Prices are read with a local browser (Playwright), not Gemini.** No AI
  tokens are spent on refreshes.
- **Prices refresh automatically every day at 04:00.** If the PC is off or
  asleep then, the refresh runs the next time the app starts. The web app no
  longer refreshes on its own.

The app starts with Windows (packaged builds only), lives in the tray, and
keeps running when its window is closed. Use the tray menu to quit.

## Setup

1. Build the web app from the repo root: `npm run build`. It needs the
   Firebase client config (`VITE_FIREBASE_*` env vars or
   `firebase-applet-config.json`).
2. Copy `desktop/.env.example` to `desktop/.env` and set `GEMINI_API_KEY`
   (used for teaching sources). Gitignored; never commit it.
3. Put the Google OAuth client for the desktop app at
   `desktop/oauth-client.json`. This is the JSON downloaded from Google Cloud
   console, Credentials, OAuth client of type "Desktop app", in the Firebase
   project. It is gitignored.
4. `cd desktop && npm install`. Playwright 1.64.1 is pinned exactly; it uses
   the Chromium build Playwright installs (`npx playwright install chromium`).
5. `npm start` builds `desktop/dist/` and launches the app.

`npm start` works from VS Code terminals too: VS Code exports
`ELECTRON_RUN_AS_NODE=1`, which `run.mjs` removes before starting Electron.

## How it fits together

- `src/main.ts` serves `../dist` and the shared `registerApiRoutes` on
  `http://localhost:47321`, bound to loopback only. The port is fixed because
  the page origin keys the Firebase session; a random port would sign you out
  on every launch.
- `registerApiRoutes(app, { scraper })` is the same function the web server
  and Vercel use. Supplying a scraper switches the price routes from Gemini to
  Playwright; nothing else differs.
- `src/preload.ts` exposes `window.legoTrackerDesktop`, which
  `src/lib/platform.ts` uses to detect the desktop build.
- Sign-in (`src/oauth.ts`): Google blocks sign-in pages inside Electron, so
  the app opens Google in your normal browser and receives the result on a
  one-off loopback port (PKCE). The Google ID token is exchanged for a Firebase
  session with `signInWithCredential`.

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

What to read on each page is described by a **recipe** (`lib/scrapeRecipe.ts`):
CSS selectors plus number format, never code. The built-in ones for Amazon.de
and Arukereso are in `lib/builtinRecipes.ts`; a taught recipe on a source
takes precedence over a built-in one.

## Teaching a new source

In the desktop app, open Price Sources, add the shop with its search URL
(`{setNumber}` where the set number goes) and press **Teach**:

1. The local browser opens that search page for up to three of your planned
   sets and keeps a compact HTML excerpt of each.
2. Gemini (key from `desktop/.env`) writes a recipe from the excerpts
   (`lib/teachSource.ts`).
3. The recipe is run on the same live pages. If it finds nothing, Gemini gets
   one retry with what the test saw.
4. The prices found are shown; **Save** stores the recipe on the source in
   Firestore (`userSettings`), so every device has it.

Changing a source's URL to another host drops its recipe. Teaching takes one
to two minutes and a couple of Gemini calls; daily refreshes use none.

The Gemini key lives only in the gitignored `desktop/.env` (see
`.env.example`) and is loaded by the main process; the page never sees it. A
packaged installer will contain it, so keep installers private.

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

This builds the desktop bundle and the web app, stages Playwright's Chromium
(copied from the local Playwright cache, or downloaded), and packages with
`@electron/packager` into `release/`:

- `Brick Tracker-win32-x64/`: the app, with Chromium in `resources/ms-playwright`
  and the web app in `resources/web`;
- `install.cmd`;
- `Brick-Tracker-<version>-win-x64.zip`: both of the above (about 350 MB).

There is no NSIS or Squirrel installer on purpose: both need 7-Zip, which is
blocked on this machine. `install.cmd` (no admin rights) copies the app to
`%LOCALAPPDATA%\Programs\Brick Tracker` and starts it once with `--install`,
which adds a Start menu shortcut and the start-with-Windows entry. The tray
menu's "Start with Windows" toggle turns that entry off or on again. To
update, quit from the tray and run the new `install.cmd`.

**Secrets are never packaged**, and `package.mjs` fails the build if either
file or the key value appears in `app.asar`. The installed app reads them from
its data folder instead:

```
%APPDATA%\Brick Tracker\oauth-client.json   (sign-in)
%APPDATA%\Brick Tracker\.env                (GEMINI_API_KEY, teaching only)
```

The exe is not code-signed, so Windows SmartScreen may warn on first start.

## Not done yet

- Auto-update (re-run `install.cmd` with a new build for now).
