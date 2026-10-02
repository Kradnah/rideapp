import { Injectable, Logger } from '@nestjs/common';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId?: string;
  /** Segundos que Expo/FCM intentan entregarla; una oferta caducada no sirve de nada. */
  ttl?: number;
  priority?: 'default' | 'high';
}

/** Resultado por token, en el mismo orden que los mensajes. */
export type PushTicket = { ok: true } | { ok: false; unregistered: boolean; error: string };

export interface PushSender {
  readonly enabled: boolean;
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo admite hasta 100 mensajes por petición. */
const BATCH = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Expo Push API (8.13): gratis y sin SDK. Con PUSH_PROVIDER=disabled no envía nada.
 * Los tickets con `DeviceNotRegistered` indican tokens que hay que borrar.
 */
@Injectable()
export class ExpoPushSender implements PushSender {
  private readonly logger = new Logger('ExpoPush');
  readonly enabled: boolean;

  constructor(@InjectEnv() private readonly env: Env) {
    this.enabled = env.PUSH_PROVIDER === 'expo';
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (!this.enabled) return messages.map(() => ({ ok: true }));
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.env.EXPO_ACCESS_TOKEN && {
            authorization: `Bearer ${this.env.EXPO_ACCESS_TOKEN}`,
          }),
        },
        body: JSON.stringify(batch.map((m) => ({ sound: 'default', ...m }))),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // 429 o 5xx: el job falla y BullMQ lo reintenta con espera.
        throw new Error(`Expo Push respondió ${res.status}`);
      }
      const { data } = (await res.json()) as { data: ExpoTicket[] };
      for (const ticket of data) {
        if (ticket.status === 'ok') {
          tickets.push({ ok: true });
        } else {
          const error = ticket.details?.error ?? 'Unknown';
          tickets.push({ ok: false, unregistered: error === 'DeviceNotRegistered', error });
        }
      }
    }
    const failed = tickets.filter((t) => !t.ok).length;
    if (failed) this.logger.warn({ failed, total: tickets.length }, 'Push con errores');
    return tickets;
  }
}
