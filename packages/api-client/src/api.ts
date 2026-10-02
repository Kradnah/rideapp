import {
  AdminAuditList,
  AdminFareRules,
  AdminUserDetail,
  AdminUserList,
  DriverEarnings,
  TripHistory,
  type AdminAuditQuery,
  type AdminUserListQuery,
  type CreateFareRuleRequest,
  type RateTripRequest,
  type RegisterPushTokenRequest,
  type TripHistoryQuery,
  ActiveTripResponse,
  AdminTripDetail,
  AdminTripList,
  DriverOfferResponse,
  Trip,
  TripDriverLocationResponse,
  type AdminTripListQuery,
  type CreateTripRequest,
  AdminDriverDetail,
  AdminDriverList,
  AdminLiveDrivers,
  AdminLoginChallenge,
  AdminOverview,
  AdminRevealResponse,
  DriverAccount,
  DriverAvailabilityResponse,
  DriverDocument,
  SignedFileUrl,
  Vehicle,
  AdminSession,
  AutocompleteResponse,
  CSRF_HEADER,
  HealthResponse,
  Me,
  NearbyDriversResponse,
  PlaceDetails,
  QuoteResponse,
  ReverseGeocodeResponse,
  TokenPair,
  type AdminDriverListQuery,
  type DriverDocumentType,
  type DriverOnboardingRequest,
  type ForgotPasswordRequest,
  type GoogleLoginRequest,
  type LatLng,
  type LoginRequest,
  type QuoteRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type RevealableDriverField,
  type UpdateMeRequest,
  type VehicleCategory,
  type VehicleRequest,
} from '@rideapp/contracts';
import { z } from 'zod';
import { HttpClient, type HttpClientOptions } from './http.js';

