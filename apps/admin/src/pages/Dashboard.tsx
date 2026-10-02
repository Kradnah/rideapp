import { ServiceAreaMap } from '../components/ServiceAreaMap';

export function Dashboard() {
  return (
    <>
      <header className="page-header">
        <h1>Dashboard</h1>
        <p>Girardot · Ricaurte · Flandes</p>
      </header>

      <section className="kpis" aria-label="Indicadores">
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
