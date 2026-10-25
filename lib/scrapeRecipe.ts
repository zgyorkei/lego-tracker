// ---------------------------------------------------------------------------
// Declarative scraping recipes for the desktop app.
//
// A recipe tells the desktop scraper how to read one shop's search-results
// page: which elements are product cards, where the title and price sit, and
// how numbers are written. Recipes are data, never code: a recipe can only
// select elements and read their text.
//
// The recipe format, its validation and the matching rules live in the
// shop-teacher package (github.com/zgyorkei/shop-teacher), shared with the
// BrickBudget app; this module keeps the names this app uses.
// ---------------------------------------------------------------------------

export {
  parseSearchRecipe as parseRecipe,
  parseDisplayPrice,
  titleMatchScore,
  rankCards,
  type SearchRecipe as ScrapeRecipe,
  type ScrapeCookie,
  type DecimalSeparator,
  type RecipeTestResult,
  type ScrapedCard,
  type PickedCard,
} from 'shop-teacher';
