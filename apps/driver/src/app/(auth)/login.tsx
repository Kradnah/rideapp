import { LoginScreen } from '@rideapp/mobile-core';
import { router } from 'expo-router';

export default function LoginRoute() {
  return (
    <LoginScreen onBack={() => router.back()} onRegister={() => router.replace('/register')} />
  );
}
