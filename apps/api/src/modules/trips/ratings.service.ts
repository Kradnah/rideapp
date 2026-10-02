import { Injectable } from '@nestjs/common';
import { RATING_WINDOW_DAYS, type RateTripRequest } from '@rideapp/contracts';
import { ApiException } from '../../common/errors/api.exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { isUniqueViolation } from './trip-transitions.js';
import type { Viewer } from './trips.service.js';

export const RATING_WINDOW_MS = RATING_WINDOW_DAYS * 86_400_000;

/** Promedio con un decimal a partir de la suma y el número de votos; null sin votos. */
export function ratingAverage(sum: number, count: number): number | null {
  return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

/**
 * Calificaciones (8.12): solo los participantes de un viaje completado, una vez cada uno y dentro
 * de los 7 días siguientes. El promedio del calificado se actualiza en la misma transacción, de
 * forma incremental (suma + número, sin recorrer todas las calificaciones).
 */
@Injectable()
export class RatingsService {
  constructor(private readonly prisma: PrismaService) {}

  async rate(viewer: Viewer, tripId: string, body: RateTripRequest, now = Date.now()) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { passengerId: true, driverId: true, status: true, completedAt: true },
    });
    const asPassenger = viewer.role === 'PASSENGER' && trip?.passengerId === viewer.id;
    const asDriver = viewer.role === 'DRIVER' && trip?.driverId === viewer.id;
    if (!trip || (!asPassenger && !asDriver)) {
      throw new ApiException(404, 'NOT_FOUND', 'Viaje no encontrado');
    }
    if (trip.status !== 'COMPLETED' || !trip.completedAt || !trip.driverId) {
      throw new ApiException(409, 'CONFLICT', 'Solo se califican viajes completados.');
    }
    if (now - trip.completedAt.getTime() > RATING_WINDOW_MS) {
      throw new ApiException(
        409,
        'CONFLICT',
        `El plazo para calificar (${RATING_WINDOW_DAYS} días) terminó.`,
      );
    }
    const toUser = asPassenger ? trip.driverId : trip.passengerId;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.rating.create({
          data: {
            tripId,
            fromUser: viewer.id,
            toUser,
            score: body.score,
            comment: body.comment || null,
          },
        });
        await tx.user.update({
          where: { id: toUser },
          data: { ratingSum: { increment: body.score }, ratingCount: { increment: 1 } },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiException(409, 'CONFLICT', 'Ya calificaste este viaje.');
      }
      throw err;
    }
  }
}
