import { useEffect, useState } from 'react';
import type { SessionProvider, SessionUser } from '../data/types';

/**
 * The signed-in user from a session provider. `user` is undefined until the
 * provider has answered (a remembered session is still being restored), then
 * the user or null.
 */
export function useSession(provider: SessionProvider) {
  const [user, setUser] = useState<SessionUser>(undefined);
  useEffect(() => provider.subscribe(setUser), [provider]);
  return { user };
}
