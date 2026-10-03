import type { Me } from '@rideapp/contracts';

export interface MockUser extends Omit<Me, 'hasPassword'> {
  password: string | null;
}
