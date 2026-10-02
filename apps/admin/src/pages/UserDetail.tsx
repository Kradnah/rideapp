import type { AdminUserDetail } from '@rideapp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { UserStatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import { errorMessage, formatDate, formatRating, ROLE_LABEL } from '../lib/labels';

/** Teléfono enmascarado con "Mostrar": el revelado queda en auditoría (11.1, paso 6). */
function Phone({ user }: { user: AdminUserDetail }) {
  const reveal = useMutation({ mutationFn: () => api.admin.users.revealPhone(user.id) });
  if (!user.phoneMasked) return <>—</>;
  if (reveal.isSuccess) return <span className="mono">{reveal.data.value ?? '—'}</span>;
  return (
    <span className="inline">
      <span className="mono">{user.phoneMasked}</span>
      <button
        type="button"
        className="link-btn"
        disabled={reveal.isPending}
        onClick={() => reveal.mutate()}
        title="Queda registrado en la auditoría"
      >
        Mostrar
      </button>
      {reveal.isError && <span className="form__error">{errorMessage(reveal.error)}</span>}
    </span>
  );
}

/** Suspender (con motivo) o reactivar. Los admins se gestionan por CLI. */
function Actions({ user }: { user: AdminUserDetail }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: (action: 'suspend' | 'reactivate') =>
      action === 'suspend'
        ? api.admin.users.suspend(user.id, reason.trim())
        : api.admin.users.reactivate(user.id),
    onSuccess: () => {
      setAsking(false);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  if (user.role === 'ADMIN') {
    return (
      <section className="card card--muted">
        <p>Los administradores se crean y gestionan con la CLI del API.</p>
      </section>
    );
  }

  if (asking) {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      act.mutate('suspend');
    };
    return (
      <form className="card form" onSubmit={submit}>
        <h2>Suspender cuenta</h2>
        <p className="muted">
          Se cierran todas sus sesiones y no podrá volver a entrar hasta que la reactives.
          {user.role === 'DRIVER' && ' Si está en línea, sale de línea al instante.'}
        </p>
        <label>
          Motivo (queda en la auditoría)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            minLength={5}
            maxLength={500}
            required
          />
        </label>
        <div className="actions">
          <button
            type="submit"
            className="btn btn--danger"
            disabled={act.isPending || reason.trim().length < 5}
          >
            Suspender
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setAsking(false)}>
            Cancelar
          </button>
        </div>
        {act.isError && (
          <p className="form__error" role="alert">
            {errorMessage(act.error)}
          </p>
        )}
      </form>
    );
  }

  return (
    <section className="card">
      <h2>Cuenta</h2>
      <div className="actions">
        {user.status === 'ACTIVE' && (
          <button type="button" className="btn btn--ghost" onClick={() => setAsking(true)}>
            Suspender…
          </button>
        )}
        {user.status === 'SUSPENDED' && (
          <button
            type="button"
            className="btn"
            disabled={act.isPending}
            onClick={() => act.mutate('reactivate')}
          >
            Reactivar
          </button>
        )}
        {user.role === 'DRIVER' && (
          <Link to={`/drivers/${user.id}`} className="btn btn--ghost">
            Ver como conductor
          </Link>
        )}
        <Link to={`/audit?entityId=${user.id}`} className="btn btn--ghost">
          Ver su auditoría
        </Link>
      </div>
      {act.isError && (
        <p className="form__error" role="alert">
          {errorMessage(act.error)}
        </p>
      )}
    </section>
  );
}

export function UserDetail() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['admin', 'users', 'detail', id],
    queryFn: () => api.admin.users.detail(id),
  });
  const user = query.data;

  return (
    <>
      <header className="page-header">
        <Link to="/users" className="back">
          ← Usuarios
        </Link>
        {user ? (
          <div className="title-row">
            <h1>{user.fullName}</h1>
            <UserStatusBadge status={user.status} />
          </div>
        ) : (
          <h1>Usuario</h1>
        )}
      </header>

      {query.isPending && <p className="muted">Cargando…</p>}
      {query.isError && (
        <p className="form__error" role="alert">
          {errorMessage(query.error)}
        </p>
      )}

      {user && (
        <div className="detail-grid">
          <div className="stack">
            {user.statusReason && (
              <section className="card card--notice">
                <strong>Motivo de la suspensión</strong>
                <p>{user.statusReason}</p>
              </section>
            )}
            <section className="card">
              <h2>Datos</h2>
              <dl className="facts">
                <dt>Rol</dt>
                <dd>{ROLE_LABEL[user.role]}</dd>
                <dt>Email</dt>
                <dd>
                  {user.email ?? '—'} {user.emailVerified ? '(verificado)' : '(sin verificar)'}
                </dd>
                <dt>Teléfono</dt>
                <dd>
                  <Phone user={user} />
                </dd>
                <dt>Entra con</dt>
                <dd>{user.providers.join(', ') || '—'}</dd>
                <dt>Calificación</dt>
                <dd>
                  {formatRating(user.rating.average)}
                  {user.rating.count > 0 && ` (${user.rating.count} votos)`}
                </dd>
                <dt>Viajes</dt>
                <dd>
                  {user.trips.completed} completados · {user.trips.cancelled} cancelados
                </dd>
                <dt>Sesiones abiertas</dt>
                <dd>{user.activeSessions}</dd>
                <dt>Registro</dt>
                <dd>{formatDate(user.createdAt)}</dd>
              </dl>
            </section>
          </div>
          <div className="stack">
            <Actions user={user} />
            <section className="card">
              <h2>Autorizaciones de datos</h2>
              {user.consents.length === 0 ? (
                <p className="muted">Sin registros.</p>
              ) : (
                <ul className="list">
                  {user.consents.map((c) => (
                    <li key={`${c.policyVersion}-${c.acceptedAt}`} className="list__item">
                      <div>
                        <strong>Política {c.policyVersion}</strong>
                        <span className="cell-sub">
                          {formatDate(c.acceptedAt)} · {c.channel}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
