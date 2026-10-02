import { useSession, VerifyEmailScreen } from '@rideapp/mobile-core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

export default function VerifyEmailRoute() {
  const { api } = useSession();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me.get() });
  return (
    <VerifyEmailScreen
      email={me.data?.email ?? null}
      onBack={() => router.back()}
      onVerified={() => router.back()}
    />
  );
}
