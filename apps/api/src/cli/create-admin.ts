/* eslint-disable no-console -- herramienta de línea de comandos: escribe en la terminal */
/**
 * Alta de un administrador del panel (8.14, paso 7). Los admins no se registran por el API.
 *
 *   Local:      pnpm --filter @rideapp/api cli:create-admin -- --email ana@ejemplo.com --name "Ana Admin"
 *   Producción: sudo docker exec -it <contenedor-api> node dist/cli/create-admin.js --email ... --name ...
 *
 * Pide la contraseña sin mostrarla y enseña una sola vez el QR del TOTP.
 */
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import QRCode from 'qrcode';
import { FieldCrypto } from '../common/crypto/field-crypto.js';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createAdmin } from '../modules/admin/admin-provisioning.js';
import { PasswordService } from '../modules/auth/password.service.js';

function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error('Ejecuta el comando en una terminal interactiva (docker exec -it).'));
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.exit(130); // Ctrl+C
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
  });
  if (!values.email || !values.name) {
    console.error('Uso: create-admin --email <email> --name "<nombre completo>"');
    process.exit(2);
  }

  const env = loadEnv();
  const password = await askHidden('Contraseña (mínimo 12 caracteres): ');
  if (password !== (await askHidden('Repite la contraseña: '))) {
    console.error('Las contraseñas no coinciden.');
    process.exit(1);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  const passwords = new PasswordService();
  try {
    const admin = await createAdmin(
      { prisma, crypto: new FieldCrypto(env.FIELD_ENCRYPTION_KEY), passwords },
      { email: values.email, fullName: values.name, password },
    );
    console.log('\nAdministrador creado. Escanea este QR con Google Authenticator o Aegis:\n');
    console.log(await QRCode.toString(admin.otpauthUri, { type: 'terminal', small: true }));
    console.log(`Si no puedes escanearlo, introduce esta clave a mano: ${admin.secretBase32}`);
    console.log('Se muestra una sola vez: no la guardes en texto plano.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
