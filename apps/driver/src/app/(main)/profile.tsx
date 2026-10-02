import { ProfileScreen } from '@rideapp/mobile-core';
import { router } from 'expo-router';

export default function ProfileRoute() {
  return (
    <ProfileScreen onBack={() => router.back()} onOpenPolicy={() => router.push('/privacy')} />
  );
}
