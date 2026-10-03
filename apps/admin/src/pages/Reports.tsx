import type { AdminReport } from '@rideapp/contracts';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ColumnChart } from '../components/ColumnChart';
import { api } from '../lib/api';
import {
  errorMessage,
  formatDistance,
  formatDuration,
  formatMoney,
  formatRating,
} from '../lib/labels';

const DAY_MS = 86_400_000;

/** Hoy en Colombia (UTC−5, sin horario de verano), como YYYY-MM-DD. */
function colombiaToday(): string {
  return new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
}

function shift(day: string, days: number): string {
  return new Date(Date.parse(day) + days * DAY_MS).toISOString().slice(0, 10);
}

const RANGES = [
  { value: '7', label: 'Últimos 7 días' },
  { value: '30', label: 'Últimos 30 días' },
  { value: 'month', label: 'Este mes' },
] as const;
type RangeValue = (typeof RANGES)[number]['value'];

function rangeOf(value: RangeValue): { from: string; to: string } {
  const to = colombiaToday();
  if (value === 'month') return { from: `${to.slice(0, 8)}01`, to };
  return { from: shift(to, -(Number(value) - 1)), to };
}

const dayTitle = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const n = (v: number) => v.toLocaleString('es-CO');
const pct = (part: number, total: number) =>
  total === 0 ? '—' : `${Math.round((part / total) * 100)} %`;
/** Pesos sin decimales y compactos para el eje (1,2 M). */
const compactCop = new Intl.NumberFormat('es-CO', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Informes básicos (Fase 6): viajes, cobros y demanda por hora. Solo agregados. */
export function Reports() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('range');
  const range: RangeValue = RANGES.some((r) => r.value === raw) ? (raw as RangeValue) : '7';
  const { from, to } = rangeOf(range);

  const query = useQuery({
    queryKey: ['admin', 'reports', from, to],
    queryFn: () => api.admin.reports({ from, to }),
  });

  return (
    <>
      <header className="page-header">
        <h1>Informes</h1>
        <p>
          Del {from} al {to} (hora de Colombia). Solo cifras agregadas, sin datos de personas.
        </p>
      </header>

      <div className="tabs" role="radiogroup" aria-label="Periodo">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={r.value === range}
            className="tab"
            onClick={() => setParams({ range: r.value })}
          >
            {r.label}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <p className="muted">Cargando…</p>
      ) : query.isError ? (
        <p className="form__error" role="alert">
          {errorMessage(query.error)}
        </p>
      ) : (
        <ReportBody report={query.data} />
      )}
    </>
  );
}

function ReportBody({ report }: { report: AdminReport }) {
  const { trips, revenue, averages, users, currency } = report;
  const money = (amountCents: number) => formatMoney({ amountCents, currency });
  const cancelled = trips.cancelledByPassenger + trips.cancelledByDriver + trips.cancelledBySystem;
  const longRange = report.days.length > 14;

  const tripsByDay = report.days.map((d) => ({
    label: d.date.slice(8),
    title: dayTitle.format(new Date(d.date)),
    value: d.requested,
  }));
  const revenueByDay = report.days.map((d) => ({
    label: d.date.slice(8),
    title: dayTitle.format(new Date(d.date)),
    value: Math.round(d.revenueCents / 100),
  }));
  const byHour = report.requestsByHour.map((value, h) => ({
    label: String(h).padStart(2, '0'),
    title: `De ${String(h).padStart(2, '0')}:00 a ${String(h).padStart(2, '0')}:59`,
    value,
  }));

  return (
    <>
      <section className="kpis" aria-label="Viajes">
        <article className="kpi">
          <span className="kpi__label">Viajes pedidos</span>
          <span className="kpi__value">{n(trips.requested)}</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Completados</span>
          <span className="kpi__value">{n(trips.completed)}</span>
          <span className="cell-sub">{pct(trips.completed, trips.requested)} de los pedidos</span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Cancelados</span>
          <span className="kpi__value">{n(cancelled)}</span>
          <span className="cell-sub">
            Pasajero {n(trips.cancelledByPassenger)} · conductor {n(trips.cancelledByDriver)} ·
            sistema {n(trips.cancelledBySystem)}
          </span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Sin conductores</span>
          <span className="kpi__value">{n(trips.noDrivers)}</span>
          <span className="cell-sub">{pct(trips.noDrivers, trips.requested)} de los pedidos</span>
        </article>
      </section>

      <section className="kpis" aria-label="Cobros y promedios">
        <article className="kpi">
          <span className="kpi__label">Total de viajes completados</span>
          <span className="kpi__value">{money(revenue.totalCents)}</span>
          <span className="cell-sub">
            Efectivo {money(revenue.cashCents)} · tarjeta demo {money(revenue.cardCents)}
          </span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Tarifa promedio</span>
          <span className="kpi__value">
            {averages.fareCents === null ? '—' : money(averages.fareCents)}
          </span>
          <span className="cell-sub">
            {averages.distanceM === null ? '' : formatDistance(averages.distanceM)}
            {averages.durationS === null ? '' : ` · ${formatDuration(averages.durationS)}`}
          </span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Espera hasta tener conductor</span>
          <span className="kpi__value">
            {averages.waitToAssignS === null ? '—' : formatDuration(averages.waitToAssignS)}
          </span>
        </article>
        <article className="kpi">
          <span className="kpi__label">Calificación promedio</span>
          <span className="kpi__value">{formatRating(averages.rating)}</span>
          <span className="cell-sub">
            Nuevos: {n(users.newPassengers)} pasajeros · {n(users.newDrivers)} conductores ·{' '}
            {n(users.driversApproved)} aprobados
          </span>
        </article>
      </section>

      <section className="card">
        <h2>Viajes pedidos por día</h2>
        <ColumnChart
          data={tripsByDay}
          label="Viajes pedidos por día"
          formatValue={n}
          labelEvery={longRange ? 3 : 1}
        />
      </section>

      <section className="card">
        <h2>Total cobrado por día (COP)</h2>
        <ColumnChart
          data={revenueByDay}
          label="Total de los viajes completados por día"
          formatValue={(v) => money(v * 100)}
          formatTick={(v) => compactCop.format(v)}
          labelEvery={longRange ? 3 : 1}
        />
      </section>

      <section className="card">
        <h2>Solicitudes por hora del día</h2>
        <p className="muted">Sirve para saber cuándo hacen falta más conductores en línea.</p>
        <ColumnChart data={byHour} label="Solicitudes por hora" formatValue={n} labelEvery={3} />
      </section>

      <section className="card card--flush">
        <details className="pad">
          <summary>Ver la tabla por día</summary>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Día</th>
                  <th scope="col" className="num">
                    Pedidos
                  </th>
                  <th scope="col" className="num">
                    Completados
                  </th>
                  <th scope="col" className="num">
                    Cancelados
                  </th>
                  <th scope="col" className="num">
                    Sin conductores
                  </th>
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td className="num">{n(d.requested)}</td>
                    <td className="num">{n(d.completed)}</td>
                    <td className="num">{n(d.cancelled)}</td>
                    <td className="num">{n(d.noDrivers)}</td>
                    <td className="num">{money(d.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  );
}
