import { TripHistoryScreen } from '@rideapp/mobile-core';
import { router } from 'expo-router';

export default function HistoryRoute() {
  return (
    <TripHistoryScreen
      counterpartLabel="Conductor"
      onBack={() => router.back()}
      onOpen={(id) => router.push(`/history/${id}`)}
    />
  );
}
