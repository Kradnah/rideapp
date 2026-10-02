import { usePushNotifications } from '@rideapp/mobile-core';
import { usePalette } from '@rideapp/ui';
import { router, Stack } from 'expo-router';
import { config } from '@/lib/config';
import { TripDraftProvider } from '@/lib/trip-draft';

export default function MainLayout() {
  const p = usePalette();
  // Al tocar un aviso (conductor asignado, llegó, canceló…), se abre el viaje.
  usePushNotifications({
    projectId: config.easProjectId,
    onOpen: (data) => {
      if (data.type === 'trip.status') router.push(`/trip/${data.tripId}`);
    },
  });
  return (
    <TripDraftProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />
    </TripDraftProvider>
  );
}
