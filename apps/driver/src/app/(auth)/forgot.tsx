import { ForgotPasswordScreen } from '@rideapp/mobile-core';
import { router } from 'expo-router';

export default function ForgotRoute() {
  return (
    <ForgotPasswordScreen onBack={() => router.back()} onDone={() => router.replace('/login')} />
  );
}
