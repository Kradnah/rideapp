import { Body, Controller, Delete, Get, Header, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DeleteMeRequest, type MeExport } from '@rideapp/contracts';
import {
  type AuthUser,
  CurrentUser,
  ReqContext,
  type RequestContext,
} from '../../common/auth/auth.decorators.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { PrivacyService } from './privacy.service.js';

class DeleteMeDto extends createZodDto(DeleteMeRequest) {}

/** Derechos del titular (8.3, 15.2): solo sobre el usuario del token, sin `:id`. */
@Controller('me')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** Exportación en JSON (acceso y portabilidad). Costosa: pocas veces por minuto. */
  @Get('export')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  export(@CurrentUser() user: AuthUser): Promise<MeExport> {
    return this.privacy.export(user.id);
  }

  @Delete()
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  delete(
    @CurrentUser() user: AuthUser,
    @Body() body: DeleteMeDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    return this.privacy.deleteAccount(user.id, body, ctx.ip);
  }
}
