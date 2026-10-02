import { ProfileScreen } from '@rideapp/mobile-core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

export default function ProfileRoute() {
  // Al volver (p. ej. tras verificar el email) se vuelve a montar y recarga los datos.
  const [visit, setVisit] = useState(0);
  useFocusEffect(useCallback(() => setVisit((v) => v + 1), []));
  return (
    <ProfileScreen
      key={visit}
      onBack={() => router.back()}
      onOpenPolicy={() => router.push('/privacy')}
      onVerifyEmail={() => router.push('/verify-email')}
    />
  );
}
