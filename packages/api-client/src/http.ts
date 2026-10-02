import { ApiError, type ErrorCode } from '@rideapp/contracts';
import type { z } from 'zod';

/** Error HTTP del API, ya parseado como `ApiError` del contrato. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE',
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface HttpClientOptions {
  /** URL base con el prefijo, p. ej. `http://10.0.2.2:4000/api`. */
  baseUrl: string;
  /** Token de acceso actual (o null si no hay sesión). */
  getAccessToken?: () => string | null | Promise<string | null>;
  /**
   * Renueva la sesión y devuelve el nuevo access token, o null si no se pudo
   * (la app debe cerrar sesión). Se llama como máximo una vez por oleada de 401 (9.1).
   */
  refreshSession?: () => Promise<string | null>;
  /** Versión de la app, enviada en `X-App-Version` (5.5). */
  appVersion?: string;
  /** El admin usa cookies: `include`. Las apps móviles usan Bearer. */
  credentials?: RequestCredentials;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions<S extends z.ZodType | undefined> {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Esquema con el que se valida la respuesta. Sin esquema, se espera 204. */
  schema?: S;
  /** false para rutas públicas (login, registro...): no envía token ni intenta refrescar. */
  auth?: boolean;
  idempotencyKey?: string;
  /** Cabeceras adicionales (p. ej. el token CSRF del panel). */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

// URLSearchParams no está completo en todos los motores de React Native.
function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export class HttpClient {
  private refreshing: Promise<string | null> | null = null;

  constructor(private readonly options: HttpClientOptions) {}

  /** Se resuelve en cada petición: respeta polyfills o mocks instalados después de crear el cliente. */
  private get fetchImpl(): typeof fetch {
    return this.options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<S extends z.ZodType | undefined = undefined>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    opts: RequestOptions<S> = {},
  ): Promise<S extends z.ZodType ? z.infer<S> : void> {
    const auth = opts.auth ?? true;
    let res = await this.send(
      method,
      path,
      opts,
      auth ? await this.options.getAccessToken?.() : null,
    );

    if (res.status === 401 && auth && this.options.refreshSession) {
      const token = await this.refreshOnce();
      if (token) res = await this.send(method, path, opts, token);
    }
    return this.parse(res, opts.schema);
  }

  /** Varias peticiones con 401 simultáneas comparten un único refresh. */
  private refreshOnce(): Promise<string | null> {
    this.refreshing ??= this.options.refreshSession!()
      .catch(() => null)
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private async send(
    method: string,
    path: string,
    opts: RequestOptions<z.ZodType | undefined>,
    token: string | null | undefined,
  ): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (this.options.appVersion) headers['x-app-version'] = this.options.appVersion;
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    Object.assign(headers, opts.headers);

    // AbortSignal.timeout/any no existen en todos los motores (Hermes): se combina a mano.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);

    try {
      return await this.fetchImpl(`${this.options.baseUrl}${path}${buildQuery(opts.query)}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: this.options.credentials,
        signal: controller.signal,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      throw new ApiClientError(0, 'NETWORK_ERROR', 'Sin conexión con el servidor');
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async parse<S extends z.ZodType | undefined>(
    res: Response,
    schema: S | undefined,
  ): Promise<S extends z.ZodType ? z.infer<S> : void> {
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiClientError(
          res.status,
          'INVALID_RESPONSE',
          'Respuesta no válida del servidor',
        );
      }
    }

    if (!res.ok) {
      const err = ApiError.safeParse(json);
      if (err.success) {
        const { code, message, details, requestId } = err.data;
        throw new ApiClientError(res.status, code, message, details, requestId);
      }
      throw new ApiClientError(res.status, 'INVALID_RESPONSE', `Error HTTP ${res.status}`);
    }

    if (!schema) return undefined as never;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // El servidor no cumple el contrato: mejor fallar aquí que con datos corruptos en la UI.
      throw new ApiClientError(
        res.status,
        'INVALID_RESPONSE',
        'Respuesta fuera de contrato',
        parsed.error.issues,
      );
    }
    return parsed.data as never;
  }
}
