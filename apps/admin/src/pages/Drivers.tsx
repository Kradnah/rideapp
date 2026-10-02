import type { DriverStatus } from '@rideapp/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { StatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import { CATEGORY_LABEL, errorMessage, formatDate } from '../lib/labels';

const TABS: { status: DriverStatus | 'ALL'; label: string }[] = [
  { status: 'PENDING', label: 'Por revisar' },
  { status: 'APPROVED', label: 'Aprobados' },
  { status: 'REJECTED', label: 'Rechazados' },
  { status: 'SUSPENDED', label: 'Suspendidos' },
  { status: 'ALL', label: 'Todos' },
];

/** Conductores (11.1, paso 5): la pestaña por defecto es la cola de revisión, el más antiguo primero. */
export function Drivers() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.status === params.get('status'))?.status ?? 'PENDING';

  const query = useInfiniteQuery({
    queryKey: ['admin', 'drivers', 'list', tab],
    queryFn: ({ pageParam }) =>
      api.admin.drivers.list({
        status: tab === 'ALL' ? undefined : tab,
        cursor: pageParam ?? undefined,
        limit: 25,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <header className="page-header">
        <h1>Conductores</h1>
        <p>Revisa los documentos y aprueba o rechaza cada solicitud.</p>
      </header>

      <div className="tabs" role="tablist" aria-label="Estado">
        {TABS.map((t) => (
          <button
            key={t.status}
            type="button"
            role="tab"
            aria-selected={t.status === tab}
            className="tab"
            onClick={() => setParams(t.status === 'PENDING' ? {} : { status: t.status })}
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
            {tab === 'PENDING' ? 'No hay solicitudes por revisar.' : 'No hay conductores aquí.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Conductor</th>
                  <th scope="col">Vehículo</th>
                  <th scope="col">Documentos</th>
                  <th scope="col">{tab === 'PENDING' ? 'Enviado' : 'Registro'}</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.userId}>
                    <td>
                      <Link to={`/drivers/${d.userId}`} className="row-link">
                        {d.fullName}
                      </Link>
                      <span className="cell-sub">{d.email ?? '—'}</span>
                    </td>
                    <td>
                      {d.vehicle ? (
                        <>
                          <span className="plate">{d.vehicle.plate}</span>
                          <span className="cell-sub">{CATEGORY_LABEL[d.vehicle.category]}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{d.documentCount} / 3</td>
                    <td>{formatDate(tab === 'PENDING' ? d.submittedAt : d.createdAt)}</td>
                    <td>
                      <StatusBadge status={d.status} submitted={d.submittedAt !== null} />
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
