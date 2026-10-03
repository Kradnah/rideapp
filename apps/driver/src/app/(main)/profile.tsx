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
      shortcuts={[
        { label: 'Ganancias', onPress: () => router.push('/earnings') },
        { label: 'Mis viajes', onPress: () => router.push('/history') },
      ]}
      onOpenPolicy={() => router.push('/privacy')}
      onOpenAccountData={() => router.push('/account')}
      onVerifyEmail={() => router.push('/verify-email')}
    />
  );
}
