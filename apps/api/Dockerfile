# syntax=docker/dockerfile:1
# Imagen del API (13.5 D). Se construye con contexto en la raíz del monorepo:
#   docker build -f apps/api/Dockerfile -t rideapp-api .

FROM node:24-alpine AS build
RUN npm i -g pnpm@12.8.1
WORKDIR /repo
COPY . .
# Solo el API y sus dependencias del workspace (no instala las apps Expo).
RUN pnpm install --frozen-lockfile --filter "@rideapp/api..."
RUN pnpm turbo run build --filter "@rideapp/api..."
# Copia el API con sus dependencias de producción (contracts incluido) a /out.
# El campo "files" de apps/api/package.json limita lo que se copia.
RUN pnpm --filter @rideapp/api deploy --prod /out

FROM node:24-alpine
# El motor de migraciones de Prisma necesita OpenSSL.
RUN apk add --no-cache openssl
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migraciones antes de arrancar (válido con una sola réplica). `exec` para que node reciba SIGTERM.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node --max-old-space-size=512 dist/main.js"]
