import { Controller, Get, Param, Query } from '@nestjs/common';
import { type AdminTripDetail, type AdminTripList, AdminTripListQuery } from '@rideapp/contracts';
import { z } from 'zod';
import { AdminOnly } from '../../common/auth/auth.decorators.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { TripsService } from '../trips/trips.service.js';

class ListQuery extends createZodDto(AdminTripListQuery) {}
class IdParam extends createZodDto(z.object({ id: z.uuid() })) {}

/** Viajes en el panel (11.1, paso 7): listado con filtros y detalle con su línea de tiempo. */
@AdminOnly()
@Controller('admin/trips')
export class AdminTripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  list(@Query() query: ListQuery): Promise<AdminTripList> {
    return this.trips.adminList(query);
  }

  @Get(':id')
  detail(@Param() { id }: IdParam): Promise<AdminTripDetail> {
    return this.trips.adminDetail(id);
  }
}
