import { usePalette } from '@rideapp/ui';
import { Stack } from 'expo-router';

// Sin esto, Expo Router abre la primera ruta en orden alfabético (login) al cerrar sesión.
export const unstable_settings = { initialRouteName: 'welcome' };

export default function AuthLayout() {
  const p = usePalette();
  // Sin encabezado nativo: cada pantalla dibuja su botón de volver (ver FormScreen).
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />;
}
