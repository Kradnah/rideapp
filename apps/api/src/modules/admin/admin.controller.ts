import { Controller, Get, Query } from '@nestjs/common';
import { type AdminOverview, type AdminReport, AdminReportQuery } from '@rideapp/contracts';
import { AdminOnly } from '../../common/auth/auth.decorators.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { DriversService } from '../drivers/drivers.service.js';
import { GeoService } from '../geo/geo.service.js';
import { LocationService } from '../location/location.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { TripsService } from '../trips/trips.service.js';
import { AdminReportsService } from './admin-reports.service.js';

class AdminReportQueryDto extends createZodDto(AdminReportQuery) {}

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
    private readonly payments: PaymentsService,
    private readonly reports: AdminReportsService,
  ) {}

  /** Informes básicos (Fase 6): agregados por día y por hora, sin datos personales. */
  @Get('reports')
  report(@Query() query: AdminReportQueryDto): Promise<AdminReport> {
    return this.reports.report(query);
  }

  @Get('overview')
  async overview(): Promise<AdminOverview> {
    const [rows, pendingReview, online, trips, callsToday, payments] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.drivers.countPendingReview(),
      this.location.onlineCount(),
      this.trips.counts(),
      this.geo.callsToday(),
      this.payments.summary(),
    ]);
    const count = (role: string) => rows.find((r) => r.role === role)?._count._all ?? 0;
    return {
      users: { passengers: count('PASSENGER'), drivers: count('DRIVER'), admins: count('ADMIN') },
      drivers: { pendingReview, online },
      trips,
      payments,
      maps: { provider: this.geo.providerName, callsToday },
    };
  }
}
