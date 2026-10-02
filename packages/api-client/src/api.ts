import {
  AdminLoginChallenge,
  AdminOverview,
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
  type ForgotPasswordRequest,
  type GoogleLoginRequest,
  type LatLng,
  type LoginRequest,
  type QuoteRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type UpdateMeRequest,
} from '@rideapp/contracts';
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
      nearby: ({ lat, lng }: LatLng) =>
        http.request('GET', '/drivers/nearby', {
          query: { lat, lng },
          schema: NearbyDriversResponse,
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
    },

    trips: {
      quote: (body: QuoteRequest) =>
        http.request('POST', '/trips/quote', { body, schema: QuoteResponse }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
