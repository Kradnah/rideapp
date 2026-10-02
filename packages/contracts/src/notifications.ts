import { z } from 'zod';

/**
 * Notificaciones push con Expo (8.13). El contenido nunca lleva datos sensibles (direcciones,
 * teléfonos): solo un aviso genérico y, en `data`, lo justo para que la app abra la pantalla y
 * consulte el detalle al API.
 */

export const PushPlatform = z.enum(['android', 'ios']);
export type PushPlatform = z.infer<typeof PushPlatform>;

/** Formato de los tokens de Expo: `ExponentPushToken[...]` (o `ExpoPushToken[...]`). */
export const ExpoPushToken = z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$/);

/** POST /me/push-tokens: al iniciar sesión o cuando Expo entrega un token nuevo. */
export const RegisterPushTokenRequest = z.strictObject({
  token: ExpoPushToken,
  platform: PushPlatform,
});
export type RegisterPushTokenRequest = z.infer<typeof RegisterPushTokenRequest>;

/** DELETE /me/push-tokens: al cerrar sesión, para no avisar a un teléfono que ya no es suyo. */
export const UnregisterPushTokenRequest = z.strictObject({ token: ExpoPushToken });
export type UnregisterPushTokenRequest = z.infer<typeof UnregisterPushTokenRequest>;

/** `data` de cada push: qué abrir al tocarla. */
export const PushData = z.discriminatedUnion('type', [
  z.object({ type: z.literal('trip.offer'), tripId: z.uuid() }),
  z.object({ type: z.literal('trip.status'), tripId: z.uuid() }),
  z.object({ type: z.literal('driver.account') }),
]);
export type PushData = z.infer<typeof PushData>;

/** Canal de Android para avisos del viaje (sonido y prioridad alta). */
export const PUSH_CHANNEL_TRIPS = 'trips';
