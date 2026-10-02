import { Controller, Get } from '@nestjs/common';
import type { AdminOverview } from '@rideapp/contracts';
import { AdminOnly } from '../../common/auth/auth.decorators.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { DriversService } from '../drivers/drivers.service.js';
import { GeoService } from '../geo/geo.service.js';
import { LocationService } from '../location/location.service.js';
import { TripsService } from '../trips/trips.service.js';

/** Endpoints del panel (8.14): rol ADMIN y sesión con TOTP. */
@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drivers: DriversService,
    private readonly location: LocationService,
    private readonly trips: TripsService,
    private readonly geo: GeoService,
  ) {}

  @Get('overview')
  async overview(): Promise<AdminOverview> {
    const [rows, pendingReview, online, trips, callsToday] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.drivers.countPendingReview(),
      this.location.onlineCount(),
      this.trips.counts(),
      this.geo.callsToday(),
    ]);
    const count = (role: string) => rows.find((r) => r.role === role)?._count._all ?? 0;
    return {
      users: { passengers: count('PASSENGER'), drivers: count('DRIVER'), admins: count('ADMIN') },
      drivers: { pendingReview, online },
      trips,
      maps: { provider: this.geo.providerName, callsToday },
    };
  }
}
