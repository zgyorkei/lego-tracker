# Brick Tracker

Brick Tracker is a comprehensive web application designed for Lego enthusiasts to meticulously manage and track their Lego collections. With this app, you can seamlessly plan future purchases, keep an eye on current market prices from various sources, track your actual purchases including detailed currency exchange calculations, and even check off the minifigures you own!

## Features

- **Dashboard View**: View your collection categorized by status (Planned, Purchased, or All).
- **Price Tracking**: Automatically fetch current market prices using custom URL templates for various global online stores.
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

### Architecture
* **Frontend**: React 19, Vite 6, Tailwind CSS v4, Recharts for the price-history chart, motion/react for transitions.
  * Tailwind v4 is configured **CSS-first** in `src/index.css` via `@import "tailwindcss"` and an `@theme` block. There is deliberately no `tailwind.config.js`.
* **Backend**: Express. All routes live in `lib/server-api.ts` and are registered by both entry points (`server.ts` for local dev, `api/index.ts` for Vercel) so the two cannot drift apart.
* **Database**: Firebase Firestore with Google Authentication. There is no Admin SDK; **all** data authorisation is enforced by `firestore.rules`.

### Security notes
* `GEMINI_API_KEY` is server-side only and is never exposed to the client bundle.
* The API layer is unauthenticated by design (single-user app), so it relies on a per-IP rate limiter in `lib/server-api.ts`. On Vercel that limiter is per-instance and therefore best-effort: keep a hard spend cap on the Google Cloud side.
* Price-source URLs are user-configurable and fetched server-side, so they pass through `assertSafeOutboundUrl`, which blocks non-HTTP schemes and hosts that resolve into private ranges.
