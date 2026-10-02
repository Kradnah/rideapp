import {
  computeFare,
  CreateFareRuleRequest,
  type FareRule,
  VehicleCategory,
} from '@rideapp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { CATEGORY_LABEL, errorMessage, formatDate, formatMoney } from '../lib/labels';

const cop = (cents: number) => formatMoney({ amountCents: cents, currency: 'COP' });

/** Ejemplo para comparar versiones: un viaje típico en Girardot (4 km, 12 min). */
const EXAMPLE = { meters: 4000, seconds: 12 * 60 };

const FIELDS = [
  ['base', 'Banderazo'],
  ['perKm', 'Por kilómetro'],
  ['perMin', 'Por minuto'],
  ['minFare', 'Tarifa mínima'],
] as const;
type Field = (typeof FIELDS)[number][0];

/** "12.300" o "12300" (pesos) → centavos. */
const toCents = (pesos: string) =>
  Math.round(Number(pesos.replace(/\./g, '').replace(',', '.')) * 100);

const EMPTY: Record<Field, string> = { base: '', perKm: '', perMin: '', minFare: '' };

/** Los importes de la tarifa vigente, para partir de ellos al crear la nueva versión. */
const valuesOf = (rule: FareRule | undefined): Record<Field, string> =>
  rule
    ? {
        base: String(rule.baseCents / 100),
        perKm: String(rule.perKmCents / 100),
        perMin: String(rule.perMinCents / 100),
        minFare: String(rule.minFareCents / 100),
      }
    : EMPTY;

function NewFare({ current }: { current: FareRule[] }) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<VehicleCategory>('STANDARD');
  const [values, setValues] = useState(() =>
    valuesOf(current.find((r) => r.category === 'STANDARD')),
  );
  const [when, setWhen] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const prefill = (cat: VehicleCategory) => {
    setCategory(cat);
    setValues(valuesOf(current.find((r) => r.category === cat)));
  };

  const body = {
    category,
    baseCents: toCents(values.base),
    perKmCents: toCents(values.perKm),
    perMinCents: toCents(values.perMin),
    minFareCents: toCents(values.minFare),
    ...(when && { validFrom: new Date(when).toISOString() }),
  };
  const complete = Object.values(values).every((v) => v.trim() !== '');
  const parsed = CreateFareRuleRequest.safeParse(body);
  const example =
    complete && parsed.success ? computeFare(parsed.data, EXAMPLE.meters, EXAMPLE.seconds) : null;

  const create = useMutation({
    mutationFn: () => api.admin.fares.create(CreateFareRuleRequest.parse(body)),
    onSuccess: () => {
      setWhen('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'fares'] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!parsed.success) {
      setProblem('Revisa los importes: deben ser números positivos.');
      return;
    }
    if (parsed.data.minFareCents < parsed.data.baseCents) {
      setProblem('La tarifa mínima no puede ser menor que el banderazo.');
      return;
    }
    setProblem(null);
    create.mutate();
  };

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Nueva versión de tarifa</h2>
      <p className="muted">
        La vigente no se edita: se crea otra que empieza ahora o en la fecha que elijas. Las
        cotizaciones ya hechas mantienen su precio.
      </p>
      <div className="tabs" role="radiogroup" aria-label="Categoría">
        {VehicleCategory.options.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === category}
            className="tab"
            onClick={() => prefill(c)}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="form-grid">
        {FIELDS.map(([key, label]) => (
          <label key={key}>
            {label} (COP)
            <input
              inputMode="decimal"
              value={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              required
              pattern="[0-9.,]+"
            />
          </label>
        ))}
        <label>
          Empieza (vacío = ahora)
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
      </div>
      <p className="muted">
        {example !== null
          ? `Ejemplo: un viaje de 4 km y 12 min costaría ${cop(example)}.`
          : 'Completa los importes para ver un ejemplo.'}
      </p>
      <div className="actions">
        <button type="submit" className="btn" disabled={create.isPending}>
          Crear tarifa de {CATEGORY_LABEL[category].toLowerCase()}
        </button>
      </div>
      {(problem ?? create.isError) && (
        <p className="form__error" role="alert">
          {problem ?? errorMessage(create.error)}
        </p>
      )}
      {create.isSuccess && <p className="muted">Tarifa creada.</p>}
    </form>
  );
}

/** Tarifas (11.1, paso 8): vigentes, programadas e historial. */
export function Fares() {
  const query = useQuery({ queryKey: ['admin', 'fares'], queryFn: () => api.admin.fares.list() });
  const rules = query.data?.rules ?? [];
  const current = rules.filter((r) => r.current);
  // "Ahora" = cuando se cargó la lista (el render no puede leer el reloj).
  const now = query.dataUpdatedAt;

  return (
    <>
      <header className="page-header">
        <h1>Tarifas</h1>
        <p>Precio = banderazo + km + minutos, con mínimo, redondeado a múltiplos de 100 COP.</p>
      </header>

      {query.isError && (
        <p className="form__error" role="alert">
          {errorMessage(query.error)}
        </p>
      )}

      <section className="kpis" aria-label="Vigentes">
        {current.map((r) => (
          <article key={r.id} className="kpi">
            <span className="kpi__label">{CATEGORY_LABEL[r.category]} · vigente</span>
            <span className="kpi__value">
              {cop(computeFare(r, EXAMPLE.meters, EXAMPLE.seconds))}
            </span>
            <span className="cell-sub">4 km / 12 min · desde {formatDate(r.validFrom)}</span>
          </article>
        ))}
      </section>

      {query.isSuccess && (
        // Se monta con los datos ya cargados para partir de la tarifa vigente.
        <NewFare current={current} />
      )}

      <section className="card card--flush">
        <h2 className="pad">Historial</h2>
        {query.isPending ? (
          <p className="muted pad">Cargando…</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Categoría</th>
                  <th scope="col">Banderazo</th>
                  <th scope="col">Km</th>
                  <th scope="col">Minuto</th>
                  <th scope="col">Mínima</th>
                  <th scope="col">Desde</th>
                  <th scope="col">Creada por</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{CATEGORY_LABEL[r.category]}</td>
                    <td className="num">{cop(r.baseCents)}</td>
                    <td className="num">{cop(r.perKmCents)}</td>
                    <td className="num">{cop(r.perMinCents)}</td>
                    <td className="num">{cop(r.minFareCents)}</td>
                    <td>{formatDate(r.validFrom)}</td>
                    <td>{r.createdByName ?? 'Sistema'}</td>
                    <td>
                      {r.current ? (
                        <span className="badge badge--approved">Vigente</span>
                      ) : Date.parse(r.validFrom) > now ? (
                        <span className="badge badge--pending">Programada</span>
                      ) : (
                        <span className="badge">Anterior</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
