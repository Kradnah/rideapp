import { Global, Module } from '@nestjs/common';
import { ConfigurableMailer, MAILER } from './mailer.js';

@Global()
@Module({
  providers: [{ provide: MAILER, useClass: ConfigurableMailer }],
  exports: [MAILER],
})
export class MailModule {}
