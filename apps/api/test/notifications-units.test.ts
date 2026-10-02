import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpoPushSender } from '../src/modules/notifications/push-sender.js';
import { ratingAverage } from '../src/modules/trips/ratings.service.js';
import { testEnv } from './helpers/test-env.js';

describe('ExpoPushSender', () => {
  afterEach(() => vi.unstubAllGlobals());

  const message = (n: number) => ({
    to: `ExponentPushToken[token${n}]`,
    title: 'Hola',
    body: 'Prueba',
    data: {},
  });

  it('desactivado no llama a Expo', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const sender = new ExpoPushSender(testEnv({ PUSH_PROVIDER: 'disabled' }));
    expect(await sender.send([message(1)])).toEqual([{ ok: true }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('envía en lotes de 100 y marca DeviceNotRegistered', async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      const batch = JSON.parse(init.body as string) as { to: string }[];
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: batch.map((m) =>
              m.to === 'ExponentPushToken[token3]'
                ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
                : { status: 'ok', id: 'x' },
            ),
          }),
        ),
      );
    });
    vi.stubGlobal('fetch', fetch);
    const sender = new ExpoPushSender(
      testEnv({ PUSH_PROVIDER: 'expo', EXPO_ACCESS_TOKEN: 'secreto' }),
    );
    const tickets = await sender.send(Array.from({ length: 150 }, (_, i) => message(i)));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(tickets).toHaveLength(150);
    expect(tickets[3]).toEqual({ ok: false, unregistered: true, error: 'DeviceNotRegistered' });
    expect(tickets.filter((t) => t.ok)).toHaveLength(149);
    const headers = fetch.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer secreto');
  });

  it('un error HTTP de Expo hace fallar el job (BullMQ reintenta)', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 503 })));
    const sender = new ExpoPushSender(testEnv({ PUSH_PROVIDER: 'expo' }));
    await expect(sender.send([message(1)])).rejects.toThrow('503');
  });
});

describe('ratingAverage', () => {
  it('redondea a un decimal y es null sin votos', () => {
    expect(ratingAverage(0, 0)).toBeNull();
    expect(ratingAverage(14, 3)).toBe(4.7);
    expect(ratingAverage(5, 1)).toBe(5);
  });
});
