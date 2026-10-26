# Brick Tracker

Brick Tracker is a comprehensive web application designed for Lego enthusiasts to meticulously manage and track their Lego collections. With this app, you can seamlessly plan future purchases, keep an eye on current market prices from various sources, track your actual purchases including detailed currency exchange calculations, and even check off the minifigures you own!

## Features

- **Dashboard View**: View your collection categorized by status (Planned, Purchased, or All).
- **Price Tracking**: Fetch current market prices using custom URL templates for various global online stores. Price sources are saved to your account, so every device uses the same list. BrickLink always reports the cheapest New listing that is sealed or complete, never incomplete lots. Prices refresh when you ask; automatic daily refreshes are reserved for the upcoming desktop app.
- **Official LEGO Data**: Retrieves the official price and image of Lego sets by their set number. Contains logic to bypass images or cache errors.
- **Purchase Tracking and Analytics**: Track how much you spent on Lego sets manually. If purchased in a different currency, the app fetches the historical exchange rate on the date of purchase.
- **Sorting Options**: 
  - Priority (High to Low, Low to High)
  - Date Added (Newest to Oldest)
  - Set Number (Ascending and Descending)
  - Set Name (A-Z, Z-A)
- **Minifigure Checklists**: For sets that contain them, access a flip-card interface showing a minifigure checklist. Mark which ones you want and which ones you've acquired.
- **Price History**: Each card can expand a chart of the lowest tracked market price over time, built from the price-history recorded on every refresh.
- **Gift Registry**: Build a shareable wishlist and send the link to friends and family. Recipients do not need an account: they can view the sets, see the best current prices, and reserve a gift so nobody buys the same thing twice.
- **Planned Sets API**: Publish every planned set as JSON for another application to fetch. On the Planned filter, click **API**, then **Create API Link**. The published list re-syncs automatically whenever your planned sets change while the app is open. See [Planned Sets API](#planned-sets-api).
- **Installable app**: On Android, ChromeOS and Googlebooks (and desktop Chrome), install the website from Chrome's menu ("Install app" / "Add to home screen") for its own icon and window. When the desktop app is running on a Windows PC, refreshes started on any device are done there, without AI.
- **Themes**: Switch between multiple aesthetic themes inspired by iconic Lego variants (Classic Space, Star Wars, Ninjago, Hidden Side, Bionicle, etc.). Access them easily from the bottom right!
- **Demo Mode**: Give users a test drive of the application features without having to sign in with their Google account. This mode works purely on the client-side with mock data and enforces read-only operations across the app.
- **Secure Authentication**: Log in seamlessly with Google Authentication using Firebase. All user data is secured via Firebase Firestore Rules.

## Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/zgyorkei/lego-tracker.git
   cd lego-tracker
   ```

2. **Install dependencies:**
   Ensure you have Node.js and npm installed.
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   - Copy `.env.example` to `.env` (or set the variables locally).
   - Ensure the Gemini API key is mapped accordingly for fetching external Lego data.
   - For Firebase: use `set_up_firebase` from AI Studio, or configure `VITE_FIREBASE_*` credentials manually to hook the application up to your database.

4. **Run Development Server:**
   ```bash
   npm run dev
   ```
   The application will become available at `http://localhost:3000`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Express + Vite middleware dev server on port 3000 |
| `npm run build` | Production client build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` (strict mode) |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |

## Deployment

Deployment targets **Vercel**, configured by `vercel.json`:
`api/index.ts` serves every `/api/*` route as a serverless function, and all
other paths fall back to `index.html` for the SPA.

1. Build Command: `npm run build`
2. Output Directory: `dist`
3. Supply the environment variables from `.env.example` (Firebase `VITE_*` keys and `GEMINI_API_KEY`).

Firebase configuration and rules deployment are managed in their own Firebase
store, outside this repo (there is no `firebase.json` here by design). The
`firestore.rules` in this repo is the readable source of record for what the
rules should say; when it changes, sync it to the Firebase store.

### Planned Sets API

```
GET /api/planned-sets/:token
```

No auth headers are needed: the random token in the URL is the credential, like
a registry link. Delete the link in the dialog to revoke it, then create a new
one. CORS is open (`Access-Control-Allow-Origin: *`) and responses are cached
for 60 seconds.

```json
{
  "title": "Planned sets",
  "updatedAt": "2026-10-21T09:30:00.000Z",
  "count": 1,
  "sets": [
    {
      "id": "abc123",
      "setNumber": "10305",
      "name": "Lion Knights' Castle",
      "priority": "high",
      "quantity": 1,
      "legoPriceHuf": 149990,
      "legoUrl": "https://www.lego.com/...",
      "productImage": "https://...",
      "releaseDate": null,
      "prices": [
        { "sourceId": "arukereso", "sourceName": "Arukereso", "price": 129990, "currency": "HUF", "priceHuf": 129990, "url": null }
      ]
    }
  ]
}
```

`prices` is sorted cheapest first. `price` is in the source's own `currency`,
and `priceHuf` is the comparable figure. Errors: `404` for an unknown token,
`502` if Firestore refuses the read (usually the `plannedLists` rule has not
been synced), and `503` if the server has no `VITE_FIREBASE_PROJECT_ID`.

The data is a snapshot written by the owner's browser, because the server has
no Firestore credentials. It is current as of the last time the app was open
after a change. `updatedAt` tells a consumer how fresh it is.

### Architecture
* **Frontend**: React 19, Vite 6, Tailwind CSS v4, Recharts for the price-history chart, motion/react for transitions.
  * Tailwind v4 is configured **CSS-first** in `src/index.css` via `@import "tailwindcss"` and an `@theme` block. There is deliberately no `tailwind.config.js`.
* **Backend**: Express. All routes live in `lib/server-api.ts` and are registered by both entry points (`server.ts` for local dev, `api/index.ts` for Vercel) so the two cannot drift apart.
* **Database**: Firebase Firestore with Google Authentication. There is no Admin SDK; **all** data authorisation is enforced by `firestore.rules`.

### Security notes
* `GEMINI_API_KEY` is server-side only and is never exposed to the client bundle.
* The API layer is unauthenticated by design (single-user app), so it relies on a per-IP rate limiter in `lib/server-api.ts`. On Vercel that limiter is per-instance and therefore best-effort: keep a hard spend cap on the Google Cloud side.
* Price-source URLs are user-configurable and fetched server-side, so they pass through `assertSafeOutboundUrl`, which blocks non-HTTP schemes and hosts that resolve into private ranges.
