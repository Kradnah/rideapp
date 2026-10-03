import { useEffect, useRef, useState } from 'react';

export interface ColumnDatum {
  /** Etiqueta corta del eje (p. ej. "12" o "08 h"). */
  label: string;
  /** Texto completo para el tooltip (p. ej. "martes 10 de marzo"). */
  title: string;
  value: number;
}

export interface ColumnChartProps {
  data: ColumnDatum[];
  /** Nombre accesible del gráfico. */
  label: string;
  /** Valor completo (tooltip y lector de pantalla). */
  formatValue: (v: number) => string;
  /** Marcas del eje; por defecto, `formatValue`. */
  formatTick?: (v: number) => string;
  /** Mostrar una etiqueta del eje X de cada N columnas (las demás quedan en el tooltip). */
  labelEvery?: number;
  height?: number;
}

const AXIS_W = 44;
const AXIS_H = 22;
const TOP = 10;
const MAX_BAR = 24;
const RADIUS = 4;

/** Máximo "redondo" del eje: 1, 2, 5 × 10^n. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

/** Columna con el extremo de datos redondeado (4 px) y la base recta. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Columnas de una sola serie (Fase 6, informes). SVG propio: barras finas (≤ 24 px) con aire
 * entre ellas, rejilla de 1 px, tooltip al pasar el ratón o con el teclado. Sin leyenda: el título
 * de la tarjeta dice qué se dibuja. La tabla equivalente va aparte.
 */
export function ColumnChart({
  data,
  label,
  formatValue,
  formatTick = formatValue,
  labelEvery = 1,
  height = 180,
}: ColumnChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotW = width - AXIS_W;
  const plotH = height - AXIS_H - TOP;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(MAX_BAR, slot * 0.6));
  const y = (v: number) => TOP + plotH - (v / max) * plotH;
  // Conteos: sin marcas fraccionarias (2,5 viajes no existe).
  const ticks = Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max];
  const current = active === null ? null : data[active];

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="group" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart__grid" x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} />
            <text className="chart__tick" x={AXIS_W - 6} y={y(t)} dy="0.32em" textAnchor="end">
              {formatTick(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = AXIS_W + i * slot + (slot - barW) / 2;
          const h = (d.value / max) * plotH;
          return (
            <g
              key={d.title}
              tabIndex={0}
              role="img"
              aria-label={`${d.title}: ${formatValue(d.value)}`}
              className={`chart__col${active === i ? ' chart__col--active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              {/* Zona de contacto: toda la franja, más grande que la barra. */}
              <rect x={AXIS_W + i * slot} y={TOP} width={slot} height={plotH} fill="transparent" />
              {h > 0 && <path className="chart__bar" d={columnPath(x, y(d.value), barW, h)} />}
              {i % labelEvery === 0 && (
                <text
                  className="chart__tick"
                  x={x + barW / 2}
                  y={height - 6}
                  textAnchor="middle"
                  aria-hidden="true"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {current && active !== null && (
        <div
          className="chart__tooltip"
          style={{
            left: Math.min(width - 160, Math.max(0, AXIS_W + active * slot + slot / 2 - 80)),
            top: Math.max(0, y(current.value) - 52),
          }}
          aria-hidden="true"
        >
          <span>{current.title}</span>
          <strong>{formatValue(current.value)}</strong>
        </div>
      )}
    </div>
  );
}
