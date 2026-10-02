import { RegisterScreen } from '@rideapp/mobile-core';
import { router } from 'expo-router';
import { APP_IDENTITY } from '@/lib/app-identity';

export default function RegisterRoute() {
  return (
    <RegisterScreen
      onBack={() => router.back()}
      role={APP_IDENTITY.role}
      onLogin={() => router.replace('/login')}
      onOpenPolicy={() => router.push('/privacy')}
    />
  );
}
