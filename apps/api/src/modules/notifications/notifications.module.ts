import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { PUSH_SENDER, ExpoPushSender } from './push-sender.js';
import { PushTokensController } from './push-tokens.controller.js';

/** Global: viajes, emparejamiento y conductores avisan por push sin importar el módulo. */
@Global()
@Module({
  controllers: [PushTokensController],
  providers: [NotificationsService, { provide: PUSH_SENDER, useClass: ExpoPushSender }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
