import { Body, Controller, Get, Patch } from '@nestjs/common';
import { type Me, UpdateMeRequest } from '@rideapp/contracts';
import { type AuthUser, CurrentUser } from '../../common/auth/auth.decorators.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { UsersService } from './users.service.js';

class UpdateMeDto extends createZodDto(UpdateMeRequest) {}

/** Perfil propio (8.3). Solo opera sobre el usuario del token: no hay `:id`, no hay IDOR posible. */
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.users.getMe(user.id);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() body: UpdateMeDto): Promise<Me> {
    return this.users.updateMe(user.id, body);
  }
}
