import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  type AdminAuditList,
  AdminAuditQuery,
  type AdminFareRules,
  AdminReasonRequest,
  type AdminRevealResponse,
  type AdminUserDetail,
  type AdminUserList,
  AdminUserListQuery,
  CreateFareRuleRequest,
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
import { PricingService } from '../pricing/pricing.service.js';
import { AdminUsersService } from './admin-users.service.js';

class IdParam extends createZodDto(z.object({ id: z.uuid() })) {}
class UserListQuery extends createZodDto(AdminUserListQuery) {}
class ReasonDto extends createZodDto(AdminReasonRequest) {}
class CreateFareDto extends createZodDto(CreateFareRuleRequest) {}
class AuditQuery extends createZodDto(AdminAuditQuery) {}

/** Usuarios en el panel (11.1, paso 6). */
@AdminOnly()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(@Query() query: UserListQuery): Promise<AdminUserList> {
    return this.users.list(query);
  }

  @Get(':id')
  detail(@Param() { id }: IdParam): Promise<AdminUserDetail> {
    return this.users.detail(id);
  }

  @Post(':id/reveal-phone')
  @HttpCode(200)
  async revealPhone(
    @CurrentUser() admin: AuthUser,
    @Param() { id }: IdParam,
    @ReqContext() ctx: RequestContext,
  ): Promise<AdminRevealResponse> {
    return { value: await this.users.revealPhone(admin.id, id, ctx.ip) };
  }

  @Post(':id/suspend')
  @HttpCode(204)
  suspend(
    @CurrentUser() admin: AuthUser,
    @Param() { id }: IdParam,
    @Body() { reason }: ReasonDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    return this.users.suspend(admin.id, id, reason, ctx.ip);
  }

  @Post(':id/reactivate')
  @HttpCode(204)
  reactivate(
    @CurrentUser() admin: AuthUser,
    @Param() { id }: IdParam,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    return this.users.reactivate(admin.id, id, ctx.ip);
  }
}

/** Tarifas (8.14, paso 5; 11.1, paso 8): se crean versiones nuevas, nunca se editan. */
@AdminOnly()
@Controller('admin/fares')
export class AdminFaresController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  list(): Promise<AdminFareRules> {
    return this.pricing.adminList();
  }

  @Post()
  @HttpCode(204)
  create(
    @CurrentUser() admin: AuthUser,
    @Body() body: CreateFareDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    return this.pricing.createRule(admin.id, body, ctx.ip);
  }
}

/** Auditoría (11.1, paso 9): solo lectura. */
@AdminOnly()
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: AuditQuery): Promise<AdminAuditList> {
    return this.audit.list(query);
  }
}
