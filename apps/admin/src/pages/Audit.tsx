import { useInfiniteQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { AUDIT_ACTION_LABEL, errorMessage, formatDate } from '../lib/labels';

const PREFIXES = [
  { value: '', label: 'Todo' },
  { value: 'admin.', label: 'Acciones de admins' },
  { value: 'auth.', label: 'Accesos' },
  { value: 'payment.', label: 'Pagos' },
] as const;

/** Enlace a la entidad, si el panel tiene una página para ella. */
function entityLink(entity: string, id: string | null): string | null {
  if (!id) return null;
  if (entity === 'user') return `/users/${id}`;
  if (entity === 'driver') return `/drivers/${id}`;
  if (entity === 'trip') return `/trips/${id}`;
  return null;
}

/**
 * Auditoría (11.1, paso 9): solo lectura. `meta` se muestra como texto (JSON), nunca como HTML:
 * React lo escapa.
 */
export function Audit() {
  const [params, setParams] = useSearchParams();
  const action = params.get('action') ?? '';
  const entityId = params.get('entityId') ?? '';
  const [draft, setDraft] = useState(entityId);

  const set = (next: Record<string, string>) => {
    const merged = { action, entityId, ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)));
  };

  const query = useInfiniteQuery({
    queryKey: ['admin', 'audit', action, entityId],
    queryFn: ({ pageParam }) =>
      api.admin.audit.list({
        action: action || undefined,
        entityId: entityId || undefined,
        cursor: pageParam ?? undefined,
        limit: 50,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const filterEntity = (e: FormEvent) => {
    e.preventDefault();
    set({ entityId: draft.trim() });
  };

  return (
    <>
      <header className="page-header">
        <h1>Auditoría</h1>
        <p>Accesos, decisiones de los admins, datos revelados y cobros. Solo lectura.</p>
      </header>

      <form className="toolbar" onSubmit={filterEntity}>
        <input
          aria-label="ID de la entidad"
          placeholder="ID de usuario, conductor o viaje"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={64}
        />
        <button type="submit" className="btn btn--small">
          Filtrar
        </button>
        {entityId && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              setDraft('');
              set({ entityId: '' });
            }}
          >
            Quitar filtro
          </button>
        )}
      </form>

      <div className="tabs" role="tablist" aria-label="Tipo">
        {PREFIXES.map((p) => (
          <button
            key={p.value}
            type="button"
            role="tab"
            aria-selected={p.value === action}
            className="tab"
            onClick={() => set({ action: p.value })}
          >
            {p.label}
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
          <p className="muted pad">Sin registros.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Cuándo</th>
                  <th scope="col">Quién</th>
                  <th scope="col">Acción</th>
                  <th scope="col">Sobre</th>
                  <th scope="col">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const link = entityLink(r.entity, r.entityId);
                  return (
                    <tr key={r.id}>
                      <td>
                        {formatDate(r.at)}
                        {r.ip && <span className="cell-sub mono">{r.ip}</span>}
                      </td>
                      <td>
                        {r.actorId ? (
                          <Link to={`/users/${r.actorId}`} className="row-link">
                            {r.actorName ?? 'Usuario eliminado'}
                          </Link>
                        ) : (
                          <span className="muted">Sistema</span>
                        )}
                      </td>
                      <td>
                        {AUDIT_ACTION_LABEL[r.action] ?? r.action}
                        <span className="cell-sub mono">{r.action}</span>
                      </td>
                      <td>
                        {r.entity}
                        {r.entityId &&
                          (link ? (
                            <Link to={link} className="cell-sub mono">
                              {r.entityId.slice(0, 8)}…
                            </Link>
                          ) : (
                            <span className="cell-sub mono">{r.entityId.slice(0, 8)}…</span>
                          ))}
                      </td>
                      <td>
                        {r.meta !== null && r.meta !== undefined && (
                          <code className="meta">{JSON.stringify(r.meta)}</code>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
