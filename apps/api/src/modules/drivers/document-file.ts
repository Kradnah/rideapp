import type { DriverDocumentMime } from '@rideapp/contracts';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { ApiException } from '../../common/errors/api.exception.js';

const MAX_IMAGE_SIDE = 2400;
/** Evita "bombas" de descompresión: una imagen pequeña en bytes pero gigante en píxeles. */
const MAX_INPUT_PIXELS = 50_000_000;

export interface SanitizedDocument {
  data: Buffer;
  mime: DriverDocumentMime;
}

/**
 * Valida y limpia un documento subido (8.4, paso 3; 14.7):
 * - el tipo se detecta por magic bytes, no por la extensión ni por el Content-Type del cliente;
 * - las imágenes se vuelven a codificar con sharp, lo que elimina EXIF (puede llevar GPS) y
 *   cualquier contenido extra escondido en el archivo;
 * - los PDF se guardan tal cual y solo se sirven como descarga, nunca en línea.
 */
export async function sanitizeDocument(input: Buffer): Promise<SanitizedDocument> {
  const type = await fileTypeFromBuffer(input);
  const unsupported = () =>
    new ApiException(415, 'UNSUPPORTED_FILE', 'Formato no admitido: usa JPG, PNG o PDF');

  switch (type?.mime) {
    case 'application/pdf':
      return { data: input, mime: 'application/pdf' };
    case 'image/jpeg':
    case 'image/png': {
      try {
        const image = sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
          // Aplica la orientación del EXIF antes de descartarlo.
          .rotate()
          .resize({
            width: MAX_IMAGE_SIDE,
            height: MAX_IMAGE_SIDE,
            fit: 'inside',
            withoutEnlargement: true,
          });
        // Sin .withMetadata(): sharp no copia EXIF, XMP ni ICC al archivo de salida.
        const data =
          type.mime === 'image/png'
            ? await image.png({ compressionLevel: 9 }).toBuffer()
            : await image.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
        return { data, mime: type.mime };
      } catch {
        throw unsupported();
      }
    }
    default:
      throw unsupported();
  }
}
