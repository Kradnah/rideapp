import { createContext, useContext } from 'react';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AdminSessionValue {
  status: SessionStatus;
  /** Tras el paso del TOTP: guarda el access token y entra. */
  signIn: (accessToken: string) => void;
  signOut: () => Promise<void>;
}

export const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function useAdminSession(): AdminSessionValue {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error('useAdminSession fuera de AdminSessionProvider');
  return ctx;
}
