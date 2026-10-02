import { TripReceiptScreen } from '@rideapp/mobile-core';
import { router, useLocalSearchParams } from 'expo-router';

export default function ReceiptRoute() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return <TripReceiptScreen tripId={id} viewer="PASSENGER" onBack={() => router.back()} />;
}
