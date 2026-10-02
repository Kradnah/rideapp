import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionRevocationService } from './session-revocation.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

/** Global porque el AuthGuard (APP_GUARD) necesita TokenService y SessionRevocationService. */
@Global()
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, SessionRevocationService, TokenService],
  exports: [TokenService, SessionRevocationService, SessionService],
})
export class AuthModule {}
