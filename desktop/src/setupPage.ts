import type { SetupForm, SetupState } from './setup';

// The settings window's page script (setup.html). Collects the form and shows
// what the main process says; all checking happens there (setup.ts).
declare global {
  interface Window {
    brickTrackerSetup: {
      load(): Promise<SetupState>;
      pickOAuthClient(): Promise<{ file: string | null; error?: string }>;
      save(form: SetupForm): Promise<{ error?: string }>;
    };
  }
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const api = window.brickTrackerSetup;

const showClient = (file: string | null) => {
  const span = el('client');
  span.textContent = file ?? 'No file chosen yet.';
  span.className = file ? 'ok' : '';
};

void api.load().then((state) => {
  el<HTMLTextAreaElement>('firebase').value = state.firebaseText;
  el<HTMLInputElement>('database').value = state.databaseId === '(default)' ? '' : state.databaseId;
  el<HTMLInputElement>('url').value = state.publicAppUrl;
  showClient(state.oauthClient);
  if (state.problem) el('problem').textContent = `The saved settings could not be used: ${state.problem}`;
  if (!state.firstRun) {
    el('intro').textContent = 'Saving restarts Brick Tracker with the new settings.';
    el('save').textContent = 'Save and restart';
  }
  if (state.gemini.hasKey) {
    el('geminiHint').textContent = 'A key is already stored. Enter one only to replace it (for BrickBudget too).';
  } else if (!state.gemini.storeAvailable) {
    el('geminiHint').textContent = 'Windows Credential Manager is not available here, so a key cannot be saved.';
    el<HTMLInputElement>('gemini').disabled = true;
  }
  el<HTMLTextAreaElement>('firebase').focus();
});

el('pick').addEventListener('click', async () => {
  const result = await api.pickOAuthClient();
  el('error').textContent = result.error ?? '';
  if (result.file) showClient(result.file);
});

el<HTMLFormElement>('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const save = el<HTMLButtonElement>('save');
  save.disabled = true;
  try {
    const result = await api.save({
      firebaseText: el<HTMLTextAreaElement>('firebase').value,
      databaseId: el<HTMLInputElement>('database').value,
      publicAppUrl: el<HTMLInputElement>('url').value,
      geminiKey: el<HTMLInputElement>('gemini').value,
    });
    el('error').textContent = result.error ?? '';
  } finally {
    save.disabled = false;
  }
});
