import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { api, readCsrfCookie, refreshAdminSession, setAccessToken, setOnSessionLost } from './api';
import { AdminSessionContext, type AdminSessionValue, type SessionStatus } from './session-context';

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  // Sin cookie CSRF no hay sesión que recuperar: se empieza directamente sin sesión.
  const [status, setStatus] = useState<SessionStatus>(() =>
    readCsrfCookie() ? 'loading' : 'signedOut',
  );
  const queryClient = useQueryClient();

  // Al cargar la página: si hay cookie de sesión, se pide un access token nuevo.
  useEffect(() => {
    setOnSessionLost(() => {
      setAccessToken(null);
      queryClient.clear();
      setStatus('signedOut');
    });
    if (!readCsrfCookie()) return () => setOnSessionLost(null);
    let active = true;
    void refreshAdminSession().then((token) => {
      // Sin token (sesión caducada o sin red): se muestra el login en vez de quedarse cargando.
      if (active) setStatus(token ? 'signedIn' : 'signedOut');
    });
    return () => {
      active = false;
      setOnSessionLost(null);
    };
  }, [queryClient]);

  const value = useMemo<AdminSessionValue>(
    () => ({
      status,
      signIn: (token) => {
        setAccessToken(token);
        setStatus('signedIn');
      },
      signOut: async () => {
        const csrf = readCsrfCookie();
        if (csrf) await api.admin.logout(csrf).catch(() => undefined);
        setAccessToken(null);
        queryClient.clear();
        setStatus('signedOut');
      },
    }),
    [status, queryClient],
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}
