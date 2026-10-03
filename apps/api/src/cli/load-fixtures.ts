/* eslint-disable no-console -- herramienta de línea de comandos: escribe en la terminal */
/**
 * Usuarios sintéticos para la prueba de carga (sección 16, `infra/load/`): N conductores aprobados
 * con vehículo y P pasajeros, y un access token para cada uno. Escribe un JSON que lee k6.
 *
 *   pnpm --filter @rideapp/api cli:load-fixtures -- --drivers 500 --passengers 50 --out <ruta>
 *   pnpm --filter @rideapp/api cli:load-fixtures -- --purge   (borra todos los usuarios de carga)
 *
 * Nunca en producción: crea cuentas falsas y tokens sin sesión real.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadEnv } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { TokenService } from '../modules/auth/token.service.js';

const { values } = parseArgs({
  // pnpm reenvía el `--` separador tal cual.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    drivers: { type: 'string', default: '500' },
    passengers: { type: 'string', default: '50' },
    out: { type: 'string', default: 'load-fixtures.json' },
    purge: { type: 'boolean', default: false },
  },
});

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('load-fixtures no se ejecuta en producción.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

if (values.purge) {
  // Todo lo de los usuarios de carga (sus emails terminan en .invalid), en orden de dependencias.
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'load-', endsWith: '@example.invalid' } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  const trips = { OR: [{ passengerId: { in: ids } }, { driverId: { in: ids } }] };
  const tripIds = (await prisma.trip.findMany({ where: trips, select: { id: true } })).map(
    (t) => t.id,
  );
  await prisma.payment.deleteMany({ where: { tripId: { in: tripIds } } });
  await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
  await prisma.fareQuote.deleteMany({ where: { passengerId: { in: ids } } });
  const { count } = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`Borrados ${count} usuarios y ${tripIds.length} viajes de carga.`);
  await prisma.$disconnect();
  process.exit(0);
}

const tokens = new TokenService(env);
const run = randomUUID().slice(0, 8);
const plate = (i: number) =>
  `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + (Math.floor(i / 26) % 26))}Z${String(i % 1000).padStart(3, '0')}`;

async function user(role: 'DRIVER' | 'PASSENGER', i: number) {
  const created = await prisma.user.create({
    data: {
      email: `load-${run}-${role.toLowerCase()}-${i}@example.invalid`,
      fullName: `Carga ${role === 'DRIVER' ? 'Conductor' : 'Pasajero'} ${i}`,
      role,
    },
  });
  if (role === 'DRIVER') {
    await prisma.driverProfile.create({
      data: {
        userId: created.id,
        status: 'APPROVED',
        licenseNumberEnc: 'carga',
        licenseLast4: '0000',
        submittedAt: new Date(),
        approvedAt: new Date(),
        vehicles: {
          create: {
            plate: plate(i),
            brand: 'Renault',
            model: 'Logan',
            color: 'Gris',
            year: 2020,
            category: 'STANDARD',
            active: true,
          },
        },
      },
    });
  }
  const token = await tokens.signAccessToken({
    sub: created.id,
    role,
    sid: randomUUID(),
    amr: ['pwd'],
  });
  return { id: created.id, token };
}

const drivers = [];
for (let i = 0; i < Number(values.drivers); i++) drivers.push(await user('DRIVER', i));
const passengers = [];
for (let i = 0; i < Number(values.passengers); i++) passengers.push(await user('PASSENGER', i));

writeFileSync(values.out, JSON.stringify({ run, drivers, passengers }));
console.log(
  `Listo: ${drivers.length} conductores y ${passengers.length} pasajeros (lote ${run}) en ${values.out}.`,
);
console.log(`Los tokens caducan en ${env.ACCESS_TOKEN_TTL_SECONDS / 60} min.`);
await prisma.$disconnect();
