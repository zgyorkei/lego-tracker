import { desktopConfig } from './platform';

/**
 * The public address of this deployment, for links handed to other people:
 * gift-registry links and the Planned Sets API URL.
 *
 * The desktop app is served from localhost, which nobody else can open, so it
 * uses the website address entered in its setup (required there). On the
 * website, VITE_PUBLIC_APP_URL wins when set at build time; otherwise it is
 * the address the site is served from, so every self-hosted copy links to
 * itself. There is deliberately no hard-coded fallback domain.
 */
export function publicAppUrl(): string {
  if (desktopConfig) return desktopConfig.publicAppUrl;
  const configured = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return window.location.origin;
}

export const registryUrl = (token: string) => `${publicAppUrl()}/registry/${token}`;
