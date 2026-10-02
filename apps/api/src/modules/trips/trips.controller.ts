import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type ActiveTripResponse,
  CancelTripRequest,
  CreateTripRequest,
  type DriverEarnings,
  DriverEarningsQuery,
  type DriverOfferResponse,
  QuoteRequest,
  type QuoteResponse,
  RateTripRequest,
  StartTripRequest,
  type Trip,
  type TripDriverLocationResponse,
  type TripHistory,
  TripHistoryQuery,
} from '@rideapp/contracts';
import { z } from 'zod';
import {
  type AuthUser,
  CurrentUser,
  ReqContext,
  type RequestContext,
  Roles,
} from '../../common/auth/auth.decorators.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { MatchingService } from './matching.service.js';
import { RatingsService } from './ratings.service.js';
import { TripsService } from './trips.service.js';

class QuoteDto extends createZodDto(QuoteRequest) {}
class CreateTripDto extends createZodDto(CreateTripRequest) {}
class CancelDto extends createZodDto(CancelTripRequest) {}
class StartDto extends createZodDto(StartTripRequest) {}
class IdParam extends createZodDto(z.object({ id: z.uuid() })) {}
class RateDto extends createZodDto(RateTripRequest) {}
class HistoryQuery extends createZodDto(TripHistoryQuery) {}
class EarningsQuery extends createZodDto(DriverEarningsQuery) {}

/** Cotizar, pedir y seguir un viaje (8.7–8.9). */
@Controller('trips')
export class TripsController {
  constructor(
    private readonly trips: TripsService,
    private readonly pricing: PricingService,
    private readonly matching: MatchingService,
    private readonly idempotency: IdempotencyService,
    private readonly ratings: RatingsService,
    private readonly payments: PaymentsService,
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

  /** Historial propio (9.5, paso 3): el pasajero ve sus viajes y el conductor los que hizo. */
  @Roles('PASSENGER', 'DRIVER')
  @Get()
  history(@CurrentUser() user: AuthUser, @Query() query: HistoryQuery): Promise<TripHistory> {
    return this.trips.history(user, query);
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

  /** El conductor confirma que recibió el efectivo (10.3, paso 4). Repetirlo no hace nada. */
  @Roles('DRIVER')
  @Post(':id/payment/cash-collected')
  @HttpCode(200)
  async cashCollected(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
    @ReqContext() ctx: RequestContext,
  ): Promise<Trip> {
    await this.payments.confirmCash(user.id, id, ctx.ip);
    return this.trips.get(user, id);
  }

  /** Calificar a la otra parte (8.12). */
  @Roles('PASSENGER', 'DRIVER')
  @Post(':id/rating')
  @HttpCode(200)
  async rate(
    @CurrentUser() user: AuthUser,
    @Param() { id }: IdParam,
    @Body() body: RateDto,
  ): Promise<Trip> {
    await this.ratings.rate(user, id, body);
    return this.trips.get(user, id);
  }

  @Roles('DRIVER')
  @Post(':id/reject')
  @HttpCode(204)
  reject(@CurrentUser() user: AuthUser, @Param() { id }: IdParam): Promise<void> {
    return this.matching.reject(user.id, id);
  }
}

/** Oferta pendiente y ganancias del conductor. */
@Controller('drivers/me')
export class DriverTripsController {
  constructor(
    private readonly matching: MatchingService,
    private readonly trips: TripsService,
  ) {}

  /** Suma de los viajes completados entre dos días (10.4). */
  @Roles('DRIVER')
  @Get('earnings')
  earnings(@CurrentUser() user: AuthUser, @Query() query: EarningsQuery): Promise<DriverEarnings> {
    return this.trips.earnings(user.id, query);
  }

  /** Por si la app perdió el evento `trip.offer.v1` del socket. */
  @Roles('DRIVER')
  @Get('offer')
  async offer(@CurrentUser() user: AuthUser): Promise<DriverOfferResponse> {
    return { offer: await this.matching.currentOffer(user.id) };
  }
}
