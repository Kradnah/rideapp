import { Controller, Get } from '@nestjs/common';
import type { AdminOverview } from '@rideapp/contracts';
import { AdminOnly } from '../../common/auth/auth.decorators.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/** Endpoints del panel (8.14): rol ADMIN y sesión con TOTP. */
@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  async overview(): Promise<AdminOverview> {
    const rows = await this.prisma.user.groupBy({
      by: ['role'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const count = (role: string) => rows.find((r) => r.role === role)?._count._all ?? 0;
    return {
      users: { passengers: count('PASSENGER'), drivers: count('DRIVER'), admins: count('ADMIN') },
    };
  }
}
