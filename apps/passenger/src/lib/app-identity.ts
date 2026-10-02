import type { SelfAssignableRole } from '@rideapp/contracts';

export const APP_IDENTITY = {
  appName: 'rideapp',
  tagline: 'Tu viaje seguro por la ciudad, en minutos.',
  role: 'PASSENGER' satisfies SelfAssignableRole,
} as const;
