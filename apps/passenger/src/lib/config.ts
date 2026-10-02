import Constants from 'expo-constants';

// Las EXPO_PUBLIC_* se incrustan en el bundle al compilar: deben leerse con su nombre literal.
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000/api',
  socketUrl: process.env.EXPO_PUBLIC_SOCKET_URL ?? 'http://10.0.2.2:4000',
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? null,
  mapsEnabled: Constants.expoConfig?.extra?.['mapsEnabled'] === true,
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
  /** Sin proyecto de EAS no hay token de push (la app funciona igual por el socket). */
  easProjectId:
    (Constants.expoConfig?.extra?.['eas'] as { projectId?: string } | undefined)?.projectId ?? null,
} as const;
