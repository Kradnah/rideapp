import { SessionProvider, useSession } from '@rideapp/mobile-core';
import { usePalette } from '@rideapp/ui';
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  useQueryClient,
} from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { config } from '@/lib/config';
// Registra la tarea de ubicación en segundo plano al arrancar (expo-task-manager lo exige).
import '@/lib/location-reporter';

// En móvil, "foco" = app en primer plano: las consultas periódicas se pausan en segundo plano (9.2).
function useAppStateFocus() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => sub.remove();
  }, []);
}

/** Sin sesión solo existen las rutas de (auth); con sesión, las de (main). */
function RootNavigator() {
  const { status } = useSession();
  const queryClient = useQueryClient();
  const p = usePalette();

  // Al cerrar sesión no debe quedar en caché nada del usuario anterior.
  useEffect(() => {
    if (status === 'signedOut') queryClient.clear();
  }, [status, queryClient]);

  if (status === 'loading') {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg }}
      >
        <ActivityIndicator color={p.accent} size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }}>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="(main)" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Screen
        name="privacy"
        options={{ presentation: 'modal', headerShown: true, title: 'Política de datos' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } }),
  );
  useAppStateFocus();

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider apiUrl={config.apiUrl} appVersion={config.appVersion}>
          <StatusBar style="auto" />
          <RootNavigator />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
