import { AccountDataScreen } from '@rideapp/mobile-core';
import { router } from 'expo-router';

export default function AccountRoute() {
  return (
    <AccountDataScreen onBack={() => router.back()} onOpenPolicy={() => router.push('/privacy')} />
  );
}
