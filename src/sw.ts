import { startServiceWorker } from 'pwa-kit/sw';
import config from '../pwa.config';

// Updates take over at once, as the old worker did: the app has one screen and
// keeps its sets in the store, so a reload loses nothing.
startServiceWorker(config, { update: 'auto' });
