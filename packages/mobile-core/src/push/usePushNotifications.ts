import { PUSH_CHANNEL_TRIPS, PushData } from '@rideapp/contracts';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useSession } from '../session/SessionProvider';

/** Último token registrado en el API, para desregistrarlo al cerrar sesión. */
export const PUSH_TOKEN_KEY = 'rideapp.push.token';

// Con la app abierta, el socket ya actualiza la pantalla: la notificación no se muestra encima.
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
});

export interface PushNotificationsOptions {
  /**
   * ID del proyecto de EAS. Sin él (o sin las credenciales de FCM en Android) Expo no entrega
   * tokens: la app sigue funcionando con el socket y la consulta periódica.
   */
  projectId: string | null;
  /** Al tocar una notificación: abrir la pantalla que corresponda. */
  onOpen: (data: PushData) => void;
}

/**
 * Notificaciones push (8.13) con la sesión iniciada: canal de Android, permiso, token de Expo
 * registrado en el API y apertura de la pantalla al tocar el aviso. El contenido no trae datos
 * sensibles: la pantalla consulta el detalle al API.
 */
export function usePushNotifications({ projectId, onOpen }: PushNotificationsOptions): void {
  const { status, api } = useSession();
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  // Registro del token cada vez que se inicia sesión (o se abre la app con sesión).
  useEffect(() => {
    if (status !== 'signedIn' || !projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_TRIPS, {
            name: 'Viajes',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            sound: 'default',
          });
        }
        let { status: permission } = await Notifications.getPermissionsAsync();
        if (permission === 'undetermined') {
          ({ status: permission } = await Notifications.requestPermissionsAsync());
        }
        if (permission !== 'granted' || cancelled) return;
        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
        if (cancelled) return;
        await api.me.registerPushToken({
          token,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        });
        await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
      } catch {
        // Sin FCM configurado o sin red: los avisos llegan igual por el socket con la app abierta.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, projectId, api]);

  // Tocar una notificación (también la que abrió la app desde cerrada).
  useEffect(() => {
    if (status !== 'signedIn') return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const parsed = PushData.safeParse(response?.notification.request.content.data);
      if (parsed.success) onOpenRef.current(parsed.data);
    };
    void Notifications.getLastNotificationResponseAsync().then((last) => {
      if (!last) return;
      open(last);
      void Notifications.clearLastNotificationResponseAsync();
    });
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [status]);
}
