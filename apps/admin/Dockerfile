# syntax=docker/dockerfile:1
# Panel admin (13.5 D). Contexto en la raíz del monorepo:
#   docker build -f apps/admin/Dockerfile --build-arg VITE_GOOGLE_MAPS_KEY=... -t rideapp-admin .

FROM node:24-alpine AS build
RUN npm i -g pnpm@12.8.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@rideapp/admin..."
# Las VITE_* quedan dentro del bundle: son públicas (la clave de Maps va restringida por referente).
ARG VITE_API_URL=/api
ARG VITE_GOOGLE_MAPS_KEY=
ENV VITE_API_URL=$VITE_API_URL VITE_GOOGLE_MAPS_KEY=$VITE_GOOGLE_MAPS_KEY
RUN pnpm turbo run build --filter "@rideapp/admin..."

FROM nginx:1.29-alpine
# Parches de Alpine al construir (la etiqueta de nginx tarda en recogerlos; Trivy, 14.1). curl no se
# usa en el contenedor: fuera.
RUN apk upgrade --no-cache && apk del --no-cache curl
COPY apps/admin/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY apps/admin/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
