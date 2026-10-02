import type { LatLng } from '@rideapp/contracts';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

/** Un punto elegido por el pasajero: su GPS, un lugar de Places o un pin en el mapa. */
export interface DraftPlace {
  location: LatLng;
  /** Texto para mostrar; null si aún no se conoce (se pide al confirmar). */
  address: string | null;
  placeId?: string;
}

interface TripDraft {
  origin: DraftPlace | null;
  destination: DraftPlace | null;
  setOrigin: (place: DraftPlace | null) => void;
  setDestination: (place: DraftPlace | null) => void;
}

const TripDraftContext = createContext<TripDraft | null>(null);

/** Recogida y destino mientras el pasajero arma el viaje (buscar → mapa → confirmar). */
export function TripDraftProvider({ children }: { children: ReactNode }) {
  const [origin, setOrigin] = useState<DraftPlace | null>(null);
  const [destination, setDestination] = useState<DraftPlace | null>(null);
  const value = useMemo(
    () => ({ origin, destination, setOrigin, setDestination }),
    [origin, destination],
  );
  return <TripDraftContext.Provider value={value}>{children}</TripDraftContext.Provider>;
}

export function useTripDraft(): TripDraft {
  const ctx = useContext(TripDraftContext);
  if (!ctx) throw new Error('useTripDraft fuera de TripDraftProvider');
  return ctx;
}
