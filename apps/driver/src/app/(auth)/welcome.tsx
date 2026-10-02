import { GoogleSignInButton, WelcomeScreen } from '@rideapp/mobile-core';
import { router } from 'expo-router';
import { useState } from 'react';
import { APP_IDENTITY } from '@/lib/app-identity';
import { config } from '@/lib/config';

export default function WelcomeRoute() {
  const [error, setError] = useState<string | null>(null);
  return (
    <WelcomeScreen
      appName={APP_IDENTITY.appName}
      tagline={APP_IDENTITY.tagline}
      onLogin={() => router.push('/login')}
      onRegister={() => router.push('/register')}
      error={error}
      extraButtons={
        config.googleWebClientId ? (
          <GoogleSignInButton
            webClientId={config.googleWebClientId}
            role={APP_IDENTITY.role}
            onError={setError}
          />
        ) : null
      }
    />
  );
}
