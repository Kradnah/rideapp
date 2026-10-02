import { WelcomeScreen } from '@rideapp/mobile-core';
import { router } from 'expo-router';
import { APP_IDENTITY } from '@/lib/app-identity';

export default function WelcomeRoute() {
  return (
    <WelcomeScreen
      appName={APP_IDENTITY.appName}
      tagline={APP_IDENTITY.tagline}
      onLogin={() => router.push('/login')}
      onRegister={() => router.push('/register')}
    />
  );
}
