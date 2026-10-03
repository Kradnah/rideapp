import type { ExecutionContext } from '@nestjs/common';
import { compareVersions } from '@rideapp/contracts';
import { describe, expect, it } from 'vitest';
import { AppVersionGuard } from '../src/common/auth/app-version.guard.js';
import { ApiException } from '../src/common/errors/api.exception.js';
import type { Env } from '../src/config/env.js';

const ctx = (headers: Record<string, string>) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

const guard = (min?: string) => new AppVersionGuard({ MIN_APP_VERSION: min } as Env);

describe('compareVersions', () => {
  it('compara por número, no como texto', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.6.0', '0.7.0')).toBeLessThan(0);
  });
});

describe('AppVersionGuard (14.5)', () => {
  it('sin versión mínima, todo pasa', () => {
    expect(guard().canActivate(ctx({ 'x-app-version': '0.0.1' }))).toBe(true);
  });

  it('sin cabecera (panel, APK antiguas) pasa', () => {
    expect(guard('0.7.0').canActivate(ctx({}))).toBe(true);
  });

  it('igual o mayor pasa; menor o mal formada responde 426', () => {
    expect(guard('0.7.0').canActivate(ctx({ 'x-app-version': '0.7.0' }))).toBe(true);
    expect(guard('0.7.0').canActivate(ctx({ 'x-app-version': '0.10.0' }))).toBe(true);
    for (const v of ['0.6.9', 'abc', '1.0']) {
      try {
        guard('0.7.0').canActivate(ctx({ 'x-app-version': v }));
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiException);
        expect((err as ApiException).status).toBe(426);
        expect((err as ApiException).code).toBe('UPGRADE_REQUIRED');
      }
    }
  });
});
