// Prueba de carga de rideapp (sección 16): 500 conductores enviando GPS cada 5 s por Socket.IO y
// 50 solicitudes de viaje por minuto. Mide la latencia p95 del ack de ubicación y de la API.
//
// Uso (ver infra/load/README.md):
//   docker run --rm -i --network host -v "$PWD/infra/load:/load" grafana/k6 run \
//     -e API=http://127.0.0.1:3000 -e FIXTURES=/load/fixtures.json /load/rideapp-load.js
//
// k6 no trae cliente de Socket.IO: se habla el protocolo de Engine.IO v4 sobre WebSocket a mano
// ("40{auth}" para entrar, "42<id>[evento, datos]" para emitir con ack, "2"/"3" para el ping).

/* global __ENV, __VU, __ITER, open -- globales del entorno de k6 */
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';
import ws from 'k6/ws';

const API = __ENV.API || 'http://127.0.0.1:3000';
const DRIVERS = Number(__ENV.DRIVERS || 500);
const DURATION = __ENV.DURATION || '5m';
const fixtures = JSON.parse(open(__ENV.FIXTURES || './fixtures.json'));

const locationAck = new Trend('location_ack_ms', true);
const locationRejected = new Counter('location_rejected');
const offersReceived = new Counter('offers_received');
const tripsCreated = new Counter('trips_created');

export const options = {
  scenarios: {
    drivers: {
      executor: 'per-vu-iterations',
      vus: DRIVERS,
      iterations: 1,
      maxDuration: '10m',
      exec: 'driver',
    },
    trips: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1m',
      duration: DURATION,
      preAllocatedVUs: 20,
      exec: 'passenger',
      startTime: '30s', // primero se conectan los conductores (en 20 s)
    },
  },
  thresholds: {
    location_ack_ms: ['p(95)<250'],
    'http_req_duration{name:quote}': ['p(95)<800'],
    'http_req_duration{name:create}': ['p(95)<800'],
    http_req_failed: ['rate<0.02'],
  },
};

// Zona de Girardot (dentro del área de servicio).
const CENTER = { lat: 4.3035, lng: -74.8036 };
const jitter = (spread) => (Math.random() - 0.5) * spread;
/** IP distinta por usuario: con TRUST_PROXY=true el límite por IP se reparte como en la vida real. */
const fakeIp = (i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
const wsUrl = `${API.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;

export function driver() {
  // __VU es global entre escenarios: el índice de iteración del escenario es único (0..N-1).
  const idx = exec.scenario.iterationInTest % fixtures.drivers.length;
  const me = fixtures.drivers[idx];
  // Sin content-type: estas peticiones no llevan cuerpo (JSON vacío sería un 400).
  const headers = {
    authorization: `Bearer ${me.token}`,
    'x-forwarded-for': fakeIp(idx + 1),
  };
  // Entrada escalonada en 20 s: 500 conexiones TCP en el mismo milisegundo desbordan el proxy de
  // Docker Desktop (connection refused) y no se parecen a conductores reales.
  sleep(Math.random() * 20);
  const online = http.post(`${API}/api/drivers/me/online`, null, {
    headers,
    tags: { name: 'online' },
  });
  check(online, { 'en línea': (r) => r.status === 200 });

  // Cada conductor da vueltas alrededor de un punto propio.
  const home = { lat: CENTER.lat + jitter(0.03), lng: CENTER.lng + jitter(0.03) };
  let step = 0;
  let ackId = 0;
  const sentAt = {};
  const durationMs = parseDuration(DURATION) + 60_000;

  ws.connect(wsUrl, { headers: { 'x-forwarded-for': fakeIp(idx + 1) } }, (socket) => {
    socket.on('message', (msg) => {
      if (msg[0] === '0') {
        socket.send(`40${JSON.stringify({ token: me.token })}`);
      } else if (msg === '2') {
        socket.send('3');
      } else if (msg.startsWith('40')) {
        // Conectado al namespace: ubicación cada 5 s.
        socket.setInterval(() => {
          step++;
          const angle = step / 20;
          const payload = {
            lat: home.lat + Math.sin(angle) * 0.002,
            lng: home.lng + Math.cos(angle) * 0.002,
            heading: null,
            speed: 5,
            accuracy: 10,
            ts: Date.now(),
          };
          const id = ackId++;
          sentAt[id] = Date.now();
          socket.send(`42${id}${JSON.stringify(['driver.location.v1', payload])}`);
        }, 5_000);
      } else if (msg.startsWith('43')) {
        const id = Number(msg.slice(2, msg.indexOf('[')));
        const [res] = JSON.parse(msg.slice(msg.indexOf('[')));
        if (sentAt[id]) locationAck.add(Date.now() - sentAt[id]);
        delete sentAt[id];
        if (!res.ok) locationRejected.add(1, { code: res.code });
      } else if (msg.startsWith('42')) {
        const [event, data] = JSON.parse(msg.slice(2));
        if (event === 'trip.offer.v1') {
          offersReceived.add(1);
          // La mitad acepta y la otra rechaza: ejercita el emparejamiento en ambos sentidos.
          const action = Math.random() < 0.5 ? 'accept' : 'reject';
          http.post(`${API}/api/trips/${data.tripId}/${action}`, null, {
            headers,
            tags: { name: action },
          });
        }
      }
    });
    socket.setTimeout(() => socket.close(), durationMs);
  });
}

export function passenger() {
  const idx = Math.floor(Math.random() * fixtures.passengers.length);
  const me = fixtures.passengers[idx];
  const headers = {
    authorization: `Bearer ${me.token}`,
    'content-type': 'application/json',
    'x-forwarded-for': fakeIp(100_000 + idx),
  };
  // Si tiene un viaje activo de una vuelta anterior, se cancela primero.
  const active = http.get(`${API}/api/trips/active`, { headers, tags: { name: 'active' } });
  const current = active.status === 200 ? active.json('trip') : null;
  if (current) {
    http.post(`${API}/api/trips/${current.id}/cancel`, JSON.stringify({}), {
      headers,
      tags: { name: 'cancel' },
    });
  }

  const quote = http.post(
    `${API}/api/trips/quote`,
    JSON.stringify({
      origin: { lat: CENTER.lat + jitter(0.02), lng: CENTER.lng + jitter(0.02) },
      destination: { lat: CENTER.lat + jitter(0.03), lng: CENTER.lng + jitter(0.03) },
    }),
    { headers, tags: { name: 'quote' } },
  );
  if (!check(quote, { cotiza: (r) => r.status === 200 || r.status === 201 })) return;
  const option = quote.json('options').find((o) => o.category === 'STANDARD');
  const created = http.post(
    `${API}/api/trips`,
    JSON.stringify({ quoteId: option.quoteId, paymentMethod: 'CASH' }),
    {
      headers: { ...headers, 'idempotency-key': `load-${__VU}-${__ITER}-${Date.now()}` },
      tags: { name: 'create' },
    },
  );
  if (check(created, { 'crea el viaje': (r) => r.status === 201 })) tripsCreated.add(1);
}

function parseDuration(text) {
  const m = /^(\d+)([smh])$/.exec(text);
  if (!m) return 300_000;
  return Number(m[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[m[2]];
}
