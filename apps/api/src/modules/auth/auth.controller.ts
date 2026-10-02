import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LoginRequest, RefreshRequest, RegisterRequest, type TokenPair } from '@rideapp/contracts';
import {
  type AuthUser,
  CurrentUser,
  Public,
  ReqContext,
  type RequestContext,
} from '../../common/auth/auth.decorators.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { AuthService } from './auth.service.js';

class RegisterDto extends createZodDto(RegisterRequest) {}
class LoginDto extends createZodDto(LoginRequest) {}
class RefreshDto extends createZodDto(RefreshRequest) {}

/** Límite estricto por IP en las rutas de credenciales (8.2, paso 5). */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(STRICT)
  @Post('register')
  register(@Body() body: RegisterDto, @ReqContext() ctx: RequestContext): Promise<TokenPair> {
    return this.auth.register(body, ctx);
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('login')
  login(@Body() body: LoginDto, @ReqContext() ctx: RequestContext): Promise<TokenPair> {
    return this.auth.login(body, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() body: RefreshDto, @ReqContext() ctx: RequestContext): Promise<TokenPair> {
    return this.auth.refresh(body.refreshToken, ctx);
  }

  @HttpCode(204)
  @Post('logout')
  logout(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestContext): Promise<void> {
    return this.auth.logout(user, ctx);
  }

  @HttpCode(204)
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthUser, @ReqContext() ctx: RequestContext): Promise<void> {
    return this.auth.logoutAll(user, ctx);
  }
}
