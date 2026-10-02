import { useQuery } from '@tanstack/react-query';
import { ServiceAreaMap } from '../components/ServiceAreaMap';
import { api } from '../lib/api';

export function Dashboard() {
  const overview = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.admin.overview(),
  });
  const users = overview.data?.users;
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
        {/* Se alimentan en la Fase 3–4 con el endpoint admin que lee la capa GEO (11.1, paso 4). */}
        <article className="kpi">
          <span className="kpi__label">Viajes de hoy</span>
          <span className="kpi__value">—</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Conductores en línea</span>
          <span className="kpi__value">—</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Conductores pendientes</span>
          <span className="kpi__value">—</span>
        </article>
      </section>

      <section className="card">
        <h2>Zona de servicio</h2>
        <ServiceAreaMap />
      </section>
    </>
  );
}
