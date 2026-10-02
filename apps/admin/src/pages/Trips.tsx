import type { AdminTripFilter } from '@rideapp/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { TripStatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import { CATEGORY_LABEL, errorMessage, formatDate, formatMoney } from '../lib/labels';

const TABS: { filter: AdminTripFilter | 'ALL'; label: string }[] = [
  { filter: 'ACTIVE', label: 'En curso' },
  { filter: 'COMPLETED', label: 'Completados' },
  { filter: 'CANCELLED', label: 'Cancelados' },
  { filter: 'NO_DRIVERS', label: 'Sin conductores' },
  { filter: 'ALL', label: 'Todos' },
];

/** Viajes (11.1, paso 7): por defecto los que están en curso, el más reciente primero. */
export function Trips() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.filter === params.get('status'))?.filter ?? 'ACTIVE';

  const query = useInfiniteQuery({
    queryKey: ['admin', 'trips', 'list', tab],
    queryFn: ({ pageParam }) =>
      api.admin.trips.list({
        status: tab === 'ALL' ? undefined : tab,
        cursor: pageParam ?? undefined,
        limit: 25,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Los viajes en curso cambian solos: se refrescan cada 15 s.
    refetchInterval: tab === 'ACTIVE' ? 15_000 : false,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <header className="page-header">
        <h1>Viajes</h1>
        <p>Solicitudes, asignaciones y su línea de tiempo.</p>
      </header>

      <div className="tabs" role="tablist" aria-label="Estado">
        {TABS.map((t) => (
          <button
            key={t.filter}
            type="button"
            role="tab"
            aria-selected={t.filter === tab}
            className="tab"
            onClick={() => setParams(t.filter === 'ACTIVE' ? {} : { status: t.filter })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section className="card card--flush" role="tabpanel">
        {query.isPending ? (
          <p className="muted pad">Cargando…</p>
        ) : query.isError ? (
          <p className="form__error pad" role="alert">
            {errorMessage(query.error)}
          </p>
        ) : rows.length === 0 ? (
          <p className="muted pad">
            {tab === 'ACTIVE' ? 'No hay viajes en curso.' : 'No hay viajes aquí.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Pedido</th>
                  <th scope="col">Pasajero</th>
                  <th scope="col">Conductor</th>
                  <th scope="col">Trayecto</th>
                  <th scope="col" className="num">
                    Precio
                  </th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((trip) => (
                  <tr key={trip.id}>
                    <td>
                      <Link to={`/trips/${trip.id}`} className="row-link">
                        {formatDate(trip.requestedAt)}
                      </Link>
                      <span className="cell-sub">{CATEGORY_LABEL[trip.category]}</span>
                    </td>
                    <td>{trip.passengerName}</td>
                    <td>{trip.driverName ?? '—'}</td>
                    <td>
                      <span className="clamp">{trip.originAddress ?? 'Punto en el mapa'}</span>
                      <span className="cell-sub clamp">
                        → {trip.destinationAddress ?? 'Punto en el mapa'}
                      </span>
                    </td>
                    <td className="num">{formatMoney(trip.amount)}</td>
                    <td>
                      <TripStatusBadge status={trip.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.hasNextPage && (
          <div className="pad">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
