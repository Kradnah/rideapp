import { Injectable } from '@nestjs/common';
import { SocketEvent, type TripEventActor, type TripStatus } from '@rideapp/contracts';
import { Prisma, type Trip } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { RealtimeGateway, tripRoom, userRoom } from '../realtime/realtime.gateway.js';
import { canTransition, isTerminal } from './trip-state.machine.js';

export interface TransitionInput {
  tripId: string;
  to: TripStatus;
  actor: TripEventActor;
  actorId: string | null;
  /** Estados de origen admitidos para esta acción (además de lo que permita la máquina). */
  from?: readonly TripStatus[];
  data?: Prisma.TripUncheckedUpdateManyInput;
  meta?: Prisma.InputJsonValue;
}

export type TransitionResult =
  { ok: true; trip: Trip; from: TripStatus } | { ok: false; trip: Trip | null };

/**
 * Único camino para cambiar el estado de un viaje (8.8, paso 2):
 * - comprueba la máquina de estados (quién puede hacer qué);
 * - `UPDATE ... WHERE id = :id AND status = :from` (bloqueo optimista: si afecta 0 filas,
 *   otro proceso ganó la carrera y la acción no ocurre);
 * - inserta la fila de `trip_events` en la misma transacción.
 * El evento `trip.status.v1` se publica aparte con `publish`, después del commit.
 */
@Injectable()
export class TripTransitions {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async transition(input: TransitionInput): Promise<TransitionResult> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.trip.findUnique({ where: { id: input.tripId } });
      if (!current) return { ok: false, trip: null };
      const from = current.status;
      if (input.from && !input.from.includes(from)) return { ok: false, trip: current };
      if (!canTransition(from, input.to, input.actor)) return { ok: false, trip: current };

      const { count } = await tx.trip.updateMany({
        where: { id: input.tripId, status: from },
        data: { ...input.data, status: input.to },
      });
      if (count === 0) {
        return { ok: false, trip: await tx.trip.findUnique({ where: { id: input.tripId } }) };
      }
      await tx.tripEvent.create({
        data: {
          tripId: input.tripId,
          fromStatus: from,
          toStatus: input.to,
          actor: input.actor,
          actorId: input.actorId,
          meta: input.meta,
        },
      });
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId } });
      return { ok: true, trip, from };
    });
  }

  /**
   * Avisa a la sala del viaje (8.10) y, por si un socket aún no entró en ella (acaba de pedirlo o
   * de conectarse), también a las salas personales de sus participantes. Si el estado es final,
   * después vacía la sala: el viaje ya no emite más eventos.
   */
  publish(trip: Trip, from: TripStatus | null): void {
    const rooms = [tripRoom(trip.id), userRoom(trip.passengerId)];
    if (trip.driverId) rooms.push(userRoom(trip.driverId));
    this.realtime.emitToRooms(rooms, SocketEvent.TripStatus, {
      tripId: trip.id,
      status: trip.status,
      previousStatus: from,
      cancelledBy: trip.cancelledBy,
      at: trip.updatedAt.toISOString(),
    });
    if (isTerminal(trip.status)) this.realtime.closeRoom(tripRoom(trip.id));
  }
}

/** ¿Es un error de restricción única de Postgres (Prisma P2002)? */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
