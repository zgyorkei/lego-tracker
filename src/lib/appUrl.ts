import { isDesktopApp } from './platform';

// The original deployment. Only used by desktop builds that were not given
// their own address (see publicAppUrl).
const DEFAULT_PUBLIC_URL = 'https://lego.gykovacszoltan.hu';

/**
 * The public address of this deployment, for links handed to other people:
 * gift-registry links and the Planned Sets API URL.
 *
 * VITE_PUBLIC_APP_URL wins when set at build time. Otherwise the website uses
 * the address it is being served from, so every self-hosted copy links to
 * itself. The desktop app is served from localhost, which nobody else can
 * open, so it needs VITE_PUBLIC_APP_URL set when it is built (the setup guide
 * says so) and otherwise falls back to the original deployment.
 */
export function publicAppUrl(): string {
  const configured = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (!isDesktopApp && typeof window !== 'undefined') return window.location.origin;
  return DEFAULT_PUBLIC_URL;
}

export const registryUrl = (token: string) => `${publicAppUrl()}/registry/${token}`;
