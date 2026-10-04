/*
 * ForgeCoach — ui/lab/TrendChart.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A small dependency-free SVG line chart for #lab/data's trends (lab/trends.ts):
 * one y-axis, 2 px lines with ≥ 8 px markers, an optional interval band per
 * series, a dashed reference line (50% for rates), a crosshair with a tooltip
 * on hover or touch, a legend for two or more series (direct end labels too
 * up to four), and a "the numbers" table so nothing is colour or hover only.
 * Series colours follow the entity (`colorOf`), never its rank.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { bandPath, linePath, runs, type Domain, type TrendChart as Chart } from '../../lab/trends.ts';

export interface TrendChartProps {
  chart: Chart;
  domain: Domain;
  title: string;
  yFmt: (y: number) => string;
  xFmt: (night: string) => string;
  colorOf: (id: string) => string;
  /** A dashed reference line (e.g. 0.5). */
  refY?: number;
  refLabel?: string;
  /** Draw each series' lo–hi band. */
  bands?: boolean;
  height?: number;
  /** Legend and end labels (off for a single-series small multiple, whose title names it). */
  legend?: boolean;
}

const PAD = { top: 10, right: 12, bottom: 22, left: 40 };

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => setW(Math.max(160, Math.round(es[0]!.contentRect.width))));
    ro.observe(el);
    setW(Math.max(160, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function TrendChart({ chart, domain, title, yFmt, xFmt, colorOf, refY, refLabel, bands = false, height = 150, legend = true }: TrendChartProps) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const many = chart.series.length >= 2;
  const endLabels = legend && many && chart.series.length <= 4;
  const right = PAD.right + (endLabels ? 64 : 0);
  const iw = Math.max(40, width - PAD.left - right);
  const ih = height - PAD.top - PAD.bottom;
  const n = chart.nights.length;
  const x = (i: number) => PAD.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.top + ih - ((Math.min(domain.max, Math.max(domain.min, v)) - domain.min) / (domain.max - domain.min)) * ih;
  const xTicks = useMemo(() => {
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
    const out: number[] = [];
    for (let i = 0; i < n; i += every) out.push(i);
    if (out[out.length - 1] !== n - 1 && n - 1 - out[out.length - 1]! >= every / 2) out.push(n - 1);
    return out;
  }, [n, iw]);

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = n <= 1 ? 0 : Math.round(((px - PAD.left) / iw) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  // End labels, nudged apart so two lines ending close together stay readable.
  const labelY = new Map<string, number>();
  if (endLabels) {
    const ends = chart.series
      .filter((s) => s.points.length)
      .map((s) => ({ id: s.id, y: y(s.points[s.points.length - 1]!.y) }))
      .sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) ends[k]!.y = Math.max(ends[k]!.y, ends[k - 1]!.y + 12);
    const over = ends.length ? ends[ends.length - 1]!.y - (PAD.top + ih) : 0;
    for (const e of ends) labelY.set(e.id, over > 0 ? e.y - over : e.y);
  }
  const hoverRows = hover === null ? [] : chart.series.map((s) => ({ s, p: s.points.find((p) => p.i === hover) ?? null }));
  const tipLeft = hover === null ? 0 : x(hover);

  return (
    <figure className="tc" aria-label={title}>
      <div className="tc-plot" ref={wrap}>
        <svg width={width} height={height} role="img" aria-label={`${title}: a line per ${many ? 'series' : 'night'}; the numbers are in the table below`} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          {domain.ticks.map((t) => (
            <g key={t}>
              <line className="tc-grid" x1={PAD.left} x2={PAD.left + iw} y1={y(t)} y2={y(t)} />
              <text className="tc-tick" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {yFmt(t)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} className="tc-tick" x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
              {xFmt(chart.nights[i]!)}
            </text>
          ))}
          {refY !== undefined && refY >= domain.min && refY <= domain.max && (
            <g>
              <line className="tc-ref" x1={PAD.left} x2={PAD.left + iw} y1={y(refY)} y2={y(refY)} />
              {refLabel && (
                <text className="tc-tick tc-ref-l" x={PAD.left + 4} y={y(refY) - 4} textAnchor="start">
                  {refLabel}
                </text>
              )}
            </g>
          )}
          {bands &&
            chart.series.map((s) =>
              runs(s.points.filter((p) => p.lo !== undefined && p.hi !== undefined)).map((run, k) => (
                <path
                  key={`${s.id}-b${k}`}
                  className="tc-band"
                  style={{ fill: colorOf(s.id) }}
                  d={run.length === 1 ? bandPath([{ x: x(run[0]!.i) - 3, lo: y(run[0]!.lo!), hi: y(run[0]!.hi!) }, { x: x(run[0]!.i) + 3, lo: y(run[0]!.lo!), hi: y(run[0]!.hi!) }]) : bandPath(run.map((p) => ({ x: x(p.i), lo: y(p.lo!), hi: y(p.hi!) })))}
                />
              )),
            )}
          {chart.series.map((s) => (
            <g key={s.id} style={{ color: colorOf(s.id) }}>
              {runs(s.points).map((run, k) => (
                <path key={k} className="tc-line" d={linePath(run.map((p) => ({ x: x(p.i), y: y(p.y) })))} />
              ))}
              {s.points.map((p) => (
                <circle key={p.i} className={hover === p.i ? 'tc-dot is-on' : 'tc-dot'} cx={x(p.i)} cy={y(p.y)} r={hover === p.i ? 4.5 : 3} />
              ))}
              {endLabels && labelY.has(s.id) && (
                <text className="tc-end" x={x(s.points[s.points.length - 1]!.i) + 8} y={labelY.get(s.id)} dy="0.32em">
                  {s.label.length > 9 ? `${s.label.slice(0, 8)}…` : s.label}
                </text>
              )}
            </g>
          ))}
          {hover !== null && <line className="tc-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} />}
          {/* A hit area over the whole plot, bigger than any mark. */}
          <rect x={PAD.left - 8} y={PAD.top} width={iw + 16} height={ih} fill="transparent" />
        </svg>
        {hover !== null && (
          <div className={width < 480 ? 'tc-tip is-pinned' : tipLeft > width / 2 ? 'tc-tip is-left' : 'tc-tip'} style={width < 480 ? undefined : { left: tipLeft }} role="status">
            <div className="tc-tip-h">{xFmt(chart.nights[hover]!)}</div>
            {hoverRows.map(({ s, p }) => (
              <div key={s.id} className="tc-tip-r">
                {many && <span className="tc-sw" style={{ background: colorOf(s.id) }} aria-hidden="true" />}
                {many && <span className="tc-tip-l">{s.label}</span>}
                <b>{p ? yFmt(p.y) : '—'}</b>
                {p && p.lo !== undefined && p.hi !== undefined && (
                  <span className="tc-tip-m">
                    {' '}
                    {yFmt(p.lo)}–{yFmt(p.hi)}
                  </span>
                )}
                {p?.n !== undefined && <span className="tc-tip-m"> · {p.n} g</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      {legend && many && (
        <ul className="tc-legend">
          {chart.series.map((s) => (
            <li key={s.id}>
              <span className="tc-sw" style={{ background: colorOf(s.id) }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <details className="tc-table">
        <summary>The numbers</summary>
        <div className="tc-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Night</th>
                {chart.series.map((s) => (
                  <th key={s.id} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.nights.map((night, i) => (
                <tr key={night}>
                  <th scope="row">{xFmt(night)}</th>
                  {chart.series.map((s) => {
                    const p = s.points.find((q) => q.i === i);
                    return (
                      <td key={s.id}>
                        {p ? yFmt(p.y) : '—'}
                        {p && p.lo !== undefined && p.hi !== undefined ? ` (${yFmt(p.lo)}–${yFmt(p.hi)})` : ''}
                        {p?.n !== undefined ? ` · ${p.n}` : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
