import { Global, Module } from '@nestjs/common';
import { FieldCrypto } from '../../common/crypto/field-crypto.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { UsersModule } from '../users/users.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GOOGLE_VERIFIER, GoogleAuthLibraryVerifier } from './google-verifier.js';
import { PasswordService } from './password.service.js';
import { SessionRevocationService } from './session-revocation.service.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

/** Global porque el AuthGuard (APP_GUARD) necesita TokenService y SessionRevocationService. */
@Global()
@Module({
  imports: [UsersModule],
  controllers: [AuthController, AdminAuthController],
  providers: [
    AuthService,
    AdminAuthService,
    {
      provide: FieldCrypto,
      inject: [ENV],
      useFactory: (env: Env) => new FieldCrypto(env.FIELD_ENCRYPTION_KEY),
    },
    PasswordService,
    SessionService,
    SessionRevocationService,
    TokenService,
    { provide: GOOGLE_VERIFIER, useClass: GoogleAuthLibraryVerifier },
  ],
  exports: [TokenService, SessionRevocationService, SessionService, FieldCrypto],
})
export class AuthModule {}
