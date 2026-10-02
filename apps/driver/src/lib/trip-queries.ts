/** Claves de TanStack Query de los viajes del conductor (el socket las invalida). */
export const TRIPS_KEY = ['trips'] as const;
export const activeTripKey = ['trips', 'active'] as const;
export const tripKey = (id: string) => ['trips', id] as const;
