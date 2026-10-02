import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { RegisterPushTokenRequest, UnregisterPushTokenRequest } from '@rideapp/contracts';
import { type AuthUser, CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { NotificationsService } from './notifications.service.js';

class RegisterDto extends createZodDto(RegisterPushTokenRequest) {}
class UnregisterDto extends createZodDto(UnregisterPushTokenRequest) {}

/** Tokens de push del usuario autenticado (8.13). Sin `:id`: no hay IDOR posible. */
@Roles('PASSENGER', 'DRIVER')
@Controller('me/push-tokens')
export class PushTokensController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @HttpCode(204)
  register(@CurrentUser() user: AuthUser, @Body() body: RegisterDto): Promise<void> {
    return this.notifications.register(user.id, body);
  }

  @Delete()
  @HttpCode(204)
  unregister(@CurrentUser() user: AuthUser, @Body() body: UnregisterDto): Promise<void> {
    return this.notifications.unregister(user.id, body.token);
  }
}
