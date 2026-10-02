import type { SelfAssignableRole } from '@rideapp/contracts';

export const APP_IDENTITY = {
  appName: 'rideapp Conductor',
  tagline: 'Conduce cuando quieras y gana en tu ciudad.',
  role: 'DRIVER' satisfies SelfAssignableRole,
} as const;
