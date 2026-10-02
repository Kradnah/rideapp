import { Global, Module } from '@nestjs/common';
import { deriveKey } from '../../common/crypto/derived-keys.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { LocalEncryptedStorage, StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ENV],
      useFactory: (env: Env) =>
        new LocalEncryptedStorage(
          env.STORAGE_DIR,
          deriveKey(env.FIELD_ENCRYPTION_KEY, 'storage:v1'),
        ),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
