import Constants from 'expo-constants';

// Las EXPO_PUBLIC_* se incrustan en el bundle al compilar: deben leerse con su nombre literal.
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000/api',
  socketUrl: process.env.EXPO_PUBLIC_SOCKET_URL ?? 'http://10.0.2.2:4000',
  demoSession: process.env.EXPO_PUBLIC_DEMO_SESSION === '1',
  mapsEnabled: Constants.expoConfig?.extra?.['mapsEnabled'] === true,
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;
