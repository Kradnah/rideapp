import { randomUUID } from 'node:crypto';
import type { PaymentMethod } from '@rideapp/contracts';

export interface ChargeInput {
  tripId: string;
  amountCents: number;
  currency: string;
}

export interface ChargeResult {
  status: 'AUTHORIZED' | 'CAPTURED' | 'PENDING' | 'FAILED' | 'REFUNDED';
  providerRef: string | null;
}

/**
 * Proveedor de pagos (8.11, paso 1). Con la pasarela real (fase 2 de la demo), la tarjeta se
 * tokeniza en el teléfono con su SDK y aquí solo llega la referencia: el número nunca pasa por
 * el servidor (PCI-DSS).
 */
export interface PaymentProvider {
  readonly method: PaymentMethod;
  authorize(input: ChargeInput): Promise<ChargeResult>;
  capture(input: ChargeInput & { providerRef: string | null }): Promise<ChargeResult>;
  refund(input: ChargeInput & { providerRef: string | null }): Promise<ChargeResult>;
}

/** Efectivo: queda pendiente hasta que el conductor confirma que cobró (8.11, paso 2). */
export class CashProvider implements PaymentProvider {
  readonly method = 'CASH' as const;

  authorize(): Promise<ChargeResult> {
    return Promise.resolve({ status: 'PENDING', providerRef: null });
  }

  capture(): Promise<ChargeResult> {
    return Promise.resolve({ status: 'CAPTURED', providerRef: null });
  }

  /** El efectivo se devuelve en persona: la app no puede reembolsarlo. */
  refund(): Promise<ChargeResult> {
    return Promise.resolve({ status: 'FAILED', providerRef: null });
  }
}

/** Tarjeta de la demo: siempre aprueba y deja una referencia ficticia (8.11, paso 2). */
export class FakeCardProvider implements PaymentProvider {
  readonly method = 'FAKE_CARD' as const;

  authorize(): Promise<ChargeResult> {
    return Promise.resolve({ status: 'AUTHORIZED', providerRef: `fake_${randomUUID()}` });
  }

  capture(input: { providerRef: string | null }): Promise<ChargeResult> {
    return Promise.resolve({
      status: 'CAPTURED',
      providerRef: input.providerRef ?? `fake_${randomUUID()}`,
    });
  }

  refund(input: { providerRef: string | null }): Promise<ChargeResult> {
    return Promise.resolve({ status: 'REFUNDED', providerRef: input.providerRef });
  }
}
