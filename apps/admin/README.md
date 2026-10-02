# admin

Panel de administración (React 19 + Vite + React Router 7 + TanStack Query). Ver secciones 7.7 y 11 del plan.

```bash
pnpm --filter @rideapp/mock-server dev   # o el API real en :3000 con DEV_API_TARGET
pnpm --filter @rideapp/admin dev         # http://127.0.0.1:5173
```

- `/api` va al backend por el proxy de Vite (en producción, por Traefik): mismo origen, para la cookie `__Host-` del admin (11.2).
- Sin `VITE_GOOGLE_MAPS_KEY` el mapa muestra un aviso. Ver `.env.example`.
- Imagen: `docker build -f apps/admin/Dockerfile -t rideapp-admin .` → nginx con CSP y cabeceras en `nginx/`.
- React Router 7 (no 8): la 8 exige React ≥ 19.2.7 y Expo SDK 57 fija React 19.2.3. El monorepo debe tener una sola copia de React.
