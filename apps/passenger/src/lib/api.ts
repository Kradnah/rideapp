import { createApiClient } from '@rideapp/api-client';
import { CURRENT_POLICY_VERSION } from '@rideapp/contracts';
import { config } from './config';

// Fase 0: el token vive solo en memoria. En la Fase 1 lo sustituye el SessionProvider de
// mobile-core, con expo-secure-store y refresco automático (9.1).
let accessToken: string | null = null;

export const api = createApiClient({
  baseUrl: config.apiUrl,
  appVersion: config.appVersion,
  getAccessToken: () => accessToken,
});

/**
 * Solo desarrollo con el mock-server: inicia una sesión falsa para poder llamar a los
 * endpoints autenticados (el mock acepta cualquier idToken de Google).
 */
export async function ensureDemoSession(): Promise<boolean> {
  if (accessToken) return true;
  if (!config.demoSession) return false;
  const pair = await api.auth.google({
    idToken: 'demo-passenger-device',
    role: 'PASSENGER',
    consent: { acceptTerms: true, policyVersion: CURRENT_POLICY_VERSION },
  });
  accessToken = pair.accessToken;
  return true;
}
