import { usePalette } from '@rideapp/ui';
import { Stack } from 'expo-router';

export default function MainLayout() {
  const p = usePalette();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />;
}
