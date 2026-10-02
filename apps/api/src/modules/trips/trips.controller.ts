import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import {
  type ActiveTripResponse,
  CancelTripRequest,
  CreateTripRequest,
  type DriverOfferResponse,
  QuoteRequest,
  type QuoteResponse,
  StartTripRequest,
  type Trip,
  type TripDriverLocationResponse,
} from '@rideapp/contracts';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { PricingService } from '../pricing/pricing.service.js';
import { MatchingService } from './matching.service.js';
import { TripsService } from './trips.service.js';

class QuoteDto extends createZodDto(QuoteRequest) {}
class CreateTripDto extends createZodDto(CreateTripRequest) {}
class CancelDto extends createZodDto(CancelTripRequest) {}
class StartDto extends createZodDto(StartTripRequest) {}
class IdParam extends createZodDto(z.object({ id: z.uuid() })) {}

/** Cotizar, pedir y seguir un viaje (8.7–8.9). */
@Controller('trips')
export class TripsController {
  constructor(
    private readonly trips: TripsService,
    private readonly pricing: PricingService,
    private readonly matching: MatchingService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Roles('PASSENGER')
  @Post('quote')
  @HttpCode(200)
  quote(@CurrentUser() user: AuthUser, @Body() body: QuoteDto): Promise<QuoteResponse> {
    return this.pricing.quote(user.id, body);
  }

  @Roles('PASSENGER')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateTripDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<Trip> {
    return this.trips.create(user.id, body, this.idempotency.parseKey(idempotencyKey));
  }

  @Roles('PASSENGER', 'DRIVER')
  @Get('active')
  async active(@CurrentUser() user: AuthUser): Promise<ActiveTripResponse> {
    return { trip: await this.trips.active(user) };
  }

  @Roles('PASSENGER', 'DRIVER')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param() { id }: IdParam): Promise<Trip> {
    return this.trips.get(user, id);
  }

  /** Última posición del conductor asignado, para pintarla al abrir la pantalla (solo pasajero). */
  @Roles('PASSENGER')
  @Get(':id/driver-location')
  async driverLocation(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
  ): Promise<TripDriverLocationResponse> {
    return { location: await this.trips.driverLocation(user, id) };
  }

  @Roles('PASSENGER', 'DRIVER')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
    @Body() body: CancelDto,
  ): Promise<Trip> {
    return this.trips.cancel(user, id, body.reason);
  }

  @Roles('DRIVER')
  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param() { id }: IdParam): Promise<Trip> {
    return this.trips.accept(user.id, id);
  }

  @Roles('DRIVER')
  @Post(':id/arrived')
  @HttpCode(200)
  arrived(@CurrentUser() user: AuthUser, @Param() { id }: IdParam): Promise<Trip> {
    return this.trips.arrived(user.id, id);
  }

  @Roles('DRIVER')
  @Post(':id/start')
  @HttpCode(200)
  start(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
    @Body() body: StartDto,
  ): Promise<Trip> {
    return this.trips.start(user.id, id, body.pin);
  }

  @Roles('DRIVER')
  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<Trip> {
    return this.trips.complete(user.id, id, this.idempotency.parseKey(idempotencyKey));
  }

  @Roles('DRIVER')
  @Post(':id/reject')
  @HttpCode(204)
  reject(@CurrentUser() user: AuthUser, @Param() { id }: IdParam): Promise<void> {
    return this.matching.reject(user.id, id);
  }
}

/** Oferta pendiente del conductor, por si la app perdió el evento del socket. */
@Controller('drivers/me')
export class DriverOfferController {
  constructor(private readonly matching: MatchingService) {}

  @Roles('DRIVER')
  @Get('offer')
  async offer(@CurrentUser() user: AuthUser): Promise<DriverOfferResponse> {
    return { offer: await this.matching.currentOffer(user.id) };
  }
}
