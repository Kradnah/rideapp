import { Injectable } from '@nestjs/common';
import type { SignedFileUrl } from '@rideapp/contracts';
import { deriveKey } from '../../common/crypto/derived-keys.js';
import { UrlSigner } from '../../common/crypto/url-signer.js';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';

/** 5 minutos: lo justo para abrir el documento desde el panel (8.14, paso 3). */
export const DOCUMENT_URL_TTL_MS = 5 * 60_000;

const resource = (documentId: string) => `driver-document:${documentId}`;

/** URLs firmadas de los documentos de conductores. */
@Injectable()
export class DocumentLinks {
  private readonly signer: UrlSigner;

  constructor(@InjectEnv() env: Env) {
    this.signer = new UrlSigner(deriveKey(env.FIELD_ENCRYPTION_KEY, 'signed-url:v1'));
  }

  create(documentId: string, now = Date.now()): SignedFileUrl {
    const exp = now + DOCUMENT_URL_TTL_MS;
    const sig = this.signer.sign(resource(documentId), exp);
    return {
      path: `/files/driver-documents/${documentId}?exp=${exp}&sig=${sig}`,
      expiresAt: new Date(exp).toISOString(),
    };
  }

  verify(documentId: string, exp: number, sig: string): boolean {
    return this.signer.verify(resource(documentId), exp, sig);
  }
}
