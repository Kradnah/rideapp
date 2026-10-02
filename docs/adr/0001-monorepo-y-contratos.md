# ADR 0001 — Monorepo con pnpm + Turborepo y contratos Zod compartidos

- **Fecha:** 2026-10-01
- **Estado:** aceptada

## Contexto

API, panel y dos apps móviles comparten contratos (DTOs, eventos socket, enums). Si cada uno define sus tipos por separado, un cambio de contrato se rompe en producción en vez de en la compilación.

## Decisión

- Un solo repositorio con `pnpm` workspaces y Turborepo (`node-linker=hoisted` por React Native/Metro).
- `packages/contracts` contiene los esquemas Zod; todo lo demás importa de ahí. Se compila a ESM (`NodeNext`).
- TypeScript fijado en **6.0.x**: `typescript-eslint` 8.71 declara `typescript <6.1.0` y TS 7 aún no expone la API de JS que usan Nest CLI y las herramientas de lint (1.1 del plan).

## Consecuencias

- Cambiar un contrato obliga a actualizar backend y clientes en el mismo commit.
- Las apps Expo deben configurar Metro para resolver paquetes del workspace.
