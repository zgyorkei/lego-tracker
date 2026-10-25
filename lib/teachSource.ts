// ---------------------------------------------------------------------------
// Teaching a new price source: the desktop browser captures the shop's search
// page for a few sample sets, Gemini writes a declarative recipe from those
// captures, and the recipe is run on the same live pages before anything is
// saved. If it finds nothing, Gemini gets one retry with what the test saw.
//
// The teaching loop and its prompts live in the shop-teacher package
// (github.com/zgyorkei/shop-teacher), shared with the BrickBudget app; this
// module keeps the names this app uses.
// ---------------------------------------------------------------------------

export {
  teachSearchPage as teachSource,
  buildSearchTeachPrompt as buildTeachPrompt,
  buildSearchRetryPrompt as buildRetryPrompt,
  extractJsonObject,
  sampleUrl,
  MAX_TEACH_SAMPLES,
  type TeachSourceInput,
  type TeachCapture,
  type TeachSearchDeps as TeachDeps,
  type TeachSample,
  type TeachSearchResult as TeachResult,
} from 'shop-teacher';
