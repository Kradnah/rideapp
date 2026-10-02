import type { UserRole, UserStatus } from '@rideapp/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { UserStatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import { errorMessage, formatDate, formatRating, ROLE_LABEL } from '../lib/labels';

const ROLES: { role: UserRole | 'ALL'; label: string }[] = [
  { role: 'ALL', label: 'Todos' },
  { role: 'PASSENGER', label: 'Pasajeros' },
  { role: 'DRIVER', label: 'Conductores' },
  { role: 'ADMIN', label: 'Administradores' },
];

/** Usuarios (11.1, paso 6): búsqueda por nombre o email y filtros por rol y estado. */
export function Users() {
  const [params, setParams] = useSearchParams();
  const role = ROLES.find((r) => r.role === params.get('role'))?.role ?? 'ALL';
  const status = params.get('status') === 'SUSPENDED' ? ('SUSPENDED' as UserStatus) : undefined;
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);

  const update = (next: Record<string, string | undefined>) => {
    const merged = { role: role === 'ALL' ? undefined : role, status, q: q || undefined, ...next };
    setParams(
      Object.fromEntries(Object.entries(merged).filter(([, v]) => v)) as Record<string, string>,
    );
  };

  const query = useInfiniteQuery({
    queryKey: ['admin', 'users', 'list', role, status, q],
    queryFn: ({ pageParam }) =>
      api.admin.users.list({
        role: role === 'ALL' ? undefined : role,
        status,
        q: q.length >= 2 ? q : undefined,
        cursor: pageParam ?? undefined,
        limit: 25,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const search = (e: FormEvent) => {
    e.preventDefault();
    update({ q: draft.trim() || undefined });
  };

  return (
    <>
      <header className="page-header">
        <h1>Usuarios</h1>
        <p>Pasajeros, conductores y administradores. El teléfono se muestra enmascarado.</p>
      </header>

      <form className="toolbar" role="search" onSubmit={search}>
        <input
          type="search"
          aria-label="Buscar por nombre o email"
          placeholder="Buscar por nombre o email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          minLength={2}
          maxLength={100}
        />
        <button type="submit" className="btn btn--small">
          Buscar
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={status === 'SUSPENDED'}
            onChange={(e) => update({ status: e.target.checked ? 'SUSPENDED' : undefined })}
          />
          Solo suspendidos
        </label>
      </form>

      <div className="tabs" role="tablist" aria-label="Rol">
        {ROLES.map((r) => (
          <button
            key={r.role}
            type="button"
            role="tab"
            aria-selected={r.role === role}
            className="tab"
            onClick={() => update({ role: r.role === 'ALL' ? undefined : r.role })}
          >
            {r.label}
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
          <p className="muted pad">No hay usuarios con estos filtros.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Usuario</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Calificación</th>
                  <th scope="col">Registro</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link to={`/users/${u.id}`} className="row-link">
                        {u.fullName}
                      </Link>
                      <span className="cell-sub">{u.email ?? '—'}</span>
                    </td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td className="num">
                      {formatRating(u.rating.average)}
                      {u.rating.count > 0 && (
                        <span className="cell-sub">{u.rating.count} votos</span>
                      )}
                    </td>
                    <td>{formatDate(u.createdAt)}</td>
                    <td>
                      <UserStatusBadge status={u.status} />
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
