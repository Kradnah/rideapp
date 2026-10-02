import type { Me } from '@rideapp/contracts';

export interface MockUser extends Me {
  password: string | null;
}
