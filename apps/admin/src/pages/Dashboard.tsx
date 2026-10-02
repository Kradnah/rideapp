import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ServiceAreaMap } from '../components/ServiceAreaMap';
import { api } from '../lib/api';
import { AVAILABILITY_LABEL, CATEGORY_LABEL } from '../lib/labels';

const time = new Intl.DateTimeFormat('es-CO', { timeStyle: 'medium' });

export function Dashboard() {
  const overview = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.admin.overview(),
    refetchInterval: 30_000,
  });
  // Posiciones en vivo cada 10 s (11.1, paso 4).
  const live = useQuery({
    queryKey: ['admin', 'drivers', 'live'],
    queryFn: () => api.admin.drivers.live(),
    refetchInterval: 10_000,
  });
  const users = overview.data?.users;
  const drivers = overview.data?.drivers;
  const online = live.data?.drivers ?? [];
  const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('es-CO'));

  return (
    <>
      <header className="page-header">
        <h1>Dashboard</h1>
        <p>Girardot · Ricaurte · Flandes</p>
      </header>

      <section className="kpis" aria-label="Usuarios">
        <article className="kpi">
          <span className="kpi__label">Pasajeros</span>
          <span className="kpi__value">{n(users?.passengers)}</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Conductores</span>
          <span className="kpi__value">{n(users?.drivers)}</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Administradores</span>
          <span className="kpi__value">{n(users?.admins)}</span>
        </article>
      </section>

      <section className="kpis" aria-label="Operación">
        {/* Se alimenta en la Fase 3 con los viajes. */}
        <article className="kpi">
          <span className="kpi__label">Viajes de hoy</span>
          <span className="kpi__value">—</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Conductores en línea</span>
          <span className="kpi__value">{n(drivers?.online)}</span>
        </article>
        <Link to="/drivers" className="kpi kpi--link">
          <span className="kpi__label">Solicitudes por revisar</span>
          <span className="kpi__value">{n(drivers?.pendingReview)}</span>
        </Link>
      </section>

      <section className="card">
        <h2>Conductores en línea</h2>
        <ServiceAreaMap drivers={online} />
        {online.length === 0 ? (
          <p className="muted">{live.isPending ? 'Cargando…' : 'Nadie en línea ahora mismo.'}</p>
        ) : (
          <ul className="list">
            {online.map((d) => (
              <li key={d.driverId} className="list__item">
                <div>
                  <Link to={`/drivers/${d.driverId}`} className="row-link">
                    {d.fullName}
                  </Link>
                  <span className="cell-sub">
                    {CATEGORY_LABEL[d.category]} · {AVAILABILITY_LABEL[d.availability]}
                    {d.position ? '' : ' · sin ubicación todavía'}
                  </span>
                </div>
                <span className="cell-sub">Visto {time.format(new Date(d.lastSeenAt))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
