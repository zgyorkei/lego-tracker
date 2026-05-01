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
- **Gift Registry**: Create and download an image showcasing your planned sets and missing minifigures. Share this image easily to drop hints for birthdays and holidays!
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

## Deployment

### Vercel / Netlify / Render
You can easily deploy to a static app hosting provider by tying it to your repository.

1. Set the Node.js Build Command to: `npm run build`
2. Set the Output Directory to: `dist`
3. Supply all the necessary Environment Variables (such as Firebase attributes and the Gemini API key).

### Architecture
* **Frontend**: React 18, Vite, Tailwind CSS, Recharts for price history visualization, and motion/react for fluid UI transitions.
* **Backend**: Express + Vite middleware, exposing API routes to fetch external Lego data and proxies to circumvent CORS and scrape prices.
* **Database**: Firebase Firestore with Authentication.
