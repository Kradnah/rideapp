import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  type DriverAccount,
  type DriverAvailabilityResponse,
  type DriverDocument,
  DriverDocumentType,
  DriverOnboardingRequest,
  NearbyDriversQuery,
  type NearbyDriversResponse,
  type Vehicle,
  VehicleRequest,
} from '@rideapp/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { LocationService } from '../location/location.service.js';
import { DriversService } from './drivers.service.js';

class OnboardingDto extends createZodDto(DriverOnboardingRequest) {}
class VehicleDto extends createZodDto(VehicleRequest) {}
class IdParam extends createZodDto(z.object({ id: z.uuid() })) {}
class DocumentTypeParam extends createZodDto(z.object({ type: DriverDocumentType })) {}
class NearbyDto extends createZodDto(NearbyDriversQuery) {}

/** Errores de @fastify/multipart traducidos al contrato (límite de tamaño, partes de más...). */
function uploadError(err: unknown): ApiException {
  const code = (err as { code?: string }).code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') {
    return new ApiException(413, 'FILE_TOO_LARGE', 'El archivo supera los 5 MB');
  }
  return new ApiException(400, 'VALIDATION_FAILED', 'Envía un solo archivo en el campo "file"');
}

/** Cuenta de conductor (8.4) y disponibilidad (8.5). Todo opera sobre el usuario del token. */
@Controller('drivers')
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly location: LocationService,
  ) {}

  @Roles('DRIVER')
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<DriverAccount> {
    return this.drivers.getAccount(user.id);
  }

  @Roles('DRIVER')
  @Post('onboarding')
  @HttpCode(200)
  onboarding(@CurrentUser() user: AuthUser, @Body() body: OnboardingDto): Promise<DriverAccount> {
    return this.drivers.saveProfile(user.id, body);
  }

  @Roles('DRIVER')
  @Get('vehicles')
  vehicles(@CurrentUser() user: AuthUser): Promise<Vehicle[]> {
    return this.drivers.listVehicles(user.id);
  }

  @Roles('DRIVER')
  @Post('vehicles')
  addVehicle(@CurrentUser() user: AuthUser, @Body() body: VehicleDto): Promise<Vehicle> {
    return this.drivers.addVehicle(user.id, body);
  }

  @Roles('DRIVER')
  @Delete('vehicles/:id')
  @HttpCode(204)
  deleteVehicle(@CurrentUser() user: AuthUser, @Param() { id }: IdParam): Promise<void> {
    return this.drivers.deleteVehicle(user.id, id);
  }

  @Roles('DRIVER')
  @Post('vehicles/:id/activate')
  @HttpCode(200)
  activateVehicle(@CurrentUser() user: AuthUser, @Param() { id }: IdParam): Promise<Vehicle> {
    return this.drivers.activateVehicle(user.id, id);
  }

  /** Subida multipart de un documento (campo `file`); reemplaza el anterior del mismo tipo. */
  @Roles('DRIVER')
  @Put('documents/:type')
  async uploadDocument(
    @CurrentUser() user: AuthUser,
    @Param() { type }: DocumentTypeParam,
    @Req() req: FastifyRequest,
  ): Promise<DriverDocument> {
    if (!req.isMultipart()) {
      throw new ApiException(415, 'UNSUPPORTED_FILE', 'Envía el archivo como multipart/form-data');
    }
    let data: Buffer;
    try {
      const part = await req.file();
      if (!part || part.fieldname !== 'file') throw new Error('sin archivo');
      data = await part.toBuffer();
    } catch (err) {
      throw uploadError(err);
    }
    if (data.length === 0) throw new ApiException(400, 'VALIDATION_FAILED', 'Archivo vacío');
    return this.drivers.uploadDocument(user.id, type, data);
  }

  @Roles('DRIVER')
  @Post('me/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser): Promise<DriverAccount> {
    return this.drivers.submit(user.id);
  }

  @Roles('DRIVER')
  @Post('me/online')
  @HttpCode(200)
  online(@CurrentUser() user: AuthUser): Promise<DriverAvailabilityResponse> {
    return this.drivers.goOnline(user.id);
  }

  @Roles('DRIVER')
  @Post('me/offline')
  @HttpCode(200)
  offline(@CurrentUser() user: AuthUser): Promise<DriverAvailabilityResponse> {
    return this.drivers.goOffline(user.id);
  }

  /** Conductores libres cerca del pasajero: sin IDs y con posición aproximada (8.5, paso 5). */
  @Roles('PASSENGER')
  @Get('nearby')
  async nearby(@Query() query: NearbyDto): Promise<NearbyDriversResponse> {
    return { drivers: await this.location.nearby(query, query.category) };
  }
}
