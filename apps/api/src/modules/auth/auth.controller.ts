import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ForgotPasswordRequest,
  GoogleLoginRequest,
  LoginRequest,
  RefreshRequest,
  RegisterRequest,
  ResetPasswordRequest,
  type TokenPair,
  VerifyEmailRequest,
} from '@rideapp/contracts';
import {
  type AuthUser,
  CurrentUser,
  Public,
  ReqContext,
  type RequestContext,
} from '../../common/auth/auth.decorators.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { AccountEmailService } from './account-email.service.js';
import { AuthService } from './auth.service.js';

class RegisterDto extends createZodDto(RegisterRequest) {}
class LoginDto extends createZodDto(LoginRequest) {}
class RefreshDto extends createZodDto(RefreshRequest) {}
class GoogleLoginDto extends createZodDto(GoogleLoginRequest) {}
class VerifyEmailDto extends createZodDto(VerifyEmailRequest) {}
class ForgotPasswordDto extends createZodDto(ForgotPasswordRequest) {}
class ResetPasswordDto extends createZodDto(ResetPasswordRequest) {}

/** Límite estricto por IP en las rutas de credenciales (8.2, paso 5). */
const STRICT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accountEmail: AccountEmailService,
  ) {}

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(204)
  @Post('email/verification')
  requestVerification(@CurrentUser() user: AuthUser): Promise<void> {
    return this.accountEmail.requestVerification(user);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('email/verify')
  verifyEmail(
    @CurrentUser() user: AuthUser,
    @Body() body: VerifyEmailDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<void> {
    return this.accountEmail.verifyEmail(user, body.code, ctx);
  }

  /** Respuesta idéntica exista o no el email (14.2). */
  @Public()
  @Throttle(STRICT)
  @HttpCode(202)
  @Post('password/forgot')
  async forgotPassword(
    @Body() body: ForgotPasswordDto,
    @ReqContext() ctx: RequestContext,
  ): Promise<Record<string, never>> {
    await this.accountEmail.forgotPassword(body, ctx);
    return {};
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(204)
  @Post('password/reset')
  resetPassword(@Body() body: ResetPasswordDto, @ReqContext() ctx: RequestContext): Promise<void> {
    return this.accountEmail.resetPassword(body, ctx);
  }

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
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('google')
  google(@Body() body: GoogleLoginDto, @ReqContext() ctx: RequestContext): Promise<TokenPair> {
    return this.auth.loginWithGoogle(body, ctx);
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
