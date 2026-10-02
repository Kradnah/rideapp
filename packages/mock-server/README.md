# mock-server

API falsa (Fastify + Socket.IO) que cumple los contratos de `@rideapp/contracts`. Permite desarrollar las apps sin backend (5.1 y 7.3).

```bash
pnpm --filter @rideapp/mock-server dev     # http://127.0.0.1:4000/api
MOCK_HOST=0.0.0.0 pnpm --filter @rideapp/mock-server dev   # para un móvil físico en la misma red
```

- Valida peticiones **y respuestas** con los esquemas Zod: si el mock devuelve algo fuera de contrato, falla.
- Sesión falsa: cualquier email registrado inicia sesión. En `/auth/google` cualquier `idToken` sirve.
- Simulador: 3 conductores recorren Girardot (`/drivers/nearby`) y cada 2 s se emite `trip.driverLocation.v1` del viaje `DEMO_TRIP_ID` a todos los sockets.
- Datos en memoria: se pierden al reiniciar.
