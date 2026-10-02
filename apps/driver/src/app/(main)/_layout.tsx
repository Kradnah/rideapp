import { usePushNotifications } from '@rideapp/mobile-core';
import { usePalette } from '@rideapp/ui';
import { router, Stack } from 'expo-router';
import { config } from '@/lib/config';

export default function MainLayout() {
  const p = usePalette();
  // Al tocar un aviso: la oferta se recupera en el inicio (GET /drivers/me/offer); el resto abre
  // el viaje o la cuenta.
  usePushNotifications({
    projectId: config.easProjectId,
    onOpen: (data) => {
      if (data.type === 'trip.status') router.push(`/trip/${data.tripId}`);
      else router.navigate('/');
    },
  });
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />;
}
