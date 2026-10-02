import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { ApiClientError, type ApiClient, createApiClient } from '@rideapp/api-client';
import type { TokenPair } from '@rideapp/contracts';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const REFRESH_KEY = 'rideapp.session.refreshToken';
/** El mismo que usa usePushNotifications (no se importa para no cargar expo-notifications aquí). */
const PUSH_TOKEN_KEY = 'rideapp.push.token';

/** Tokens de la sesión. No forman parte del render: solo los leen el cliente HTTP y los efectos. */
class SessionTokens {
  access: string | null = null;
  refresh: string | null = null;
  /** Momento (ms) en que caduca el access token. */
  accessExpiresAt = 0;

  set(pair: TokenPair) {
    this.access = pair.accessToken;
    this.refresh = pair.refreshToken;
    this.accessExpiresAt = Date.now() + pair.expiresIn * 1000;
  }

  reset() {
    this.access = null;
    this.refresh = null;
    this.accessExpiresAt = 0;
  }

  /** Refresh token recuperado del almacenamiento seguro al abrir la app. */
  restore(refreshToken: string) {
    this.refresh = refreshToken;
  }
}

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionContextValue {
  status: SessionStatus;
  /** Cliente del API con el token de esta sesión y refresco automático. */
  api: ApiClient;
  /** Guarda los tokens de un login o registro correcto. */
  signIn: (pair: TokenPair) => Promise<void>;
  /** Cierra la sesión en el servidor (si hay red) y borra los tokens del teléfono. */
  signOut: () => Promise<void>;
  /** "Cerrar sesión en todos los dispositivos". */
  signOutAll: () => Promise<void>;
  /**
   * Access token vigente para el socket (8.10, paso 5): si falta o caduca en menos de 30 s,
   * lo renueva por el mismo camino único que el cliente HTTP. `force` lo renueva siempre.
   */
  getAccessToken: (force?: boolean) => Promise<string | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  apiUrl: string;
  appVersion: string;
  children: ReactNode;
}

/**
 * Sesión del usuario en el móvil (9.1):
 * - El refresh token vive en expo-secure-store (Keystore/Keychain), nunca en AsyncStorage.
 * - El access token solo en memoria; al abrir la app se obtiene uno nuevo con el refresh token.
 * - El api-client refresca ante un 401 una sola vez aunque haya varias peticiones en curso.
 * - Si el refresco responde 401, se cierra la sesión; si falla por red, se mantiene.
 */
export function SessionProvider({ apiUrl, appVersion, children }: SessionProviderProps) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [tokens] = useState(() => new SessionTokens());

  const clear = useCallback(async () => {
    tokens.reset();
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
    setStatus('signedOut');
  }, [tokens]);

  const store = useCallback(
    async (pair: TokenPair) => {
      tokens.set(pair);
      // Se guarda antes de usarlo: el token anterior ya no sirve tras la rotación.
      await SecureStore.setItemAsync(REFRESH_KEY, pair.refreshToken);
    },
    [tokens],
  );

  const api = useMemo(() => {
    const client: ApiClient = createApiClient({
      baseUrl: apiUrl,
      appVersion,
      getAccessToken: () => tokens.access,
      refreshSession: async () => {
        const token = tokens.refresh;
        if (!token) return null;
        try {
          const pair = await client.auth.refresh(token);
          await store(pair);
          return pair.accessToken;
        } catch (err) {
          if (err instanceof ApiClientError && err.status === 401) await clear();
          return null;
        }
      },
    });
    return client;
  }, [apiUrl, appVersion, tokens, store, clear]);

  // Al abrir la app: ¿hay sesión guardada?
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await SecureStore.getItemAsync(REFRESH_KEY);
      if (cancelled) return;
      if (!saved) {
        setStatus('signedOut');
        return;
      }
      tokens.restore(saved);
      try {
        await store(await api.auth.refresh(saved));
        if (!cancelled) setStatus('signedIn');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 401) await clear();
        // Sin red: se entra igualmente; el primer 401 volverá a intentar el refresco.
        else setStatus('signedIn');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, tokens, store, clear]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      api,
      signIn: async (pair) => {
        await store(pair);
        setStatus('signedIn');
      },
      signOut: async () => {
        // Primero el push: el teléfono deja de recibir avisos de esta cuenta (8.13).
        const pushToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
        if (pushToken) await api.me.unregisterPushToken(pushToken).catch(() => undefined);
        await api.auth.logout().catch(() => undefined);
        // Si entró con Google, también se cierra allí para poder elegir otra cuenta (9.1).
        await GoogleSignin.signOut().catch(() => undefined);
        await clear();
      },
      signOutAll: async () => {
        await api.auth.logoutAll();
        await GoogleSignin.signOut().catch(() => undefined);
        await clear();
      },
      getAccessToken: async (force = false) => {
        if (!force && tokens.access && tokens.accessExpiresAt - Date.now() > 30_000) {
          return tokens.access;
        }
        return api.http.refreshOnce();
      },
    }),
    [status, api, store, clear, tokens],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return ctx;
}
