import { TripHistoryScreen } from '@rideapp/mobile-core';
import { router } from 'expo-router';

export default function HistoryRoute() {
  return (
    <TripHistoryScreen
      counterpartLabel="Pasajero"
      onBack={() => router.back()}
      onOpen={(id) => router.push(`/history/${id}`)}
    />
  );
}
