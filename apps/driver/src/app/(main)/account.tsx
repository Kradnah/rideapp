import { AccountDataScreen } from '@rideapp/mobile-core';
import { router } from 'expo-router';

export default function AccountRoute() {
  return (
    <AccountDataScreen
      onBack={() => router.back()}
      onOpenPolicy={() => router.push('/privacy')}
      roleNote="También borramos tus documentos y dejas de recibir viajes; tus ganancias pasadas se conservan sin tu nombre."
    />
  );
}
