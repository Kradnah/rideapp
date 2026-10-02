import { usePalette } from '@rideapp/ui';
import { Stack } from 'expo-router';
import { TripDraftProvider } from '@/lib/trip-draft';

export default function MainLayout() {
  const p = usePalette();
  return (
    <TripDraftProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />
    </TripDraftProvider>
  );
}
