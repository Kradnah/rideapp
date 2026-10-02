import { ACTIVE_TRIP_STATUSES, type AdminTripDetail, type TripStatus } from '@rideapp/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ServiceAreaMap } from '../components/ServiceAreaMap';
import { TripStatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import {
  ACTOR_LABEL,
  CATEGORY_LABEL,
  errorMessage,
  formatDate,
  formatDistance,
  formatDuration,
  formatMoney,
  PAYMENT_LABEL,
  PAYMENT_STATUS_LABEL,
  TRIP_STATUS_LABEL,
} from '../lib/labels';

const isActive = (status: TripStatus) =>
  (ACTIVE_TRIP_STATUSES as readonly TripStatus[]).includes(status);
/** Con conductor asignado se sigue en vivo; buscando conductor basta con algo más lento. */
const isLive = (status: TripStatus) =>
  status === 'DRIVER_ASSIGNED' || status === 'DRIVER_ARRIVED' || status === 'IN_PROGRESS';

const time = new Intl.DateTimeFormat('es-CO', { timeStyle: 'medium' });

/** Línea de tiempo de `trip_events`: cada cambio de estado, quién lo provocó y cuándo. */
function Timeline({ trip }: { trip: AdminTripDetail }) {
  return (
    <section className="card">
      <h2>Línea de tiempo</h2>
      <ol className="timeline">
        {trip.events.map((e) => (
          <li key={`${e.toStatus}-${e.at}`} className="timeline__item">
            <span className="timeline__time">{time.format(new Date(e.at))}</span>
            <div>
              <strong>{TRIP_STATUS_LABEL[e.toStatus]}</strong>
              <span className="cell-sub">{ACTOR_LABEL[e.actor]}</span>
            </div>
          </li>
        ))}
      </ol>
      {trip.offersDeclined > 0 && (
        <p className="muted">
          {trip.offersDeclined === 1
            ? '1 conductor rechazó la oferta o la dejó caducar.'
            : `${trip.offersDeclined} conductores rechazaron la oferta o la dejaron caducar.`}
        </p>
      )}
    </section>
  );
}

/** Pago y calificaciones (Fase 5). Los comentarios son texto del usuario: React los escapa. */
function Closing({ trip }: { trip: AdminTripDetail }) {
  if (!trip.payment && trip.ratings.length === 0) return null;
  return (
    <section className="card">
      <h2>Cierre</h2>
      <dl className="facts">
        {trip.payment && (
          <>
            <dt>Pago</dt>
            <dd>
              {formatMoney(trip.payment.amount)} · {PAYMENT_LABEL[trip.payment.method]} ·{' '}
              <span
                className={`badge badge--${trip.payment.status === 'CAPTURED' ? 'approved' : 'pending'}`}
              >
                {PAYMENT_STATUS_LABEL[trip.payment.status]}
              </span>
            </dd>
            {trip.payment.paidAt && (
              <>
                <dt>Cobrado</dt>
                <dd>{formatDate(trip.payment.paidAt)}</dd>
              </>
            )}
          </>
        )}
      </dl>
      {trip.ratings.length > 0 && (
        <ul className="list">
          {trip.ratings.map((r) => (
            <li key={r.by} className="list__item">
              <div>
                <strong>
                  {r.by === 'PASSENGER'
                    ? 'El pasajero calificó al conductor'
                    : 'El conductor calificó al pasajero'}
                  : {'★'.repeat(r.score)}
                  {'☆'.repeat(5 - r.score)}
                </strong>
                {r.comment && <p className="quote">{r.comment}</p>}
                <span className="cell-sub">{formatDate(r.at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TripDetail() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['admin', 'trips', id],
    queryFn: () => api.admin.trips.detail(id),
    // Mientras el viaje sigue en curso se refresca solo; con conductor, al ritmo de su GPS.
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (!status || !isActive(status)) return false;
      return isLive(status) ? 5_000 : 10_000;
    },
  });

  if (query.isPending) return <p className="muted">Cargando…</p>;
  if (query.isError) {
    return (
      <>
        <Link to="/trips" className="back">
          ← Viajes
        </Link>
        <p className="form__error" role="alert">
          {errorMessage(query.error)}
        </p>
      </>
    );
  }
  const trip = query.data;

  return (
    <>
      <header className="page-header">
        <Link to="/trips" className="back">
          ← Viajes
        </Link>
        <div className="title-row">
          <h1>Viaje del {formatDate(trip.requestedAt)}</h1>
          <TripStatusBadge status={trip.status} />
        </div>
      </header>

      {trip.status === 'CANCELLED' && (
        <section className="card card--notice">
          <strong>
            Cancelado por {trip.cancelledBy ? ACTOR_LABEL[trip.cancelledBy].toLowerCase() : '—'}
            {trip.cancelledAt ? ` · ${formatDate(trip.cancelledAt)}` : ''}
          </strong>
          {trip.cancelReason && <p>{trip.cancelReason}</p>}
        </section>
      )}

      <div className="detail-grid">
        <div className="stack">
          <section className="card">
            <h2>Datos</h2>
            <dl className="facts">
              <dt>Pasajero</dt>
              <dd>{trip.passenger.fullName}</dd>
              <dt>Conductor</dt>
              <dd>
                {trip.driver ? (
                  <Link to={`/drivers/${trip.driver.id}`} className="row-link">
                    {trip.driver.fullName}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
              {trip.driver?.vehicle && (
                <>
                  <dt>Vehículo</dt>
                  <dd>
                    <span className="plate">{trip.driver.vehicle.plate}</span>{' '}
                    {trip.driver.vehicle.brand} {trip.driver.vehicle.model} ·{' '}
                    {trip.driver.vehicle.color}
                  </dd>
                </>
              )}
              <dt>Recogida</dt>
              <dd>{trip.originAddress ?? 'Punto en el mapa'}</dd>
              <dt>Destino</dt>
              <dd>{trip.destinationAddress ?? 'Punto en el mapa'}</dd>
              <dt>Categoría</dt>
              <dd>{CATEGORY_LABEL[trip.category]}</dd>
              <dt>Precio</dt>
              <dd>
                {formatMoney(trip.amount)} · {PAYMENT_LABEL[trip.paymentMethod]}
              </dd>
              <dt>Ruta</dt>
              <dd>
                {formatDistance(trip.distanceMeters)} · {formatDuration(trip.durationSeconds)}
              </dd>
              <dt>Aceptado</dt>
              <dd>{formatDate(trip.acceptedAt)}</dd>
              {trip.arrivedAt && (
                <>
                  <dt>Llegó a recoger</dt>
                  <dd>{formatDate(trip.arrivedAt)}</dd>
                </>
              )}
              {trip.startedAt && (
                <>
                  <dt>Inició</dt>
                  <dd>{formatDate(trip.startedAt)}</dd>
                </>
              )}
              {trip.completedAt && (
                <>
                  <dt>Finalizó</dt>
                  <dd>{formatDate(trip.completedAt)}</dd>
                </>
              )}
            </dl>
          </section>
          <Closing trip={trip} />
          <Timeline trip={trip} />
        </div>

        <section className="card">
          <h2>{trip.live ? 'Viaje en vivo' : 'Recorrido'}</h2>
          <ServiceAreaMap
            route={{ polyline: trip.polyline, origin: trip.origin, destination: trip.destination }}
            trace={trip.trace}
            liveDriver={trip.live?.position ?? null}
          />
          <ul className="legend">
            <li>
              <span className="legend__line legend__line--route" /> Ruta cotizada
            </li>
            <li>
              <span className="legend__line legend__line--trace" /> Recorrido del conductor
              {trip.trace.length === 0 && ' (sin puntos todavía)'}
            </li>
            {trip.live && (
              <li>
                <span className="legend__dot" /> Conductor ahora
                {trip.live.etaSeconds !== null &&
                  ` · ${trip.status === 'IN_PROGRESS' ? 'llega al destino' : 'llega a recoger'} en ${formatDuration(trip.live.etaSeconds)}`}
              </li>
            )}
          </ul>
        </section>
      </div>
    </>
  );
}
