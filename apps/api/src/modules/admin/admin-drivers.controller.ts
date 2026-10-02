import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type AdminDriverDetail,
  type AdminDriverList,
  AdminDriverListQuery,
  AdminDriverReasonRequest,
  type AdminLiveDrivers,
  AdminRevealRequest,
  type AdminRevealResponse,
  type SignedFileUrl,
  SocketEvent,
} from '@rideapp/contracts';
import { z } from 'zod';
import {
  AdminOnly,
  type AuthUser,
  CurrentUser,
  ReqContext,
  type RequestContext,
} from '../../common/auth/auth.decorators.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { AuditService } from '../audit/audit.service.js';
import { DocumentLinks } from '../drivers/document-links.js';
import { DriversService } from '../drivers/drivers.service.js';
import { LocationService } from '../location/location.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

class ListQuery extends createZodDto(AdminDriverListQuery) {}
class IdParam extends createZodDto(z.object({ id: z.uuid() })) {}
class DocumentParams extends createZodDto(z.object({ id: z.uuid(), documentId: z.uuid() })) {}
class RevealDto extends createZodDto(AdminRevealRequest) {}
class ReasonDto extends createZodDto(AdminDriverReasonRequest) {}

/** Conductores en el panel (11.1, paso 5): cola de revisión, documentos y decisiones. */
@AdminOnly()
@Controller('admin/drivers')
export class AdminDriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly links: DocumentLinks,
    private readonly location: LocationService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() query: ListQuery): Promise<AdminDriverList> {
    return this.drivers.adminList(query);
  }

  /** Conductores en línea con posición exacta, para el mapa del dashboard (11.1, paso 4). */
  @Get('live')
  async live(): Promise<AdminLiveDrivers> {
    const live = await this.location.live();
    const names = await this.drivers.namesById(live.map((d) => d.driverId));
    return {
      drivers: live.map((d) => ({ ...d, fullName: names.get(d.driverId) ?? 'Conductor' })),
    };
  }

  @Get(':id')
  detail(@Param() { id }: IdParam): Promise<AdminDriverDetail> {
    return this.drivers.adminDetail(id);
  }

  @Post(':id/reveal')
  @HttpCode(200)
  async reveal(
    @CurrentUser() admin: AuthUser,
    @Param() { id }: IdParam,
    @Body() { field }: RevealDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<AdminRevealResponse> {
    return { value: await this.drivers.adminReveal(admin.id, id, field, ctx.ip) };
  }

  /** URL firmada de 5 minutos; abrir un documento queda en auditoría. */
  @Get(':id/documents/:documentId/url')
  async documentUrl(
    @CurrentUser() admin: AuthUser,
    @Param() { id, documentId }: DocumentParams,
    @ReqContext() ctx: RequestContext,
  ): Promise<SignedFileUrl> {
    const doc = await this.drivers.adminDocument(id, documentId);
    await this.audit.log({
      actorId: admin.id,
      action: 'admin.driver_document_viewed',
      entity: 'driver_document',
      entityId: doc.id,
      ip: ctx.ip,
      meta: { driverId: id, type: doc.type },
    });
    return this.links.create(doc.id);
  }

  @Post(':id/approve')
  @HttpCode(204)
  approve(
    @CurrentUser() admin: AuthUser,
    @Param() { id }: IdParam,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    return this.drivers.approve(admin.id, id, ctx.ip);
  }

  @Post(':id/reject')
  @HttpCode(204)
  reject(
    @CurrentUser() admin: AuthUser,
    @Param() { id }: IdParam,
    @Body() { reason }: ReasonDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    return this.drivers.reject(admin.id, id, reason, ctx.ip);
  }

  @Post(':id/suspend')
  @HttpCode(204)
  async suspend(
    @CurrentUser() admin: AuthUser,
    @Param() { id }: IdParam,
    @Body() { reason }: ReasonDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    await this.drivers.suspend(admin.id, id, reason, ctx.ip);
    // La app deja de enviar su ubicación en cuanto lo recibe.
    this.realtime.emitToUser(id, SocketEvent.DriverAvailability, {
      availability: 'OFFLINE',
      reason: 'SUSPENDED',
    });
  }

  @Post(':id/reactivate')
  @HttpCode(204)
  reactivate(
    @CurrentUser() admin: AuthUser,
    @Param() { id }: IdParam,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    return this.drivers.reactivate(admin.id, id, ctx.ip);
  }
}
