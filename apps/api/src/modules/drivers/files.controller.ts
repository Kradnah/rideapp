import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Public } from '../../common/auth/auth.decorators.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { createZodDto } from '../../common/zod/zod-dto.js';
import { DocumentLinks } from './document-links.js';
import { DriversService } from './drivers.service.js';

class IdParam extends createZodDto(z.object({ id: z.uuid() })) {}
class SignatureQuery extends createZodDto(
  z.strictObject({
    exp: z.coerce.number().int().positive(),
    sig: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
) {}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/**
 * Descarga de documentos con URL firmada (14.7). Pública porque la autorización es la firma
 * (solo la genera un admin y caduca en 5 minutos). El tipo nunca se infiere: va el validado al
 * subir, con `nosniff`, y los PDF siempre como descarga.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly drivers: DriversService,
    private readonly links: DocumentLinks,
  ) {}

  @Public()
  @Get('driver-documents/:id')
  async driverDocument(
    @Param() { id }: IdParam,
    @Query() { exp, sig }: SignatureQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const notFound = new ApiException(404, 'NOT_FOUND', 'Enlace no válido o caducado');
    if (!this.links.verify(id, exp, sig)) throw notFound;
    const file = await this.drivers.readDocument(id);
    if (!file) throw notFound;

    const ext = EXTENSIONS[file.doc.mime] ?? 'bin';
    const disposition = file.doc.mime.startsWith('image/') ? 'inline' : 'attachment';
    void reply
      .type(file.doc.mime)
      .header('content-disposition', `${disposition}; filename="documento.${ext}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox");
    return file.data;
  }
}
