import type { AdminDriverDetail, DriverDocument, RevealableDriverField } from '@rideapp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { StatusBadge } from '../components/StatusBadge';
import { api, apiUrl } from '../lib/api';
import {
  AVAILABILITY_LABEL,
  CATEGORY_LABEL,
  DOCUMENT_LABEL,
  errorMessage,
  formatBytes,
  formatDate,
} from '../lib/labels';

/** Dato enmascarado con botón "Mostrar": cada revelado queda en auditoría (11.1, paso 6). */
function Revealable({
  driverId,
  field,
  masked,
}: {
  driverId: string;
  field: RevealableDriverField;
  masked: string | null;
}) {
  const reveal = useMutation({ mutationFn: () => api.admin.drivers.reveal(driverId, field) });
  if (!masked) return <>—</>;
  if (reveal.isSuccess) return <span className="mono">{reveal.data.value ?? '—'}</span>;
  return (
    <span className="inline">
      <span className="mono">{masked}</span>
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

/** Documentos con URL firmada de 5 min. Las imágenes se ven aquí; los PDF se descargan (14.7). */
function Documents({ driver }: { driver: AdminDriverDetail }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const open = useMutation({
    mutationFn: async (doc: DriverDocument) => {
      const signed = await api.admin.drivers.documentUrl(driver.userId, doc.id);
      return { doc, url: apiUrl(signed.path) };
    },
    onSuccess: ({ doc, url }) => {
      if (doc.mime === 'application/pdf') {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      setPreview({ url, title: DOCUMENT_LABEL[doc.type] });
      dialog.current?.showModal();
    },
  });

  return (
    <section className="card">
      <h2>Documentos</h2>
      {driver.documents.length === 0 ? (
        <p className="muted">Aún no ha subido documentos.</p>
      ) : (
        <ul className="list">
          {driver.documents.map((doc) => (
            <li key={doc.id} className="list__item">
              <div>
                <strong>{DOCUMENT_LABEL[doc.type]}</strong>
                <span className="cell-sub">
                  {doc.mime === 'application/pdf' ? 'PDF' : 'Imagen'} · {formatBytes(doc.sizeBytes)}{' '}
                  · {formatDate(doc.createdAt)}
                </span>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={open.isPending}
                onClick={() => open.mutate(doc)}
              >
                {doc.mime === 'application/pdf' ? 'Descargar' : 'Ver'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {driver.missing.documents.length > 0 && (
        <p className="muted">
          Faltan: {driver.missing.documents.map((t) => DOCUMENT_LABEL[t]).join(', ')}.
        </p>
      )}
      {open.isError && (
        <p className="form__error" role="alert">
          {errorMessage(open.error)}
        </p>
      )}
      <dialog ref={dialog} className="viewer" onClose={() => setPreview(null)}>
        {preview && (
          <>
            <header className="viewer__header">
              <strong>{preview.title}</strong>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => dialog.current?.close()}
              >
                Cerrar
              </button>
            </header>
            <img src={preview.url} alt={preview.title} className="viewer__img" />
          </>
        )}
      </dialog>
    </section>
  );
}

type Decision = 'reject' | 'suspend';

/** Aprobar, rechazar, suspender o reactivar según el estado (8.4, paso 4). */
function Actions({ driver }: { driver: AdminDriverDetail }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const id = driver.userId;

  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reactivate' | Decision) => {
      switch (action) {
        case 'approve':
          return api.admin.drivers.approve(id);
        case 'reactivate':
          return api.admin.drivers.reactivate(id);
        case 'reject':
          return api.admin.drivers.reject(id, reason.trim());
        case 'suspend':
          return api.admin.drivers.suspend(id, reason.trim());
      }
    },
    onSuccess: async () => {
      setAsking(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const reviewable = driver.status === 'PENDING' && driver.submitted;
  const complete = !driver.missing.vehicle && driver.missing.documents.length === 0;

  const submitReason = (e: FormEvent) => {
    e.preventDefault();
    if (asking) decide.mutate(asking);
  };

  if (asking) {
    return (
      <form className="card form" onSubmit={submitReason}>
        <h2>{asking === 'reject' ? 'Rechazar solicitud' : 'Suspender conductor'}</h2>
        <label>
          Motivo (lo verá el conductor)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={5}
            maxLength={500}
            required
            rows={3}
          />
        </label>
        <div className="actions">
          <button
            type="submit"
            className="btn btn--danger"
            disabled={decide.isPending || reason.trim().length < 5}
          >
            {asking === 'reject' ? 'Rechazar' : 'Suspender'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setAsking(null)}>
            Cancelar
          </button>
        </div>
        {decide.isError && (
          <p className="form__error" role="alert">
            {errorMessage(decide.error)}
          </p>
        )}
      </form>
    );
  }

  if (!reviewable && driver.status !== 'APPROVED' && driver.status !== 'SUSPENDED') {
    return (
      <section className="card card--muted">
        <p>
          {driver.status === 'REJECTED'
            ? 'Rechazado. Podrá revisarse de nuevo cuando el conductor corrija y reenvíe.'
            : 'El conductor aún no ha enviado su solicitud.'}
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Decisión</h2>
      <div className="actions">
        {reviewable && (
          <>
            <button
              type="button"
              className="btn"
              disabled={decide.isPending || !complete}
              onClick={() => decide.mutate('approve')}
            >
              Aprobar
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setAsking('reject')}>
              Rechazar…
            </button>
          </>
        )}
        {driver.status === 'APPROVED' && (
          <button type="button" className="btn btn--ghost" onClick={() => setAsking('suspend')}>
            Suspender…
          </button>
        )}
        {driver.status === 'SUSPENDED' && (
          <button
            type="button"
            className="btn"
            disabled={decide.isPending}
            onClick={() => decide.mutate('reactivate')}
          >
            Reactivar
          </button>
        )}
      </div>
      {reviewable && !complete && <p className="muted">Faltan datos: no se puede aprobar.</p>}
      {decide.isError && (
        <p className="form__error" role="alert">
          {errorMessage(decide.error)}
        </p>
      )}
    </section>
  );
}

export function DriverDetail() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['admin', 'drivers', 'detail', id],
    queryFn: () => api.admin.drivers.detail(id),
  });
  const driver = query.data;

  return (
    <>
      <header className="page-header">
        <Link to="/drivers" className="back">
          ← Conductores
        </Link>
        {driver ? (
          <div className="title-row">
            <h1>{driver.fullName}</h1>
            <StatusBadge status={driver.status} submitted={driver.submitted} />
          </div>
        ) : (
          <h1>Conductor</h1>
        )}
      </header>

      {query.isPending && <p className="muted">Cargando…</p>}
      {query.isError && (
        <p className="form__error" role="alert">
          {errorMessage(query.error)}
        </p>
      )}

      {driver && (
        <div className="detail-grid">
          <div className="stack">
            {driver.statusReason && (
              <section className="card card--notice">
                <strong>
                  {driver.status === 'SUSPENDED' ? 'Motivo de la suspensión' : 'Motivo del rechazo'}
                </strong>
                <p>{driver.statusReason}</p>
              </section>
            )}
            <section className="card">
              <h2>Datos</h2>
              <dl className="facts">
                <dt>Email</dt>
                <dd>
                  {driver.email ?? '—'} {driver.emailVerified ? '(verificado)' : '(sin verificar)'}
                </dd>
                <dt>Teléfono</dt>
                <dd>
                  <Revealable driverId={driver.userId} field="phone" masked={driver.phoneMasked} />
                </dd>
                <dt>Licencia</dt>
                <dd>
                  <Revealable
                    driverId={driver.userId}
                    field="licenseNumber"
                    masked={driver.licenseMasked}
                  />
                </dd>
                <dt>Disponibilidad</dt>
                <dd>{AVAILABILITY_LABEL[driver.availability]}</dd>
                <dt>Registro</dt>
                <dd>{formatDate(driver.createdAt)}</dd>
                <dt>Enviado a revisión</dt>
                <dd>{formatDate(driver.submittedAt)}</dd>
                <dt>Última revisión</dt>
                <dd>{formatDate(driver.reviewedAt)}</dd>
              </dl>
            </section>
            <section className="card">
              <h2>Vehículos</h2>
              {driver.vehicles.length === 0 ? (
                <p className="muted">Sin vehículos.</p>
              ) : (
                <ul className="list">
                  {driver.vehicles.map((v) => (
                    <li key={v.id} className="list__item">
                      <div>
                        <span className="plate">{v.plate}</span>{' '}
                        <strong>
                          {v.brand} {v.model}
                        </strong>
                        <span className="cell-sub">
                          {CATEGORY_LABEL[v.category]} · {v.color} · {v.year}
                        </span>
                      </div>
                      {v.active && <span className="badge badge--approved">Activo</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <div className="stack">
            <Actions driver={driver} />
            <Documents driver={driver} />
          </div>
        </div>
      )}
    </>
  );
}
