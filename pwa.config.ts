import { definePwa } from 'pwa-kit';

// Brick Tracker's PWA in one object (pwa-kit): the manifest, the head tags and
// the service worker all read it. The quick actions are the user's pick
// (PWA.ACTIONS-ASK); src/lib/quickAction.ts reads the query each one opens.
export default definePwa({
  app: 'brick-tracker',
  name: 'Brick Tracker',
  shortName: 'Bricks',
  description: 'Plan, track and price your LEGO sets.',
  lang: 'en',
  themeColor: '#FFD500',
  backgroundColor: '#f3f4f6',
  icons: [
    { src: '/icons/icon-192.png', size: 192 },
    { src: '/icons/icon-512.png', size: 512 },
    { src: '/icons/icon-maskable-512.png', size: 512, purpose: 'maskable' },
  ],
  appleTouchIcon: '/icons/apple-touch-icon.png',
  quickActions: [
    { name: 'Track a set', url: '/?add=set' },
    { name: 'Log a purchase', url: '/?filter=planned&buy=pick' },
    {
      name: 'Refresh planned prices',
      shortName: 'Refresh prices',
      url: '/?filter=planned&refresh=prices',
    },
  ],
});
