# api-client

Cliente HTTP y socket tipado sobre `@rideapp/contracts`. Lo usan el admin y las apps móviles.

- Valida cada respuesta con su esquema: si el servidor se sale del contrato, falla con `INVALID_RESPONSE`.
- Ante un `401` refresca la sesión **una sola vez** aunque haya varias peticiones a la vez, y reintenta (9.1).
- Errores como `ApiClientError` con el `code` del contrato (`NETWORK_ERROR` si no hay conexión).
- Compatible con Hermes: no usa `URLSearchParams` ni `AbortSignal.timeout/any`.
- `createRealtime` envía el token en el handshake (nunca en la URL) y lo vuelve a pedir en cada reconexión.

Los tests de contrato corren contra el mock-server real.