/** Cliente tipado del API. Cada respuesta se valida con su esquema de `contracts`. */
export function createApiClient(options: HttpClientOptions) {
  const http = new HttpClient(options);

  return {
    http,

    health: {
      live: () => http.request('GET', '/health/live', { schema: HealthResponse, auth: false }),
      ready: () => http.request('GET', '/health/ready', { schema: HealthResponse, auth: false }),
    },

    auth: {
      register: (body: RegisterRequest) =>
        http.request('POST', '/auth/register', { body, schema: TokenPair, auth: false }),
      login: (body: LoginRequest) =>
        http.request('POST', '/auth/login', { body, schema: TokenPair, auth: false }),
      google: (body: GoogleLoginRequest) =>
        http.request('POST', '/auth/google', { body, schema: TokenPair, auth: false }),
      refresh: (refreshToken: string) =>
        http.request('POST', '/auth/refresh', {
          body: { refreshToken },
          schema: TokenPair,
          auth: false,
        }),
      logout: () => http.request('POST', '/auth/logout'),
      logoutAll: () => http.request('POST', '/auth/logout-all'),
      requestEmailVerification: () => http.request('POST', '/auth/email/verification'),
      verifyEmail: (code: string) => http.request('POST', '/auth/email/verify', { body: { code } }),
      forgotPassword: (body: ForgotPasswordRequest) =>
        http.request('POST', '/auth/password/forgot', { body, auth: false }),
      resetPassword: (body: ResetPasswordRequest) =>
        http.request('POST', '/auth/password/reset', { body, auth: false }),
    },

    me: {
      get: () => http.request('GET', '/me', { schema: Me }),
      update: (body: UpdateMeRequest) => http.request('PATCH', '/me', { body, schema: Me }),
      /** Token de Expo Push del teléfono (8.13). */
      registerPushToken: (body: RegisterPushTokenRequest) =>
        http.request('POST', '/me/push-tokens', { body }),
      /** Al cerrar sesión: el teléfono deja de recibir avisos de esta cuenta. */
      unregisterPushToken: (token: string) =>
        http.request('DELETE', '/me/push-tokens', { body: { token } }),
    },

    geo: {
      autocomplete: (q: string, sessionToken: string, signal?: AbortSignal) =>
        http.request('GET', '/geo/autocomplete', {
          query: { q, sessionToken },
          schema: AutocompleteResponse,
          signal,
        }),
      place: (placeId: string, sessionToken: string) =>
        http.request('GET', `/geo/place/${encodeURIComponent(placeId)}`, {
          query: { sessionToken },
          schema: PlaceDetails,
        }),
      reverse: ({ lat, lng }: LatLng) =>
        http.request('GET', '/geo/reverse', {
          query: { lat, lng },
          schema: ReverseGeocodeResponse,
        }),
    },

    drivers: {
      /** Pasajero: conductores libres cerca, aproximados y sin ID. */
      nearby: ({ lat, lng }: LatLng, category?: VehicleCategory) =>
        http.request('GET', '/drivers/nearby', {
          query: { lat, lng, category },
          schema: NearbyDriversResponse,
        }),
      me: () => http.request('GET', '/drivers/me', { schema: DriverAccount }),
      saveProfile: (body: DriverOnboardingRequest) =>
        http.request('POST', '/drivers/onboarding', { body, schema: DriverAccount }),
      vehicles: () => http.request('GET', '/drivers/vehicles', { schema: z.array(Vehicle) }),
      addVehicle: (body: VehicleRequest) =>
        http.request('POST', '/drivers/vehicles', { body, schema: Vehicle }),
      deleteVehicle: (id: string) =>
        http.request('DELETE', `/drivers/vehicles/${encodeURIComponent(id)}`),
      activateVehicle: (id: string) =>
        http.request('POST', `/drivers/vehicles/${encodeURIComponent(id)}/activate`, {
          schema: Vehicle,
        }),
      /**
       * Sube un documento (campo `file`). En React Native:
       * `form.append('file', { uri, name, type } as unknown as Blob)`.
       */
      uploadDocument: (type: DriverDocumentType, form: FormData) =>
        http.request('PUT', `/drivers/documents/${type}`, {
          body: form,
          schema: DriverDocument,
          timeoutMs: 60_000,
        }),
      submit: () => http.request('POST', '/drivers/me/submit', { schema: DriverAccount }),
      goOnline: () =>
        http.request('POST', '/drivers/me/online', { schema: DriverAvailabilityResponse }),
      goOffline: () =>
        http.request('POST', '/drivers/me/offline', { schema: DriverAvailabilityResponse }),
      /** Oferta pendiente, por si la app perdió el evento `trip.offer.v1`. */
      offer: () => http.request('GET', '/drivers/me/offer', { schema: DriverOfferResponse }),
      /** Ganancias entre dos días de Colombia (YYYY-MM-DD), ambos incluidos. */
      earnings: (from: string, to: string) =>
        http.request('GET', '/drivers/me/earnings', {
          query: { from, to },
          schema: DriverEarnings,
        }),
    },

    /** Panel admin: sesión con cookie HttpOnly + CSRF (11.1). Solo para el navegador del panel. */
    admin: {
      login: (body: LoginRequest) =>
        http.request('POST', '/auth/admin/login', {
          body,
          schema: AdminLoginChallenge,
          auth: false,
        }),
      verifyTotp: (challengeId: string, code: string) =>
        http.request('POST', '/auth/admin/totp', {
          body: { challengeId, code },
          schema: AdminSession,
          auth: false,
        }),
      refresh: (csrfToken: string) =>
        http.request('POST', '/auth/admin/refresh', {
          schema: AdminSession,
          auth: false,
          headers: { [CSRF_HEADER]: csrfToken },
        }),
      logout: (csrfToken: string) =>
        http.request('POST', '/auth/admin/logout', {
          auth: false,
          headers: { [CSRF_HEADER]: csrfToken },
        }),
      overview: () => http.request('GET', '/admin/overview', { schema: AdminOverview }),
      drivers: {
        list: (query: Partial<AdminDriverListQuery> = {}) =>
          http.request('GET', '/admin/drivers', { query, schema: AdminDriverList }),
        live: () => http.request('GET', '/admin/drivers/live', { schema: AdminLiveDrivers }),
        detail: (id: string) =>
          http.request('GET', `/admin/drivers/${encodeURIComponent(id)}`, {
            schema: AdminDriverDetail,
          }),
        reveal: (id: string, field: RevealableDriverField) =>
          http.request('POST', `/admin/drivers/${encodeURIComponent(id)}/reveal`, {
            body: { field },
            schema: AdminRevealResponse,
          }),
        /** URL firmada de 5 minutos; `path` es relativo a la base del API. */
        documentUrl: (id: string, documentId: string) =>
          http.request(
            'GET',
            `/admin/drivers/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}/url`,
            { schema: SignedFileUrl },
          ),
        approve: (id: string) =>
          http.request('POST', `/admin/drivers/${encodeURIComponent(id)}/approve`),
        reject: (id: string, reason: string) =>
          http.request('POST', `/admin/drivers/${encodeURIComponent(id)}/reject`, {
            body: { reason },
          }),
        suspend: (id: string, reason: string) =>
          http.request('POST', `/admin/drivers/${encodeURIComponent(id)}/suspend`, {
            body: { reason },
          }),
        reactivate: (id: string) =>
          http.request('POST', `/admin/drivers/${encodeURIComponent(id)}/reactivate`),
      },
      users: {
        list: (query: Partial<AdminUserListQuery> = {}) =>
          http.request('GET', '/admin/users', { query, schema: AdminUserList }),
        detail: (id: string) =>
          http.request('GET', `/admin/users/${encodeURIComponent(id)}`, {
            schema: AdminUserDetail,
          }),
        revealPhone: (id: string) =>
          http.request('POST', `/admin/users/${encodeURIComponent(id)}/reveal-phone`, {
            schema: AdminRevealResponse,
          }),
        suspend: (id: string, reason: string) =>
          http.request('POST', `/admin/users/${encodeURIComponent(id)}/suspend`, {
            body: { reason },
          }),
        reactivate: (id: string) =>
          http.request('POST', `/admin/users/${encodeURIComponent(id)}/reactivate`),
      },
      fares: {
        list: () => http.request('GET', '/admin/fares', { schema: AdminFareRules }),
        create: (body: CreateFareRuleRequest) => http.request('POST', '/admin/fares', { body }),
      },
      audit: {
        list: (query: Partial<AdminAuditQuery> = {}) =>
          http.request('GET', '/admin/audit', { query, schema: AdminAuditList }),
      },
      trips: {
        list: (query: Partial<AdminTripListQuery> = {}) =>
          http.request('GET', '/admin/trips', { query, schema: AdminTripList }),
        detail: (id: string) =>
          http.request('GET', `/admin/trips/${encodeURIComponent(id)}`, {
            schema: AdminTripDetail,
          }),
      },
    },

    trips: {
      quote: (body: QuoteRequest) =>
        http.request('POST', '/trips/quote', { body, schema: QuoteResponse }),
      /**
       * Pide el viaje. `idempotencyKey` (un UUID por intento) evita duplicarlo si se reintenta
       * por mala conexión (8.8, paso 5): genera una nueva solo si el usuario vuelve a pedir.
       */
      create: (body: CreateTripRequest, idempotencyKey: string) =>
        http.request('POST', '/trips', { body, schema: Trip, idempotencyKey }),
      active: () => http.request('GET', '/trips/active', { schema: ActiveTripResponse }),
      get: (id: string) =>
        http.request('GET', `/trips/${encodeURIComponent(id)}`, { schema: Trip }),
      cancel: (id: string, reason?: string) =>
        http.request('POST', `/trips/${encodeURIComponent(id)}/cancel`, {
          body: reason ? { reason } : {},
          schema: Trip,
        }),
      /** Última posición del conductor asignado (solo el pasajero, con el viaje activo). */
      driverLocation: (id: string) =>
        http.request('GET', `/trips/${encodeURIComponent(id)}/driver-location`, {
          schema: TripDriverLocationResponse,
        }),
      accept: (id: string) =>
        http.request('POST', `/trips/${encodeURIComponent(id)}/accept`, { schema: Trip }),
      arrived: (id: string) =>
        http.request('POST', `/trips/${encodeURIComponent(id)}/arrived`, { schema: Trip }),
      /** Iniciar con el PIN que dicta el pasajero (8.8, paso 4). */
      start: (id: string, pin: string) =>
        http.request('POST', `/trips/${encodeURIComponent(id)}/start`, {
          body: { pin },
          schema: Trip,
        }),
      /** Finalizar. Con la misma `idempotencyKey`, un reintento no repite la acción. */
      complete: (id: string, idempotencyKey: string) =>
        http.request('POST', `/trips/${encodeURIComponent(id)}/complete`, {
          schema: Trip,
          idempotencyKey,
        }),
      reject: (id: string) => http.request('POST', `/trips/${encodeURIComponent(id)}/reject`),
      /** Historial propio de viajes terminados, del más reciente al más antiguo. */
      history: (query: Partial<TripHistoryQuery> = {}) =>
        http.request('GET', '/trips', { query, schema: TripHistory }),
      /** Calificar a la otra parte (una vez, hasta 7 días después de completar). */
      rate: (id: string, body: RateTripRequest) =>
        http.request('POST', `/trips/${encodeURIComponent(id)}/rating`, { body, schema: Trip }),
      /** El conductor confirma que recibió el efectivo. Repetirlo no hace nada. */
      confirmCash: (id: string) =>
        http.request('POST', `/trips/${encodeURIComponent(id)}/payment/cash-collected`, {
          schema: Trip,
        }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
