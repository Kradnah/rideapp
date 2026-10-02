import { usePalette } from '@rideapp/ui';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  const p = usePalette();
  // Sin encabezado nativo: cada pantalla dibuja su botón de volver (ver FormScreen).
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />;
}
